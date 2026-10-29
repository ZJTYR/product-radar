import type { IntelItem } from './types.ts';
import type { RadarLocation } from './radar-navigation.ts';
import { frontierEventTime, frontierTopic } from './frontier.ts';
export function filterLibrary(items: IntelItem[], filters:Pick<RadarLocation,'category'|'read'|'topic'|'range'|'sort'>, readIds:Set<string>, at=Date.now()) {
  const start=Math.floor((at+8*3_600_000)/86_400_000)*86_400_000-8*3_600_000;
  const result=items.filter(item=>{
    if(filters.category && item.category!==filters.category) return false;
    if(filters.read!=='all' && readIds.has(item.id)!==(filters.read==='read')) return false;
    if(filters.topic!=='all' && frontierTopic(item)!==filters.topic) return false;
    const time=frontierEventTime(item);
    if(filters.range!=='all' && (!Number.isFinite(time)||time<start-(Number(filters.range)-1)*86_400_000||time>at)) return false;
    return true;
  });
  return result.sort((a,b)=>{
    if(filters.sort==='name') return a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id);
    if(filters.sort==='stars') return (b.stars??-1)-(a.stars??-1)||a.id.localeCompare(b.id);
    const byDate=filters.sort==='published' ? frontierEventTime(b)-frontierEventTime(a) : Date.parse(b.discoveredAt)-Date.parse(a.discoveredAt);
    return (Number.isFinite(byDate) ? byDate : 0)||a.id.localeCompare(b.id);
  });
}
