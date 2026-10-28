import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendItems } from '../lib/recommendations.ts';
import { frontierEventTime, recentFrontierItems } from '../lib/frontier.ts';
import { itemSchema, catalogSchema } from '../lib/validation.ts';
import { itemSchema as collectorItemSchema } from '../collector-site/lib/validation.ts';
import { seedItems } from '../lib/seed.ts';

const at = Date.parse('2026-10-28T11:00:00+08:00');
const item = (id, overrides = {}) => ({ ...seedItems[0], id, kind: 'news', newsTopic: 'technology', publishedAt: '2026-10-27', discoveredAt: '2026-10-28T02:00:00Z', ...overrides });
const ai = (id, overrides = {}) => item(id, { kind: 'ai', newsTopic: undefined, aiApplication: 'agents', ...overrides });
const recommend = (items, options = {}, feedback = [], saved = []) => recommendItems(items, feedback, saved, 6, at, { scope: 'frontier', ...options });

test('frontier fills six slots with unread AI, technology and product news before read fallbacks', () => {
  const items = [ai('read-ai'), item('product', { newsTopic: 'product' }), item('tech'), ai('unread-ai'), item('read-tech'), item('read-product', { newsTopic: 'product' }), ai('older-read-ai', { publishedAt: '2026-10-22' })];
  const result = recommend(items, { readItems: ['read-ai', 'read-tech', 'read-product', 'older-read-ai'].map(itemId => ({ itemId, readAt: '2026-10-28T00:00:00Z' })) });
  assert.deepEqual(result.items.map(item => item.id), ['unread-ai', 'tech', 'product', 'read-ai', 'older-read-ai', 'read-tech']);
  assert.equal(result.remaining, 7);
});

test('reading or saving every frontier item keeps recent coverage; explicit dismissals still exclude it', () => {
  const items = Array.from({ length: 8 }, (_, i) => ai(`ai-${i}`));
  const readItems = items.map(({ id }) => ({ itemId: id, readAt: '2026-10-28T00:00:00Z' }));
  const saved = items.map(({ id }) => ({ itemId: id }));
  const result = recommend(items, { readItems, excludeIds: ['ai-7'] }, [{ itemId: 'ai-0', action: 'not_interested' }, { itemId: 'ai-1', action: 'interested' }], saved);
  assert.equal(result.items.length, 6);
  assert.ok(result.items.some(item => item.id === 'ai-1'));
  assert.ok(!result.items.some(item => item.id === 'ai-0' || item.id === 'ai-7'));
});

test('no AI candidates still yields six genuine technology and product events, without treating product profiles as news', () => {
  const items = Array.from({ length: 6 }, (_, i) => item(`news-${i}`, { newsTopic: i < 3 ? 'technology' : 'product' }));
  items.push(item('long-lived-product', { kind: 'product', newsTopic: undefined }), ai('unclassified', { aiApplication: undefined }));
  assert.equal(recommend(items).items.length, 6);
  assert.equal(recommend(items).remaining, 6);
  assert.deepEqual(recommend(items.slice(0, 2)).items.map(item => item.id), ['news-0', 'news-1']);
});

test('recent news uses seven Beijing calendar days and real publication time, excludes future and newly collected old stories', () => {
  const items = [item('first-day', { publishedAt: '2026-10-22' }), item('too-old', { publishedAt: '2026-10-21T23:59:59+08:00' }), item('future', { publishedAt: '2026-10-28T12:00:00+08:00' }), item('old-recollected', { publishedAt: '2026-09-01' })];
  assert.deepEqual(recentFrontierItems(items, at).map(item => item.id), ['first-day']);
  const midnight = Date.parse('2026-10-28T00:05:00+08:00');
  assert.equal(frontierEventTime(item('today', { publishedAt: '2026-10-28' })), Date.parse('2026-10-28T00:00:00+08:00'));
  assert.equal(recentFrontierItems([item('today', { publishedAt: '2026-10-28' })], midnight).length, 1);
  assert.equal(recentFrontierItems([items[0]], Date.parse('2026-10-29T00:01:00+08:00')).length, 0);
});

test('frontier deduplicates stable IDs and leaves ordinary product recommendation read exclusion unchanged', () => {
  assert.equal(recommend([ai('same'), ai('same')]).items.length, 1);
  const product = item('product', { kind: 'product', newsTopic: undefined });
  assert.equal(recommendItems([product], [], [], 6, at, { scope: 'products', readItems: [{ itemId: 'product', readAt: '2026-10-28T00:00:00Z' }] }).items.length, 0);
});

test('collector and production accept the same dated news contract and reject unclassified or undated news', () => {
  const record = item('verified-product-release', { newsTopic: 'product' });
  for (const schema of [itemSchema, collectorItemSchema]) {
    assert.equal(schema.safeParse(record).success, true);
    assert.equal(schema.safeParse({ ...record, newsTopic: undefined }).success, false);
    assert.equal(schema.safeParse({ ...record, newsTopic: 'rumor' }).success, false);
    assert.equal(schema.safeParse({ ...record, publishedAt: null }).success, false);
    assert.equal(schema.safeParse(ai('legacy-ai', { publishedAt: null })).success, true);
  }
  const parsed = catalogSchema.parse({ items: [record] });
  assert.equal(parsed.items[0].newsTopic, 'product');
  assert.equal(parsed.items[0].publishedAt, '2026-10-27');
});
