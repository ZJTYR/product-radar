import { route, json, checkMutation, body, initialize, saveEdition, database, shanghaiDate, HttpError, currentUser } from '@/lib/server';
import { ingestSchema } from '@/lib/validation';
import { sendDailyEmail, EmailDeliveryError } from '@/lib/email-store';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
// Shared editorial ingestion relies on the Sites owner-private platform gate. Service access is verified upstream and does not impersonate a visitor. Do not make this Site public.
export function POST(request: Request) { return route(async()=> {
 checkMutation(request);
 const value=ingestSchema.parse(await body(request));
 await initialize();
 if(value.date < shanghaiDate()) {
  const old = await database().prepare('SELECT payload FROM editions WHERE date=?').bind(value.date).first<{payload:string}>();
  if(old) {
   const stable=(v:unknown):unknown => Array.isArray(v) ? v.map(stable) : v && typeof v==='object' ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,val])=>[k,stable(val)])) : v;
   if(JSON.stringify(stable(JSON.parse(old.payload))) !== JSON.stringify(stable(value.items))) throw new HttpError(409,'历史简报已归档，不允许覆盖；请将新发现写入本期');
  }
 }
 const updatedAt=await saveEdition(value.date,value.items,value.status,'ingest');
 // 数据已成功保存。邮件的拒绝或不确定结果独立返回，不能导致采集方覆盖重放简报。
 let email: unknown = { skipped:true,reason:'完整简报完成后才发送邮件。' };
 if(value.status==='complete') {
  try { const user=await currentUser(); email=await sendDailyEmail(database(),user.userId,value.date); }
  catch(error) { email=error instanceof EmailDeliveryError ? {skipped:true,reason:error.message} : {status:'unknown',message:'简报已保存，邮件结果暂时无法核对，请在偏好设置查看投递记录。'}; }
 }
 return json({ok:true,date:value.date,count:value.items.length,status:value.status,updatedAt,email});
}); }
