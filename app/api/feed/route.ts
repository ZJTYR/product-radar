import { getChatGPTUser } from '@/app/chatgpt-auth';
import { database, initialize, library, route, json, setting, emailConfigured, HttpError } from '@/lib/server';
import { readFeedMetadata } from '@/lib/feed-metadata';
import { dateSchema } from '@/lib/validation';
import type { IntelItem } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(request: Request) { return route(async () => {
  await initialize();
  const db = database();
  const requested = new URL(request.url).searchParams.get('date');
  const { edition, freshness, lastRunStatus } = await readFeedMetadata(db, requested ? dateSchema.parse(requested) : null);
  if (requested && !edition) throw new HttpError(404, '这一天还没有简报');
  const editionItems: IntelItem[] = edition ? JSON.parse(edition.payload) : [];
  const items = requested ? editionItems : await library();
  const [user, schedule] = await Promise.all([
    getChatGPTUser(),
    setting('schedule_status'),
  ]);
  return json({ items, meta: {
    updatedAt: edition?.updated_at || '', date: edition?.date || '', total: editionItems.length,
    editionItemIds: editionItems.map(item => item.id), scheduleStatus: schedule || '每日更新待启用',
    emailStatus: emailConfigured() ? '发信配置已就绪，投递任务待接通' : '发信服务未配置', emailConfigured: emailConfigured(),
    sourceCount: new Set(editionItems.flatMap(item => item.sources.map(source => new URL(source.url).hostname))).size,
    lastRunStatus, freshness,
  }, user: { name: user?.displayName || '产品探索者', signedIn: Boolean(user) } });
}); }
