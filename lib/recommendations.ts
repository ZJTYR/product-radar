import type { IntelItem, ItemFeedback, ItemRead, SavedItem } from './types.ts';
import { FRONTIER_LIMIT, frontierLabel, selectFrontierItems } from './frontier.ts';
export type RecommendationScope='all'|'products'|'github'|'ai'|'frontier';
export interface RecommendationOptions {scope?:RecommendationScope;excludeIds?:string[];readItems?:ItemRead[]}
type Feature={key:string;label:string;weight:number;topic:boolean};
const normalize=(value:string)=>value.trim().toLocaleLowerCase();
export function recommendationFeatures(item:IntelItem):Feature[] {
 const features:Feature[]=[{key:`kind:${item.kind}`,label:item.kind,weight:.2,topic:false},{key:`category:${normalize(item.category)}`,label:item.category,weight:1,topic:true}];
 for(const tag of item.tags) features.push({key:`tag:${normalize(tag)}`,label:tag,weight:.6,topic:true});
 for(const source of item.sources) {
  try {
   const url=new URL(source.url);
   const biz=url.hostname==='mp.weixin.qq.com'?url.searchParams.get('__biz'):null;
   // 同一公众号跨文章是同一来源作者，其他微信账号不共享此偏好。
   if(biz) features.push({key:`author:wechat:${biz}`,label:'同一公众号作者',weight:1.1,topic:false});
   else if(url.hostname!=='mp.weixin.qq.com') features.push({key:`source:${url.hostname}`,label:'相近资料来源',weight:.12,topic:false});
  } catch { /* 不可解析的旧来源不参与偏好特征。 */ }
 }
 return [...new Map(features.map(feature=>[feature.key,feature])).values()];
}
export function recommendItems(items:IntelItem[],feedback:ItemFeedback[],favorites:SavedItem[],limit=12,at=Date.now(),options:RecommendationOptions={}) {
 if(options.scope==='frontier') {
  const readIds=new Set((options.readItems||[]).map(entry=>entry.itemId));
  const blockedIds=new Set([...(options.excludeIds||[]),...feedback.filter(entry=>entry.action==='not_interested').map(entry=>entry.itemId)]);
  const result=selectFrontierItems(items,at,readIds,blockedIds,Math.min(limit,FRONTIER_LIMIT));
  return {...result,reasons:Object.fromEntries(result.items.map(item=>[item.id,`近七天${frontierLabel(item)}${readIds.has(item.id)?' · 已读回看':''}`])),feedbackCount:feedback.length,profile:{positiveTopics:[],negativeTopics:[]}};
 }
 const byId=new Map(items.map(item=>[item.id,item]));const choices=new Map(feedback.map(entry=>[entry.itemId,entry.action]));
 const scope=options.scope||'all';const excluded=new Set([...(options.excludeIds||[]),...(options.readItems||[]).map(entry=>entry.itemId)]);
 const saved=new Set(favorites.map(entry=>entry.itemId));const weights=new Map<string,number>();const labels=new Map<string,string>();
 const signals=new Map<string,number>(favorites.map(entry=>[entry.itemId,2]));
 for(const entry of feedback)signals.set(entry.itemId,entry.action==='interested'?3:-2);
 for(const [id,signal] of signals){const item=byId.get(id);if(!item)continue;for(const feature of recommendationFeatures(item)){
  weights.set(feature.key,(weights.get(feature.key)||0)+signal);if(feature.topic)labels.set(feature.key,feature.label);
 }}
 for(const [key,value] of weights)weights.set(key,Math.max(-8,Math.min(8,value)));
 const eventTime=(item:IntelItem)=>Date.parse(item.publishedAt||item.discoveredAt);
 const candidates=[...byId.values()].filter(item=>{
  if(choices.has(item.id)||saved.has(item.id)||excluded.has(item.id))return false;
  if(scope==='products')return item.kind==='product';
  if(scope==='github')return item.kind==='product'&&Boolean(item.github)&&item.stars!=null&&item.stars>0;
  if(scope==='ai'){const time=eventTime(item);return item.kind==='ai'&&Boolean(item.aiApplication)&&Number.isFinite(time)&&time<=at&&time>=at-7*86400000;}
  return true;
 }).map(item=>{
  const features=recommendationFeatures(item);const age=Math.max(0,(at-Date.parse(item.discoveredAt))/86400000);
  const affinity=features.reduce((total,feature)=>total+(weights.get(feature.key)||0)*feature.weight,0);
  return {item,features,score:affinity+(Number.isFinite(age)?1/(1+age/14):0)};
 }).sort((a,b)=>(scope==='ai'?eventTime(b.item)-eventTime(a.item):b.score-a.score)||b.item.discoveredAt.localeCompare(a.item.discoveredAt)||a.item.id.localeCompare(b.item.id));
 const remaining=candidates.length;const result:IntelItem[]=[];const reasons:Record<string,string>={};
 const recentCategories=feedback.slice(0,3).map(entry=>byId.get(entry.itemId)?.category).filter((value):value is string=>Boolean(value));
 while(candidates.length&&result.length<limit){let index=0;let exploring=false;
  // 槽位跟随已反馈数量推进，逐条换卡并重新请求时也会真正遇到探索内容。
  if(scope!=='ai'&&(feedback.length+result.length)%4===3){const categories=new Set([...recentCategories,...result.slice(-3).map(item=>item.category)]);const alternative=candidates.findIndex(value=>!categories.has(value.item.category));if(alternative>=0){index=alternative;exploring=true;}}
  else if(scope!=='ai'&&result.length>=2&&result.at(-1)!.category===result.at(-2)!.category){const alternative=candidates.findIndex(value=>value.item.category!==result.at(-1)!.category);if(alternative>=0){index=alternative;exploring=true;}}
  const chosen=candidates.splice(index,1)[0];result.push(chosen.item);
  const match=chosen.features.filter(feature=>(weights.get(feature.key)||0)>0).sort((a,b)=>(weights.get(b.key)||0)*b.weight-(weights.get(a.key)||0)*a.weight)[0];
  reasons[chosen.item.id]=scope==='ai'?'近七天 AI 应用能力与落地变化':exploring?'换个方向，保留跨行业探索':match?match.topic?`与你留下的「${match.label}」相关`:`与你留下的内容有${match.label==='同一公众号作者'?'相同作者':'相近方向或来源'}`:'探索已收集的产品与设计灵感';
 }
 const topics=[...labels].map(([key,label])=>({label,value:weights.get(key)||0}));
 const topicList=(positive:boolean)=>[...new Set(topics.filter(value=>positive?value.value>0:value.value<0).sort((a,b)=>positive?b.value-a.value:a.value-b.value).map(value=>value.label))].slice(0,6);
 return {items:result,reasons,remaining,feedbackCount:feedback.length,profile:{positiveTopics:topicList(true),negativeTopics:topicList(false)}};
}
