import { database, initialize, library, route, json, checkMutation, now } from '@/lib/server';
import { refreshRepositoryStars } from '@/lib/collector';
export const dynamic = 'force-dynamic';
// Editorial metadata refresh is protected by the owner-private Site gate, not visitor identity.
export function POST(request: Request) { return route(async()=>{
 checkMutation(request); await initialize(); const db=database(); const result=await refreshRepositoryStars(await library()); const at=now();
 const statements=result.items.filter(i=>i.repo && !result.errors.some(e=>e.startsWith(`${i.name}:`))).map(item=>db.prepare('UPDATE intel_items SET payload=?,updated_at=? WHERE id=?').bind(JSON.stringify(item),at,item.id));
 statements.push(db.prepare('INSERT INTO runs(id,kind,status,detail,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),'github_stars',result.partial?'partial':'complete',JSON.stringify({checked:result.checked,errors:result.errors,note:'仅更新 GitHub Star 快照，不生成新资讯或更改原始发现日期'}),at));
 await db.batch(statements);
 return json({ok:true,count:result.items.length,checked:result.checked,partial:result.partial,errors:result.errors,message:'已更新 GitHub Star 快照；新内容由每日研究任务写入'});
 }); }
