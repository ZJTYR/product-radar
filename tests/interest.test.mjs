import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { ReadingConflict, ReadingItemMissing, readingState, setFeedback, undoFeedback, restoreFeedback, saveFavorite, removeFavorite } from '../lib/feedback.ts';
import { recommendItems, recommendationFeatures } from '../lib/recommendations.ts';
import { feedbackSchema, undoSchema, recommendationLimitSchema } from '../lib/validation.ts';

const at=Date.parse('2026-10-26T01:00:00Z');
const item=(id,category='设计',tags=['布局'],sources=[])=>({...seedItems[0],id,name:id,website:`https://example.com/${id}`,github:undefined,repo:undefined,category,tags,sources,discoveredAt:'2026-10-25T01:00:00Z'});
const items=[item('design-1'),item('design-2'),item('design-3'),item('design-4'),item('design-5'),item('device-1','硬件',['设备']),item('education-1','教育',['课堂'])];
async function fixture(run){
 const directory=mkdtempSync(join(tmpdir(),'radar-interest-')); const path=join(directory,'data.sqlite');const db=new RadarDatabase(undefined,path);
 try{await db.batch(items.map(value=>db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES(?,?,?)').bind(value.id,JSON.stringify(value),'now')));await run(db,path);}
 finally{db.close();rmSync(directory,{recursive:true,force:true});}
}

test('dismissal survives reopening, fills the next item, and does not hide an entire category or another user',async()=>fixture(async(db,path)=>{
 const before=recommendItems(items,[],[],2,at);assert.equal(new Set(before.items.map(value=>value.id)).size,2);
 const chosen=before.items[0];await setFeedback(db,'owner',chosen.id,'not_interested');
 const reopened=new RadarDatabase(undefined,path);
 try{
  const state=await readingState(reopened,'owner');const next=recommendItems(items,state.feedback,state.favorites,2,at);
  assert.equal(next.items.length,2);assert.equal(next.remaining,items.length-1);assert.ok(!next.items.some(value=>value.id===chosen.id));
  assert.ok(recommendItems(items,state.feedback,state.favorites,30,at).items.some(value=>value.category===chosen.category));
  assert.deepEqual(await readingState(reopened,'other'),{feedback:[],favorites:[]});
  await restoreFeedback(reopened,'owner',chosen.id);assert.equal((await readingState(reopened,'owner')).feedback.length,0);
 }finally{reopened.close();}
}));

test('interest is replay-safe, preserves existing notes and only removes untouched automatic favorites on undo',async()=>fixture(async db=>{
 const first=await setFeedback(db,'owner','design-1','interested');assert.equal(first.favorites.length,1);
 const replay=await setFeedback(db,'owner','design-1','interested');assert.equal(replay.undoToken,first.undoToken);assert.equal(replay.feedback.length,1);assert.equal(replay.favorites.length,1);
 await assert.rejects(undoFeedback(db,'other',first.undoToken),ReadingConflict);
 const undone=await undoFeedback(db,'owner',first.undoToken);assert.deepEqual(undone,{feedback:[],favorites:[]});
 await assert.rejects(undoFeedback(db,'owner',first.undoToken),ReadingConflict);
 await saveFavorite(db,'owner',{itemId:'design-2',collection:'项目灵感',note:'我的原有备注'});
 const existing=await setFeedback(db,'owner','design-2','interested');assert.equal(existing.favorites[0].note,'我的原有备注');
 await undoFeedback(db,'owner',existing.undoToken);assert.equal((await readingState(db,'owner')).favorites[0].collection,'项目灵感');
 const fresh=await setFeedback(db,'owner','design-3','interested');
 await saveFavorite(db,'owner',{itemId:'design-3',collection:'值得试用',note:'另一标签页新增的备注'});
 await undoFeedback(db,'owner',fresh.undoToken);
 assert.equal((await readingState(db,'owner')).favorites.find(value=>value.itemId==='design-3').note,'另一标签页新增的备注');
 const readded=await setFeedback(db,'owner','design-4','interested');await removeFavorite(db,'owner','design-4');
 await saveFavorite(db,'owner',{itemId:'design-4',collection:'灵感收藏',note:''});
 await undoFeedback(db,'owner',readded.undoToken);assert.ok((await readingState(db,'owner')).favorites.some(value=>value.itemId==='design-4'));
}));

test('stale undo refuses to overwrite newer feedback, concurrent choices survive, and dislike never removes a favorite',async()=>fixture(async db=>{
 const first=await setFeedback(db,'owner','design-1','interested');const second=await setFeedback(db,'owner','design-1','not_interested');
 await assert.rejects(undoFeedback(db,'owner',first.undoToken),ReadingConflict);
 assert.equal((await readingState(db,'owner')).favorites.length,1);
 await undoFeedback(db,'owner',second.undoToken);assert.equal((await readingState(db,'owner')).feedback[0].action,'interested');
 await Promise.all([setFeedback(db,'owner','design-2','not_interested'),setFeedback(db,'owner','design-3','interested')]);
 const state=await readingState(db,'owner');assert.equal(state.feedback.length,3);assert.equal(state.favorites.length,2);
 await assert.rejects(setFeedback(db,'owner','missing','interested'),ReadingItemMissing);
 assert.equal((await readingState(db,'owner')).feedback.length,3);
}));

test('concurrent undo and a manual note change keep the manual favorite',async()=>fixture(async db=>{
 const selected=await setFeedback(db,'owner','design-1','interested');
 await Promise.all([undoFeedback(db,'owner',selected.undoToken),saveFavorite(db,'owner',{itemId:'design-1',collection:'保留',note:'不能被撤销删除'})]);
 const state=await readingState(db,'owner');assert.equal(state.feedback.length,0);assert.equal(state.favorites[0].note,'不能被撤销删除');
}));

test('ranking reacts to explicit choices, deduplicates items and supplies exploration on the next refreshed card',()=>{
 const positive=[{itemId:'design-1',action:'interested',updatedAt:'now'}];
 const personalized=recommendItems([...items,items[1]],positive,[],12,at);
 assert.equal(personalized.items[0].category,'设计');assert.equal(personalized.remaining,items.length-1);assert.ok(personalized.profile.positiveTopics.includes('布局'));
 const negative=recommendItems(items,[{...positive[0],action:'not_interested'}],[],12,at);assert.notEqual(negative.items[0].category,'设计');
 const three=items.slice(0,3).map(value=>({itemId:value.id,action:'interested',updatedAt:'now'}));
 const exploration=recommendItems(items,three,[],1,at);assert.notEqual(exploration.items[0].category,'设计');assert.match(exploration.reasons[exploration.items[0].id],/探索/);
 const all=items.map(value=>({itemId:value.id,action:'not_interested',updatedAt:'now'}));assert.equal(recommendItems(items,all,[],12,at).remaining,0);
 const once=recommendItems(items,positive,[],12,at);const withSaved=recommendItems(items,positive,[{itemId:'design-1'}],12,at);assert.deepEqual(once,withSaved);
});

test('WeChat author preference uses account identity, not a shared hostname or duplicated links',()=>{
 const a=item('author-a','设计',['布局'],[{label:'文章1',url:'https://mp.weixin.qq.com/s?__biz=accountA&mid=1'},{label:'文章2',url:'https://mp.weixin.qq.com/s?__biz=accountA&mid=2'}]);
 const b=item('author-b','设计',['布局'],[{label:'另一作者',url:'https://mp.weixin.qq.com/s?__biz=accountB&mid=1'}]);
 const unknown=item('unknown','设计',['布局'],[{label:'未知身份',url:'https://mp.weixin.qq.com/s/short'}]);
 assert.equal(recommendationFeatures(a).filter(value=>value.key==='author:wechat:accountA').length,1);
 assert.ok(!recommendationFeatures(b).some(value=>value.key==='author:wechat:accountA'));
 assert.ok(!recommendationFeatures(unknown).some(value=>value.key.includes('author:')||value.key.includes('mp.weixin.qq.com')));
});

test('feedback API input rejects unknown actions, arbitrary user ids, malformed undo and unbounded limits',()=>{
 assert.equal(feedbackSchema.safeParse({itemId:'design-1',action:'like'}).success,false);
 assert.equal(feedbackSchema.safeParse({itemId:'design-1',action:'interested',userId:'other'}).success,false);
 assert.equal(undoSchema.safeParse({undoToken:'not-a-token'}).success,false);
 for(const value of ['0','-1','31','1.2','all'])assert.equal(recommendationLimitSchema.safeParse(value).success,false);
 assert.equal(recommendationLimitSchema.parse(undefined),12);
});
