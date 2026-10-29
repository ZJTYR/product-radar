import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { buildHotspotPosterSvg, posterLines, posterText, renderHotspotPoster, selectPosterItems } from '../lib/email-poster.ts';
import { seedItems } from '../lib/seed.ts';

const date = '2026-10-29';
const base = { ...seedItems[0], id: 'poster-product', name: '示例产品', title: '把想法变成可以交付的产品', summary: '围绕实际业务流程提供清晰可用的功能，让使用者直接理解它能解决什么问题。', publishedAt: '2026-10-27', sources: [{ label: '官方资料', url: 'https://example.com/product' }] };
const items = [
  base,
  { ...base, id: 'poster-ai-1', kind: 'ai', name: 'AI Assistant', subtitle: '美国 Pro 用户 Beta', title: '在消息入口继续处理任务' },
  { ...base, id: 'poster-ai-2', kind: 'ai', name: 'Workflow', subtitle: 'Public Preview', title: '跨工具协同完成多步任务' },
  { ...base, id: 'poster-design', kind: 'design', name: '设备界面设计', title: '在画布中设计并交付可编辑的界面代码' },
  { ...base, id: 'poster-news', kind: 'news', name: '产品更新', title: '用真实业务场景展示新的产品能力' },
  { ...base, id: 'poster-overflow', kind: 'ai' },
];

test('poster selects at most five unique current-edition items while retaining available categories', () => {
  const selected = selectPosterItems([...items, base]);
  assert.equal(selected.length, 5);
  assert.equal(new Set(selected.map(item => item.id)).size, 5);
  assert.deepEqual(new Set(selected.map(item => item.kind)), new Set(['product', 'design', 'ai', 'news']));
  assert.ok(!selected.some(item => item.id === 'poster-overflow'));
  assert.equal(selectPosterItems([]).length, 0);
});

test('poster preserves actual publication dates and preview availability without using collection date as publication', () => {
  const { svg } = buildHotspotPosterSvg(date, items);
  assert.ok(svg.includes('发布 2026-10-27'));
  assert.ok(svg.includes('Beta · 美国限定 · Pro 用户'));
  assert.ok(svg.includes('公开预览'));
  assert.ok(svg.includes('商业判断为推断'));
  assert.ok(svg.includes('example.com'));
  const missing = buildHotspotPosterSvg(date, [{ ...base, publishedAt: null, discoveredAt: '2026-10-28T23:00:00Z' }]);
  assert.ok(missing.svg.includes('发布日期未注明'));
  assert.ok(!missing.svg.includes('发布 2026-10-28'));
});

test('poster escapes untrusted text and contains no remote image, font or personal-data dependencies', () => {
  const { svg } = buildHotspotPosterSvg(date, [{ ...base, title: '<script>alert("x")</script> & 产品', summary: '<image href="https://evil.example/pixel" />', sources: [{ label: 'bad', url: 'javascript:alert(1)' }] }]);
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('&amp;'));
  assert.ok(!svg.includes('<script>'));
  assert.ok(!svg.includes('<image'));
  assert.ok(!svg.includes('@font-face'));
  assert.ok(!svg.includes('javascript:'));
  assert.ok(!svg.includes('收藏'));
  assert.ok(!svg.includes('邮箱'));
});

test('poster wraps lengthy titles, shortens excessive copy and handles unsupported glyphs consistently', () => {
  const lines = posterLines('很长的中文标题和EnglishProductName'.repeat(20), 48, 900, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.at(-1).endsWith('…'));
  assert.ok(lines.every(line => line.length < 60));
  assert.equal(posterText('中文 ABC 123 &<>'), '中文 ABC 123 &<>');
  assert.equal(posterText('你好\u0000\u{10ffff}'), '你好 □');
  assert.ok(posterText('产品🧠').includes('□'));
  assert.ok(!posterText('A\u202eB').includes('\u202e'));
});

test('poster uses a bundled licensed font and generates a real PNG whose height follows actual content', () => {
  assert.ok(existsSync(new URL('../assets/fonts/NotoSansSC-Regular.otf', import.meta.url)));
  assert.ok(readFileSync(new URL('../assets/fonts/OFL.txt', import.meta.url), 'utf8').includes('SIL OPEN FONT LICENSE'));
  const one = renderHotspotPoster(date, [base]);
  const five = renderHotspotPoster(date, items);
  for (const poster of [one, five]) {
    const png = Buffer.from(poster.contentBase64, 'base64');
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), poster.height);
    assert.equal(poster.width, 1080);
    assert.equal(poster.contentType, 'image/png');
    assert.equal(poster.filename, 'shiguang-hotspots-2026-10-29.png');
    assert.ok(png.length > 20_000);
    assert.ok(png.length < 2_000_000);
  }
  assert.equal(one.itemCount, 1);
  assert.equal(five.itemCount, 5);
  assert.ok(five.height > one.height);
});

test('poster refuses empty editions and invalid dates instead of returning a blank or mislabeled image', () => {
  assert.throws(() => renderHotspotPoster(date, []), /没有可生成/);
  for (const value of ['2026-02-30', 'not-a-date', '<script>', '2026-1-1']) assert.throws(() => buildHotspotPosterSvg(value, [base]), /日期无效/);
});
