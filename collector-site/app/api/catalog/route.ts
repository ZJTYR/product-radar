import { body, checkMutation, database, initialize, json, now, route } from '@/lib/server';
import { catalogSchema } from '@/lib/validation';
import { mirrorStatement, deliverMirror } from '@/lib/mirror';

export const dynamic = 'force-dynamic';

// 编辑产品库依赖已确认的 Sites owner-private 访问边界；不接受公共匿名写入。
// 仅按稳定 ID 更新资料，不更改简报快照、个人收藏或每日运行状态。
export function POST(request: Request) {
 return route(async () => {
  checkMutation(request);
  const { items } = catalogSchema.parse(await body(request));
  await initialize();
  const db = database();
  const at = now();
  const mirror = mirrorStatement('/api/catalog', {items});
  await db.batch([...items.map(item => db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(item.id, JSON.stringify(item), at)), ...(mirror ? [mirror] : [])]);
  return json({ ok: true, count: items.length, updatedAt: at, mirror:await deliverMirror() });
 });
}
