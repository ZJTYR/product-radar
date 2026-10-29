import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { IntelItem, ItemKind } from './types.ts';

const WIDTH = 1080;
const FONT_FAMILY = 'Noto Sans SC';
const fontPath = () => join(process.cwd(), 'assets/fonts/NotoSansSC-Regular.otf');
const CONTENT_WIDTH = 900;
const MAX_ITEMS = 5;
const palette: Record<ItemKind, { label: string; color: string; tint: string }> = {
  product: { label: '产品发现', color: '#285a45', tint: '#e7efdf' },
  design: { label: '设计灵感', color: '#805421', tint: '#f6ecd5' },
  ai: { label: 'AI 应用', color: '#515a96', tint: '#ececf7' },
  news: { label: '前沿动态', color: '#3c6675', tint: '#e3eff2' },
};

type FontInfo = { buffer: Buffer; glyph: (point: number) => number; advance: (glyph: number) => number; units: number };
let fontCache: FontInfo | undefined;

/** 读取随应用发布的字库，同时用它的 cmap/hmtx 做换行与缺字判断。 */
function fontInfo(): FontInfo {
  if (fontCache) return fontCache;
  const buffer = readFileSync(fontPath());
  const tables = new Map<string, number>();
  for (let i = 0; i < buffer.readUInt16BE(4); i++) {
    const start = 12 + i * 16;
    tables.set(buffer.toString('ascii', start, start + 4), buffer.readUInt32BE(start + 8));
  }
  const table = (name: string) => { const offset = tables.get(name); if (offset === undefined) throw new Error(`海报字体缺少 ${name} 表。`); return offset; };
  const cmap = table('cmap');
  let format4 = 0;
  let format12 = 0;
  for (let i = 0; i < buffer.readUInt16BE(cmap + 2); i++) {
    const offset = cmap + buffer.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buffer.readUInt16BE(offset);
    if (format === 4) format4 = offset;
    if (format === 12) format12 = offset;
  }
  const glyph = (point: number): number => {
    if (format12) {
      let low = 0;
      let high = buffer.readUInt32BE(format12 + 12) - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const group = format12 + 16 + mid * 12;
        const first = buffer.readUInt32BE(group);
        const last = buffer.readUInt32BE(group + 4);
        if (point < first) high = mid - 1;
        else if (point > last) low = mid + 1;
        else return buffer.readUInt32BE(group + 8) + point - first;
      }
    }
    if (format4 && point <= 0xffff) {
      const segments = buffer.readUInt16BE(format4 + 6) / 2;
      const end = format4 + 14;
      const start = end + segments * 2 + 2;
      const delta = start + segments * 2;
      const ranges = delta + segments * 2;
      for (let i = 0; i < segments; i++) {
        if (point > buffer.readUInt16BE(end + i * 2)) continue;
        const first = buffer.readUInt16BE(start + i * 2);
        if (point < first) return 0;
        const difference = buffer.readInt16BE(delta + i * 2);
        const range = buffer.readUInt16BE(ranges + i * 2);
        const value = range ? buffer.readUInt16BE(ranges + i * 2 + range + (point - first) * 2) : point;
        return value ? (value + difference) & 0xffff : 0;
      }
    }
    return 0;
  };
  const metrics = table('hmtx');
  const count = buffer.readUInt16BE(table('hhea') + 34);
  fontCache = { buffer, glyph, advance: value => buffer.readUInt16BE(metrics + Math.min(value, count - 1) * 4), units: buffer.readUInt16BE(table('head') + 18) };
  return fontCache;
}

