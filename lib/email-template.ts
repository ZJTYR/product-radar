import type { IntelItem } from './types.ts';
import type { EmailMessage } from './email-smtp.ts';

const origin = 'https://product-radar-gules.vercel.app';
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function safeUrl(value: string) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }

/** 邮件仅使用当天简报公开内容，绝不混入收藏、笔记或草稿。 */
export function dailyEmail(date: string, items: IntelItem[]): EmailMessage {
  const subject = `拾光 · ${date} 产品与前沿简报`;
  const entries = items.map((item, index) => {
    const detail = `${origin}/?${new URLSearchParams({ view: 'history', date, item: item.id })}`;
    const source = item.sources.map(value => ({ label: value.label, url: safeUrl(value.url) })).find(value => value.url);
    const published = item.publishedAt ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(item.publishedAt)) : '';
    return { item, detail, source, published, number: index + 1 };
  });
  const text = [`${subject}\n\n${items.length} 条精选。以下为公开资料整理，商业判断为产品分析推断。`, ...entries.map(({ item, detail, source, published, number }) => `${number}. ${item.name}｜${item.title}\n${item.category}${published ? ` · 实际发布 ${published}` : ''}\n${item.summary}\n阅读拆解：${detail}${source ? `\n来源：${source.label} ${source.url}` : ''}`), `在拾光偏好设置中关闭每日邮件：${origin}\n每日 08:30 开始采集，简报完成后发送；同一天只发送一份。`].join('\n\n');
  const cards = entries.map(({ item, detail, source, published, number }) => `<section style="padding:20px 0;border-bottom:1px solid #dce5d7"><p style="color:#63765e;font-size:12px">${number} · ${escape(item.category)}${published ? ` · 实际发布 ${escape(published)}` : ''}</p><h2 style="font-size:19px;line-height:1.5;margin:8px 0">${escape(item.name)}｜${escape(item.title)}</h2><p style="line-height:1.8">${escape(item.summary)}</p><a style="color:#28503e" href="${escape(detail)}">阅读拆解 ↗</a>${source ? ` · <a style="color:#526154" href="${escape(source.url)}">${escape(source.label)}</a>` : ''}</section>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f8f3;color:#294235;font-family:Arial,'Microsoft YaHei',sans-serif"><main style="max-width:680px;margin:auto;padding:24px"><p style="font-size:12px;letter-spacing:2px">拾光 · SHIGUANG</p><h1 style="font-size:26px">${escape(date)}，好发现已准备好</h1><p>${items.length} 条精选 · 公开资料整理 · 商业判断为分析推断</p>${cards}<p style="font-size:12px;color:#63765e;line-height:1.8">每日 08:30 开始采集，简报完成后发送；同一天只发送一份。<br>可在<a style="color:#28503e" href="${origin}">拾光偏好设置</a>关闭每日邮件。工作台保持私人访问，需要登录后阅读。</p></main></body></html>`;
  return { subject, text, html };
}

export function testEmail(): EmailMessage {
  const text = `这是一封拾光 SMTP 连通测试邮件。\n\n如果你已收到此信，说明这次测试邮件已到达你的邮箱。每日简报将在采集完成后单独发送，同一天只发送一份。\n\n打开拾光：${origin}`;
  return { subject: '拾光 · 邮件连接测试', text, html: `<html lang="zh-CN"><body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#294235;line-height:1.8"><h1>拾光邮件连接测试</h1><p>这是一封 SMTP 连通测试邮件。</p><p>每日简报将在采集完成后单独发送，同一天只发送一份。</p><p><a href="${origin}">打开拾光</a></p></body></html>` };
}
