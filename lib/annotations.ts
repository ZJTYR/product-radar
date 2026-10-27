import type { IntelItem } from './types.ts';

export interface AnnotationBlock { id: string; label: string; text: string }
export interface AnnotationAnchor { blockId: string; start: number; end: number; quote: string; prefix: string; suffix: string }
export interface ReadingAnnotation {
  id: string; itemId: string; itemName: string; itemTitle: string; itemUrl: string;
  sourceDate: string | null; anchors: AnnotationAnchor[]; quote: string; body: string;
  createdAt: string; updatedAt: string; version: string; deletedAt: string | null;
}
export interface FavoriteNote { itemId: string; itemName: string; itemTitle: string; itemUrl: string; body: string; createdAt: string; updatedAt: string }
export interface AnnotationList { notes: ReadingAnnotation[]; favoriteNotes: FavoriteNote[] }

// 与阅读页的文本块共享稳定标识；界面装饰、按钮和来源链接不属于可批注正文。
export function getAnnotationBlocks(item: IntelItem): AnnotationBlock[] {
  const blocks: AnnotationBlock[] = [
    { id: 'title', label: '一句话解读', text: item.title },
    { id: 'summary', label: '背景', text: item.summary },
    { id: 'audience', label: '使用者', text: item.audience },
    { id: 'pain', label: '需求', text: item.pain },
  ];
  if (item.scenario) blocks.push({ id: 'scenario', label: '使用示例', text: item.scenario });
  item.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean).forEach((text, i) => blocks.push({ id: `workflow.${i}`, label: `使用步骤 ${i + 1}`, text }));
  blocks.push({ id: 'differentiation', label: '用户价值', text: item.differentiation });
  if (item.caveats[0]) blocks.push({ id: 'caveatIntro', label: '使用前了解', text: item.caveats[0] });
  blocks.push({ id: 'businessModel', label: '商业与使用条件', text: item.businessModel }, { id: 'opportunity', label: '可以借鉴什么', text: item.opportunity });
  for (const [key, label] of [['designNotes', '设计启发'], ['facts', '公开资料'], ['caveats', '使用条件']] as const) {
    item[key].forEach((text, i) => blocks.push({ id: `${key}.${i}`, label: `${label} ${i + 1}`, text }));
  }
  return blocks;
}

export function createAnnotationAnchor(blockId: string, text: string, start: number, end: number): AnnotationAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) throw new RangeError('划线范围无效');
  return { blockId, start, end, quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(end, end + 32) };
}

// 内容更新后只根据原文与上下文定位。重复且无法唯一确认的摘录留在笔记本，不猜测位置。
export function resolveAnnotationAnchor(anchor: AnnotationAnchor, text: string): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  const candidates: number[] = [];
  let offset = text.indexOf(anchor.quote);
  while (offset !== -1) { candidates.push(offset); offset = text.indexOf(anchor.quote, offset + 1); }
  if (!candidates.length) return null;
  const contextual = candidates.filter(start => {
    const end = start + anchor.quote.length;
    return (anchor.prefix ? text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix : start === 0)
      && (anchor.suffix ? text.slice(end, end + anchor.suffix.length) === anchor.suffix : end === text.length);
  });
  const start = contextual.length === 1 ? contextual[0] : candidates.length === 1 ? candidates[0] : null;
  return start === null ? null : { start, end: start + anchor.quote.length };
}

const html = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const markdown = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~])/g, '\\$1');
function safeUrl(value: string) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
function groups(notes: ReadingAnnotation[], favorites: FavoriteNote[]) {
  const result = new Map<string, { name: string; title: string; url: string; notes: ReadingAnnotation[]; favorites: FavoriteNote[] }>();
  function groupFor(note: FavoriteNote) {
    let group = result.get(note.itemId);
    if (!group) { group = { name: note.itemName, title: note.itemTitle, url: safeUrl(note.itemUrl), notes: [], favorites: [] }; result.set(note.itemId, group); }
    return group;
  }
  for (const note of notes) if (!note.deletedAt) groupFor(note).notes.push(note);
  for (const note of favorites) if (note.body.trim()) groupFor(note).favorites.push(note);
  return [...result.values()];
}

export function exportNotesMarkdown(notes: ReadingAnnotation[], favoriteNotes: FavoriteNote[], exportedAt = new Date().toISOString()): string {
  const lines = ['# 拾光 · 我的笔记', '', `导出时间：${date(exportedAt)}（北京时间）`, ''];
  for (const group of groups(notes, favoriteNotes)) {
    lines.push(`## ${markdown(group.name)}`, '', markdown(group.title), '');
    if (group.url) lines.push(`[产品原始链接](<${group.url.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`, '');
    for (const note of group.notes) {
      lines.push(`### ${note.body ? '我的想法' : '划线摘录'}`, '', `记录时间：${date(note.createdAt)} · 更新：${date(note.updatedAt)}`, '');
      if (note.sourceDate) lines.push(`阅读版本：${note.sourceDate} 简报`, '');
      if (note.quote) lines.push(...note.quote.split('\n').map(line => `> ${markdown(line)}`), '');
      if (note.body) lines.push(markdown(note.body), '');
    }
    for (const note of group.favorites) lines.push('### 收藏备注', '', `更新时间：${date(note.updatedAt)}`, '', markdown(note.body), '');
  }
  return lines.join('\n');
}

export function exportNotesHtml(notes: ReadingAnnotation[], favoriteNotes: FavoriteNote[], exportedAt = new Date().toISOString()): string {
  const sections = groups(notes, favoriteNotes).map(group => `<section><h2>${html(group.name)}</h2><p>${html(group.title)}</p>${group.url ? `<p><a href="${html(group.url)}" rel="noreferrer">产品原始链接</a></p>` : ''}${group.notes.map(note => `<article><h3>${note.body ? '我的想法' : '划线摘录'}</h3><p class="meta">记录：${html(date(note.createdAt))} · 更新：${html(date(note.updatedAt))}${note.sourceDate ? ` · 阅读版本：${html(note.sourceDate)} 简报` : ''}</p>${note.quote ? `<blockquote>${html(note.quote)}</blockquote>` : ''}${note.body ? `<p class="thought">${html(note.body)}</p>` : ''}</article>`).join('')}${group.favorites.map(note => `<article><h3>收藏备注</h3><p class="meta">更新：${html(date(note.updatedAt))}</p><p class="thought">${html(note.body)}</p></article>`).join('')}</section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>拾光 · 我的笔记</title><style>body{margin:0 auto;padding:32px 24px;max-width:900px;color:#203a2b;background:#fff;font:16px/1.8 system-ui,sans-serif}h1{font-size:26px}h2{font-size:22px;border-bottom:1px solid #c8d6cc;padding-bottom:8px}h3{font-size:16px}section{margin-top:36px}article{break-inside:avoid;margin:24px 0}blockquote{margin:12px 0;padding:12px 18px;border-left:4px solid #739069;background:#f1f5ed;white-space:pre-wrap;overflow-wrap:anywhere}.thought{white-space:pre-wrap;overflow-wrap:anywhere}.meta,.hint{font-size:13px;color:#506454}a{color:#285f3b;overflow-wrap:anywhere}@media print{body{padding:0;max-width:none;font-size:12pt}.hint{display:none}a{color:inherit}blockquote{background:#f5f5f5}h2{break-after:avoid}}</style></head><body><h1>拾光 · 我的笔记</h1><p class="meta">导出时间：${html(date(exportedAt))}（北京时间）</p><p class="hint">可使用浏览器的“打印”功能另存为 PDF。本文件含个人笔记，请自行保管。</p>${sections}</body></html>`;
}
