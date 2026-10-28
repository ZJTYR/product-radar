import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { readFeedMetadata } from '../lib/feed-metadata.ts';
import { briefCheckMessage, editionAvailability, githubCheckMessage, latestEdition, readBriefUpdates, resolveHomeFeatured, selectHomeFeatured, shanghaiDay } from '../lib/home-feed.ts';

const item = (id, extra = {}) => ({ ...seedItems[0], id, name: id, kind: 'product', featured: false, discoveredAt: '2026-10-25T00:00:00Z', ...extra });
const catalog = [item('library-old'), item('edition'), item('pick', { featured: true }), item('library-new', { discoveredAt: '2026-10-26T00:00:00Z' }), item('design', { kind: 'design' }), item('ai', { kind: 'ai' })];
const editionIds = ['edition', 'pick', 'design', 'ai'];
const empty = () => new Set();
const select = (read = [], saved = [], dismissed = [], items = catalog, ids = editionIds) => selectHomeFeatured(items, ids, new Set(read), new Set(saved), new Set(dismissed));
const feed = (date = '2026-10-27', version = '2026-10-27T00:36:00Z', extra = {}) => ({ items: catalog, meta: { date, updatedAt: version, total: 2, editionItemIds: editionIds, freshness: { today: '2026-10-28', checkedAt: '2026-10-28T02:00:00Z', latestEditionDate: date, latestEditionUpdatedAt: version, latestEditionStatus: 'complete', lastStarsCheckedAt: '', lastStarsStatus: '' }, ...extra }, user: { name: 'test', signedIn: true } });

test('featured selection prioritizes this edition, excludes processed products, and uses genuinely older catalog records as fallback', () => {
  assert.equal(select().id, 'pick');
  assert.equal(select(['pick']).id, 'edition');
  const fallback = select(['pick'], ['edition']);
  assert.equal(fallback.id, 'library-new');
  assert.equal(fallback.discoveredAt, '2026-10-26T00:00:00Z');
  assert.ok(!editionIds.includes(fallback.id));
  assert.equal(select(['pick'], ['edition'], ['library-new']).id, 'library-old');
  assert.equal(select(['pick', 'library-old'], ['edition'], ['library-new']), null);
});

test('empty editions and missing product kinds still resolve to a catalog candidate or an honest empty result', () => {
  assert.equal(select([], [], [], catalog, []).id, 'library-new');
  assert.equal(select([], [], [], catalog.filter(entry => entry.kind !== 'product')), null);
  assert.equal(select([], [], [], []), null);
  assert.equal(select([], [], [], catalog, undefined).id, 'pick');
});

test('reading and saving keep the current card until an explicit refresh, while dismissing advances in the same session', () => {
  let current = resolveHomeFeatured(null, false, catalog, editionIds, empty(), empty(), empty());
  assert.equal(current.id, 'pick');
  const read = new Set(['pick']);
  const saved = new Set(['pick']);
  assert.equal(resolveHomeFeatured(current, true, catalog, editionIds, read, saved, empty()), current);
  current = resolveHomeFeatured(current, false, catalog, editionIds, read, saved, empty());
  assert.equal(current.id, 'edition');
  current = resolveHomeFeatured(current, true, catalog, editionIds, read, saved, new Set(['edition']));
  assert.equal(current.id, 'library-new');
  current = resolveHomeFeatured(current, true, catalog, editionIds, read, saved, new Set(['edition', 'library-new']));
  assert.equal(current.id, 'library-old');
  current = resolveHomeFeatured(current, true, catalog, editionIds, read, saved, new Set(['edition', 'library-new', 'library-old']));
  assert.equal(current, null);
  // 恢复划走记录之后，空模块可以重新选择真实候选。
  assert.equal(resolveHomeFeatured(current, true, catalog, editionIds, read, saved, new Set(['edition', 'library-old'])).id, 'library-new');
});

test('Shanghai calendar boundaries are independent of host timezone and distinguish missing, current and pending editions', () => {
  assert.equal(shanghaiDay('2026-10-27T15:59:59.999Z'), '2026-10-27');
  assert.equal(shanghaiDay('2026-10-27T16:00:00.000Z'), '2026-10-28');
  assert.equal(editionAvailability('2026-10-28', '2026-10-27'), 'pending');
  assert.equal(editionAvailability('2026-10-28', '2026-10-28'), 'current');
  assert.equal(editionAvailability('2026-10-28', ''), 'missing');
  assert.equal(editionAvailability('2026-10-28', '2026-10-29'), 'future');
});

