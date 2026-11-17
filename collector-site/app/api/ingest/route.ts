import { route, json, checkMutation, body, initialize, saveEdition, database, shanghaiDate, HttpError } from '@/lib/server';
import { ingestSchema } from '@/lib/validation';
import { getItemImages } from '@/lib/media';

export const dynamic = 'force-dynamic';

function stable(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(stable);
 if (!value || typeof value !== 'object') return value;
 const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
 return Object.fromEntries(entries.map(([key, entry]) => [key, stable(entry)]));
}

// Sites owner-private 服务访问允许写入编辑资料，但不会冒用访客身份。
export function POST(request: Request) {
 return route(async () => {
  checkMutation(request);
  const value = ingestSchema.parse(await body(request));
  const today = shanghaiDate();
  if (value.date === today) {
   const unchecked = value.items.filter(item => !getItemImages(item).length && !item.missingImageReview);
   if (unchecked.length) {
    throw new HttpError(400, '本期无图条目须补图或填写 missingImageReview：' + unchecked.map(item => item.id).join('、'));
   }
  }

  await initialize();
  if (value.date < today) {
   const old = await database().prepare('SELECT payload FROM editions WHERE date=?').bind(value.date).first<{payload: string}>();
   if (old && JSON.stringify(stable(JSON.parse(old.payload))) !== JSON.stringify(stable(value.items))) {
    throw new HttpError(409, '历史简报已归档，不允许覆盖；请将新发现写入本期');
   }
  }

  const updatedAt = await saveEdition(value.date, value.items, value.status, 'ingest');
  return json({ ok: true, date: value.date, count: value.items.length, status: value.status, updatedAt });
 });
}
