import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnnotationBlocks, createAnnotationAnchor, resolveAnnotationAnchor, exportNotesMarkdown, exportNotesHtml } from '../lib/annotations.ts';
import { seedItems } from '../lib/seed.ts';

test('reading blocks match displayed workflow splitting and keep stable field identifiers', () => {
  const item = { ...seedItems[0], workflow: '输入 →  检查 -> 输出', scenario: '使用示例：一次演示。' };
  const blocks = getAnnotationBlocks(item);
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.deepEqual(blocks.filter(block => block.id.startsWith('workflow.')).map(block => block.text), ['输入', '检查', '输出']);
  assert.equal(blocks.find(block => block.id === 'audience').text, item.audience);
  assert.equal(blocks.find(block => block.id === 'caveatIntro').text, item.caveats[0]);
  assert.equal(blocks.find(block => block.id === 'facts.0').text, item.facts[0]);
});

test('anchors recover exact quotes after prefix edits but never attach to an ambiguous or changed quote', () => {
  const text = '产品经理可以先验证业务需求，再做原型。';
  const start = text.indexOf('验证业务需求');
  const anchor = createAnnotationAnchor('audience', text, start, start + 6);
  assert.deepEqual(resolveAnnotationAnchor(anchor, text), { start, end: start + 6 });
  assert.deepEqual(resolveAnnotationAnchor(anchor, `更新：${text}`), { start: start + 3, end: start + 9 });
  assert.equal(resolveAnnotationAnchor(anchor, text.replace('验证业务需求', '分析市场定位')), null);
  const ambiguous = { ...anchor, prefix: '不存在的上下文', suffix: '也不存在' };
  assert.equal(resolveAnnotationAnchor(ambiguous, '验证业务需求，然后验证业务需求'), null);
  const repeated = '左边的机会。右边的机会。';
  const second = createAnnotationAnchor('opportunity', repeated, repeated.lastIndexOf('机会'), repeated.lastIndexOf('机会') + 2);
  assert.deepEqual(resolveAnnotationAnchor(second, repeated), { start: second.start, end: second.end });
  assert.throws(() => createAnnotationAnchor('audience', text, -1, 2), RangeError);
});

const at = '2026-10-27T04:00:00.000Z';
const note = { id: 'note1', itemId: 'product1', itemName: '产品 <script>', itemTitle: '工作流与设计', itemUrl: 'https://example.com/?a=1&b=2', sourceDate: '2026-10-26', anchors: [], quote: '选中的第一段\n\n选中的第二段', body: '我的想法 <script>alert(1)</script>\n下一步：做一个小验证。', createdAt: at, updatedAt: at, version: 'v1', deletedAt: null };
const favorite = { itemId: 'product2', itemName: '旧收藏', itemTitle: '原来的收藏备注', itemUrl: 'javascript:alert(2)', body: '原备注不丢失', createdAt: at, updatedAt: at };

test('Markdown exports preserve quotes, thoughts, old favorite notes and version dates while excluding deletions', () => {
  const value = exportNotesMarkdown([note, { ...note, id: 'deleted', body: '不可导出已删除笔记', deletedAt: at }], [favorite], at);
  assert.ok(value.includes('> 选中的第一段\n> \n> 选中的第二段'));
  assert.ok(value.includes('下一步：做一个小验证。'));
  assert.ok(value.includes('2026-10-26 简报'));
  assert.ok(value.includes('原备注不丢失'));
  assert.ok(value.includes('https://example.com/?a=1&b=2'));
  assert.ok(!value.includes('<script>'));
  assert.ok(!value.includes('不可导出已删除笔记'));
  assert.ok(!value.includes('javascript:'));
});

test('printable HTML treats notes as text and stays self contained without scripts or unsafe links', () => {
  const value = exportNotesHtml([note], [favorite], at);
  assert.ok(value.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(value.includes('default-src \'none\''));
  assert.ok(value.includes('@media print'));
  assert.ok(value.includes('原备注不丢失'));
  assert.ok(value.includes('<blockquote>选中的第一段\n\n选中的第二段</blockquote>'));
  assert.ok(!value.includes('<script>'));
  assert.ok(!value.includes('href="javascript:'));
});