test('checking news reports a new edition, same-day revisions, unchanged content and missing daily output separately', () => {
  const previous = feed();
  assert.match(briefCheckMessage(previous, previous), /今日简报尚未产出.*2026-10-27/);
  const current = feed('2026-10-28', '2026-10-28T00:35:00Z');
  assert.match(briefCheckMessage(previous, current), /已读取 2026-10-28 的最新简报/);
  assert.match(briefCheckMessage(current, current), /暂无新增内容/);
  assert.match(briefCheckMessage(current, feed('2026-10-28', '2026-10-28T02:00:00Z')), /已读取/);
  assert.match(briefCheckMessage(previous, feed('', '')), /暂时还没有简报/);
  const historical = feed('2026-10-25', '2026-10-25T00:30:00Z', { freshness: current.meta.freshness });
  assert.deepEqual(latestEdition(historical.meta), latestEdition(current.meta));
  assert.match(briefCheckMessage(historical, current), /暂无新增内容/);
  const partial = feed('2026-10-28');
  partial.meta.freshness.latestEditionStatus = 'partial';
  assert.match(briefCheckMessage(previous, partial), /部分来源更新，其余来源仍待补充/);
  assert.match(briefCheckMessage(partial, partial), /暂无新增内容，部分来源仍待补充/);
});

test('a failed source is not classified as no new content, and successful partial reads remain available', async () => {
  const current = feed();
  const result = await readBriefUpdates({ feed: async () => current, reading: async () => false, interest: async () => { throw new Error('offline'); }, history: async () => ({ days: ['2026-10-27'] }) });
  assert.equal(result.feed, current);
  assert.deepEqual(result.history.days, ['2026-10-27']);
  assert.deepEqual(result.failures, ['阅读记录尚未核对完成', '收藏、偏好与推荐尚未核对完成']);
  const failed = await readBriefUpdates({ feed: async () => null, reading: async () => true, interest: async () => true, history: async () => { throw new Error('offline'); } });
  assert.equal(failed.feed, null);
  assert.equal(failed.history, null);
  assert.deepEqual(failed.failures, ['简报资料读取失败', '简报档案读取失败']);
});

test('a brief check waits for the latest reading and feedback results before reporting completion', async () => {
  let finishReading;
  let finishInterest;
  let completed = false;
  const pending = readBriefUpdates({ feed: async () => feed(), reading: () => new Promise(resolve => { finishReading = resolve; }), interest: () => new Promise(resolve => { finishInterest = resolve; }), history: async () => ({ days: [] }) }).then(result => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  finishReading(true);
  await Promise.resolve();
  assert.equal(completed, false);
  finishInterest(true);
  const result = await pending;
  assert.equal(completed, true);
  assert.deepEqual(result.failures, []);
});

test('GitHub feedback uses successful repository count and does not claim daily content production', () => {
  assert.match(githubCheckMessage({ checked: 15, partial: false }), /15 个 GitHub 仓库的 Star；简报日期不变/);
  assert.match(githubCheckMessage({ checked: 2, partial: true }), /2 个 GitHub 仓库，部分来源暂不可用/);
});

test('live metadata keeps latest edition separate from the selected history and a newer Star run', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'radar-feed-meta-'));
  const db = new RadarDatabase(undefined, join(directory, 'fixture.sqlite'));
  try {
    await db.batch([
      db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES(?,?,?,?)').bind('2026-10-26', '[]', '2026-10-26T00:30:00Z', 'complete'),
      db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES(?,?,?,?)').bind('2026-10-27', '[]', '2026-10-27T00:36:00Z', 'partial'),
      db.prepare('INSERT INTO runs(id,kind,status,detail,created_at) VALUES(?,?,?,?,?)').bind('stars', 'github_stars', 'complete', '{}', '2026-10-28T02:31:00Z'),
    ]);
    const result = await readFeedMetadata(db, '2026-10-26', '2026-10-28T02:40:00Z');
    assert.equal(result.edition.date, '2026-10-26');
    assert.equal(result.freshness.latestEditionDate, '2026-10-27');
    assert.equal(result.freshness.latestEditionStatus, 'partial');
    assert.equal(result.freshness.today, '2026-10-28');
    assert.equal(result.freshness.lastStarsCheckedAt, '2026-10-28T02:31:00Z');
    assert.equal(result.freshness.lastStarsStatus, 'complete');
    assert.equal(result.lastRunStatus, '简报部分来源更新');
    assert.equal((await readFeedMetadata(db, undefined, '2026-10-28T02:40:00Z')).edition.date, '2026-10-27');
    assert.equal((await readFeedMetadata(db, '2026-10-28')).edition, null);
    await db.prepare('DELETE FROM editions').run();
    const emptyState = await readFeedMetadata(db, undefined, '2026-10-28T02:40:00Z');
    assert.equal(emptyState.edition, null);
    assert.equal(emptyState.freshness.latestEditionDate, '');
    assert.equal(emptyState.lastRunStatus, '尚无简报');
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
