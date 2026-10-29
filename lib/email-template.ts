import type { IntelItem } from './types.ts';
import type { EmailMessage } from './email-smtp.ts';
import { renderHotspotPoster } from './email-poster.ts';
import { emailDay } from './email-timing.ts';

const origin = 'https://product-radar-gules.vercel.app';
export const POSTER_EMAIL_VERSION = 'hotspot-poster-v1';

/** 图片随邮件传输，不依赖任何远端图床、字体或工作台登录。 */
function posterEmail(date: string, items: IntelItem[], testing: boolean): EmailMessage {
  const poster = renderHotspotPoster(date, items);
  const cid = `shiguang-${testing ? 'test' : 'hotspots'}-${date}@product-radar.local`;
  const subject = testing ? '拾光 · 热点海报显示测试' : `拾光 · ${date} 热点海报`;
  const link = `${origin}/?${new URLSearchParams({ view: 'history', date })}`;
  const alt = testing ? '拾光邮件海报显示测试，内容为演示' : `${date} 拾光热点海报，${poster.itemCount} 条精选`;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f1f3e8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><a href="${link}" style="display:block;max-width:720px;text-decoration:none"><img src="cid:${cid}" alt="${alt}" width="720" style="display:block;width:100%;max-width:720px;height:auto;border:0"></a></td></tr></table></body></html>`;
  const text = `${testing ? '这是一封海报显示测试邮件，图片内为演示内容。' : `${date} 热点海报已随邮件内嵌。`}\n请使用支持 HTML 的邮件客户端查看海报；也可打开邮件中的 PNG 图片。\n工作台：${link}`;
  return { subject, text, html, templateVersion: POSTER_EMAIL_VERSION, attachments: [{ filename: poster.filename, contentType: poster.contentType, contentBase64: poster.contentBase64, cid }] };
}

/** 邮件仅使用当天简报公开内容，绝不混入收藏、笔记或草稿。 */
export function dailyEmail(date: string, items: IntelItem[]): EmailMessage { return posterEmail(date, items, false); }

export function testEmail(date = emailDay(new Date().toISOString())): EmailMessage {
  const demo: IntelItem = {
    id: 'poster-display-demo', kind: 'product', name: '邮件海报测试 · 演示内容',
    title: '一张图片，直接在手机邮件中查看', subtitle: '显示测试，非真实产品资讯',
    summary: '用于检查中文排版、长图缩放和邮件内嵌图片。这是演示内容，不代表今日热点，也不表示实际简报已发送。',
    category: '显示测试', tags: [], accent: '#285a45', website: '', publishedAt: null,
    discoveredAt: `${date}T00:00:00Z`, evidence: '产品观察', readMinutes: 1, facts: [],
    audience: '', pain: '', workflow: '', businessModel: '', differentiation: '', opportunity: '', designNotes: [], caveats: [], sources: [],
  };
  return posterEmail(date, [demo], true);
}
