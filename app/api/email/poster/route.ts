import { database, HttpError, route, shanghaiDate } from '@/lib/server';
import { dateSchema } from '@/lib/validation';
import { renderHotspotPoster } from '@/lib/email-poster';
import type { IntelItem } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** 私人预览入口不创建邮件，也不改变任何投递状态。 */
export function GET(request: Request) {
  return route(async () => {
    const date = dateSchema.parse(new URL(request.url).searchParams.get('date') || shanghaiDate());
    const edition = await database().prepare('SELECT payload,status FROM editions WHERE date=?').bind(date).first<{payload:string;status:string}>();
    if (!edition || edition.status !== 'complete') throw new HttpError(404, '当天完整简报尚未就绪，暂时无法生成热点海报。');
    const items = JSON.parse(edition.payload) as IntelItem[];
    if (!items.length) throw new HttpError(404, '这期简报暂无可用于海报的内容。');
    const poster = renderHotspotPoster(date, items);
    return new Response(Buffer.from(poster.contentBase64, 'base64'), {
      headers: {
        'Content-Type': poster.contentType,
        'Content-Disposition': `inline; filename="hotspots-${date}.png"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
