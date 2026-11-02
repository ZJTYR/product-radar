import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, initialize, library, route, json, setting, emailConfigured, HttpError } from '@/lib/server';
import { dateSchema } from '@/lib/validation';
import type { IntelItem } from '@/lib/types';
import { readFeedMetadata } from '@/lib/feed-freshness';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return route(async () => {
 await initialize(); const db = database(); const requested = new URL(request.url).searchParams.get('date');
 const { edition, freshness, lastRunStatus } = await readFeedMetadata(db, requested ? dateSchema.parse(requested) : null);
 if (requested && !edition) throw new HttpError(404, '这一天还没有简报');
 const editionItems: IntelItem[] = edition ? JSON.parse(edition.payload) : [];
 const items = requested ? editionItems : await library();
 const user = await getChatGPTUser();
 return json({ items, meta: { updatedAt:edition?.updated_at || '', date:edition?.date || '', total:editionItems.length, editionItemIds:editionItems.map(i=>i.id), scheduleStatus:await setting('schedule_status') || '每日更新待启用', emailStatus:emailConfigured() ? '发信配置已就绪，投递任务待接通' : '发信服务未配置', emailConfigured:emailConfigured(), sourceCount:new Set(editionItems.flatMap(i=>i.sources.map(s=>new URL(s.url).hostname))).size,lastRunStatus,freshness },user:{name:user?.displayName || '产品探索者',signedIn:Boolean(user)} });
 }); }