/** 未覆盖字符显示方框，消除系统字体差异；换行、控制字符统一为空格。 */
export function posterText(value: string): string {
  const font = fontInfo();
  return Array.from(value.normalize('NFC').replace(/[\p{Cc}\p{Cf}\uFE00-\uFE0F]/gu, ' ')).map(char => /\s/u.test(char) ? ' ' : font.glyph(char.codePointAt(0)!) ? char : '□').join('').replace(/\s+/g, ' ').trim();
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
function measure(value: string, size: number): number {
  const font = fontInfo();
  return Array.from(value).reduce((sum, char) => sum + font.advance(font.glyph(char.codePointAt(0)!)) / font.units * size, 0);
}

/** 使用真实字宽限制行数，给 SVG 字形的边缘留出少量余量。 */
export function posterLines(value: string, size: number, width: number, maxLines: number): string[] {
  const text = posterText(value);
  const raw = text.match(/[\p{Script=Latin}\p{N}\p{M}]+(?:[./_+-][\p{Script=Latin}\p{N}\p{M}]+)*|\s+|./gu) || [];
  const tokens: string[] = [];
  for (const token of raw) {
    if (/^[，。；：！？、）》」』】…,.!?;:)\]]+$/u.test(token) && tokens.length) tokens[tokens.length - 1] += token;
    else if (measure(token, size) > width - 8) tokens.push(...Array.from(token));
    else tokens.push(token);
  }
  const lines: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (current.length && measure(current.join('') + token, size) > width - 8) {
      lines.push(current);
      current = [];
      if (lines.length === maxLines) {
        let last = lines.pop()!.join('').trim();
        while (last && measure(last + '…', size) > width - 8) last = Array.from(last).slice(0, -1).join('');
        return [...lines.map(line => line.join('').trim()), last.trimEnd() + '…'];
      }
    }
    if (current.length || token.trim()) current.push(token);
  }
  if (current.length) lines.push(current);
  // 最后一行过短时与上一行均衡，避免标题最后只剩一个字、正文只剩句号。
  if (lines.length > 1) {
    const last = lines[lines.length - 1];
    const previous = lines[lines.length - 2];
    while (previous.length > 1 && measure(last.join(''), size) < width * 0.4) {
      const token = previous[previous.length - 1];
      const before = previous.slice(0, -1).join('');
      if (measure(before, size) < width * 0.4 || measure(token + last.join(''), size) > width - 8) break;
      last.unshift(previous.pop()!);
    }
  }
  return lines.length ? lines.map(line => line.join('').trim()) : [''];
}

/** 先保留本期各类首条，余位沿用简报顺序；只从本期内容选取。 */
export function selectPosterItems(items: IntelItem[]): IntelItem[] {
  const unique = items.filter((item, index) => item.id && items.findIndex(value => value.id === item.id) === index);
  const selected: IntelItem[] = [];
  for (const kind of ['product', 'design', 'ai', 'news'] as const) {
    const item = unique.find(value => value.kind === kind);
    if (item) selected.push(item);
  }
  for (const item of unique) {
    if (selected.length >= MAX_ITEMS) break;
    if (!selected.includes(item)) selected.push(item);
  }
  return selected;
}

