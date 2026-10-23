import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, initialize, library, route, json, setting, emailConfigured, HttpError } from '@/lib/server';
import { dateSchema } from '@/lib/validation';
import type { IntelItem } from '@/lib/types';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return route(async () => {
 await initialize(); const db = database(); const requested = new URL(request.url).searchParams.get('date');
 const edition = requested ? await db.prepare('SELECT * FROM editions WHERE date=?').bind(dateSchema.parse(requested)).first<{date:string,payload:string,updated_at:string,status:string}>() : await db.prepare('SELECT * FROM editions ORDER BY date DESC LIMIT 1').first<{date:string,payload:string,updated_at:string,status:string}>();
 if (requested && !edition) throw new HttpError(404, '这一天还没有简报');
 const editionItems: IntelItem[] = edition ? JSON.parse(edition.payload) : [];
 const items = requested ? editionItems : await library();
 const user = await getChatGPTUser(); const last = await db.prepare('SELECT status,detail FROM runs ORDER BY created_at DESC LIMIT 1').first<{status:string,detail:string}>();
 return json({ items, meta: { updatedAt:edition?.updated_at || '', date:edition?.date || '', total:editionItems.length, editionItemIds:editionItems.map(i=>i.id), scheduleStatus:await setting('schedule_status') || '每日更新待启用', emailStatus:emailConfigured() ? '发信配置已就绪，投递任务待接通' : '发信服务未配置', emailConfigured:emailConfigured(), sourceCount:new Set(editionItems.flatMap(i=>i.sources.map(s=>new URL(s.url).hostname))).size,lastRunStatus:({complete:'更新完成',partial:'部分来源更新',curated:'人工精选核验'} as Record<string,string>)[last?.status || 'curated'] || '更新状态待核对' },user:{name:user?.displayName || '产品探索者',signedIn:Boolean(user)} });
 }); }