function publishedDate(item: IntelItem): string {
  if (!item.publishedAt) return '发布日期未注明';
  const value = new Date(item.publishedAt);
  if (!Number.isFinite(value.getTime())) return '发布日期未注明';
  return `发布 ${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)}`;
}
function availability(item: IntelItem): string {
  const text = `${item.subtitle} ${item.title}`;
  const values: string[] = [];
  if (/public\s*preview|公开预览/i.test(text)) values.push('公开预览');
  else if (/preview|预览版/i.test(text)) values.push('预览版');
  if (/beta|公测|测试版/i.test(text)) values.push('Beta');
  if (/美国/.test(text)) values.push('美国限定');
  if (/pro\s*用户/i.test(text)) values.push('Pro 用户');
  if (/路线图|预告|即将推出/.test(text)) values.push('预告 / 计划');
  return values.join(' · ');
}
function sourceLabel(item: IntelItem): string {
  const source = item.sources.find(value => { try { return ['https:', 'http:'].includes(new URL(value.url).protocol); } catch { return false; } });
  if (!source) return '来源见工作台';
  const url = new URL(source.url);
  return `来源 ${url.hostname.replace(/^www\./, '')}`;
}
const textLines = (lines: string[], x: number, y: number, size: number, lineHeight: number, color: string) => lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-size="${size}" fill="${color}">${escape(line)}</text>`).join('');

export interface HotspotPoster { contentBase64: string; contentType: 'image/png'; filename: string; width: number; height: number; itemCount: number }
export interface PosterSvg { svg: string; width: number; height: number; itemCount: number }

/** 仅根据冻结的公开简报生成海报，不读取个人数据，也不拉取任何外部图片。 */
export function buildHotspotPosterSvg(date: string, items: IntelItem[]): PosterSvg {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('海报日期无效。');
  const selected = selectPosterItems(items);
  if (!selected.length) throw new Error('当天简报没有可生成海报的内容。');
  let top = 342;
  const cards = selected.map((item, index) => {
    const kind = palette[item.kind];
    const name = posterLines(item.name, 38, 700, 1);
    const title = posterLines(item.title, 48, CONTENT_WIDTH, 2);
    const summary = posterLines(item.summary, 38, CONTENT_WIDTH, 3);
    const status = availability(item);
    const meta = posterLines([publishedDate(item), status].filter(Boolean).join(' · '), 28, CONTENT_WIDTH, 2);
    const source = posterLines(sourceLabel(item), 25, CONTENT_WIDTH, 1);
    let baseline = top + 122;
    const nameText = textLines(name, 90, baseline, 38, 46, '#486052');
    baseline += 60;
    const titleText = textLines(title, 90, baseline, 48, 64, '#173e32');
    baseline += (title.length - 1) * 64 + 64;
    const summaryText = textLines(summary, 90, baseline, 38, 55, '#354e42');
    baseline += (summary.length - 1) * 55 + 60;
    const metaText = textLines(meta, 90, baseline, 28, 40, '#617264');
    baseline += (meta.length - 1) * 40 + 42;
    const sourceText = textLines(source, 90, baseline, 25, 36, '#617264');
    const height = baseline - top + 36;
    const result = `<g><rect x="48" y="${top}" width="984" height="${height}" rx="28" fill="#ffffff" stroke="#dce3d5" stroke-width="2"/><rect x="80" y="${top + 28}" width="186" height="43" rx="12" fill="${kind.tint}"/><text x="98" y="${top + 59}" font-size="28" fill="${kind.color}">${kind.label}</text><text x="986" y="${top + 65}" text-anchor="end" font-size="40" fill="#a2b29b">${String(index + 1).padStart(2, '0')}</text>${nameText}${titleText}${summaryText}${metaText}${sourceText}</g>`;
    top += height + 26;
    return result;
  }).join('');
  const height = top + 176;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><title>${escape(date)} 拾光热点海报</title><rect width="${WIDTH}" height="${height}" fill="#f1f3e8"/><g font-family="${FONT_FAMILY}"><rect x="0" y="0" width="${WIDTH}" height="302" fill="#173f33"/><circle cx="985" cy="58" r="172" fill="#244e3e"/><circle cx="985" cy="58" r="116" fill="#2d5944"/><text x="54" y="73" font-size="34" fill="#dceaa9">拾光 · 热点海报</text><text x="1026" y="73" font-size="31" text-anchor="end" fill="#eef2df">${date.replaceAll('-', '.')}</text><text x="50" y="179" font-size="76" fill="#ffffff">今天，值得关注</text><text x="55" y="250" font-size="32" fill="#dce8cf">${selected.length} 条精选 · 产品发现 / AI 应用 / 设计灵感</text>${cards}<text x="54" y="${top + 44}" font-size="28" fill="#3b5944">公开资料整理 · 商业判断为推断</text><text x="54" y="${top + 94}" font-size="27" fill="#657761">日期为本期简报日期，实际发布日期见各条目</text><text x="54" y="${top + 143}" font-size="27" fill="#657761">完整来源与解读保存在拾光工作台</text></g></svg>`;
  return { svg, width: WIDTH, height, itemCount: selected.length };
}

export function renderHotspotPoster(date: string, items: IntelItem[]): HotspotPoster {
  const poster = buildHotspotPosterSvg(date, items);
  const renderer = new Resvg(poster.svg, { font: { fontFiles: [fontPath()], loadSystemFonts: false, defaultFontFamily: FONT_FAMILY, sansSerifFamily: FONT_FAMILY }, background: '#f1f3e8' });
  const png = renderer.render().asPng();
  if (png.length < 1000) throw new Error('热点海报生成失败。');
  return { contentBase64: png.toString('base64'), contentType: 'image/png', filename: `shiguang-hotspots-${date}.png`, width: poster.width, height: poster.height, itemCount: poster.itemCount };
}
