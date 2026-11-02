import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { briefCheckMessage, editionAvailability, feedScopeMatches, githubCheckMessage, readFeedMetadata, shanghaiDay } from '../lib/feed-freshness.ts';

function feed(date, updatedAt = `${date}T00:30:00Z`, status = 'complete') {
  return { items: [], meta: { date, updatedAt, freshness: { today: '2026-11-02', latestEditionDate: date, latestEditionUpdatedAt: updatedAt, latestEditionStatus: status } } };
}

test('Beijing day rolls over at UTC 16:00 independently of the edition date', () => {
  assert.equal(shanghaiDay('2026-11-01T15:59:59.999Z'), '2026-11-01');
  assert.equal(shanghaiDay('2026-11-01T16:00:00.000Z'), '2026-11-02');
  assert.equal(editionAvailability('2026-11-02', '2026-10-31'), 'pending');
  assert.equal(editionAvailability('2026-11-02', ''), 'missing');
});

test('checking an old edition never claims today was generated', () => {
  assert.match(briefCheckMessage(feed('2026-10-31'), feed('2026-10-31')), /今日简报尚未产出，最新一期为 2026-10-31/);
  assert.match(briefCheckMessage(feed('2026-10-31'), feed('2026-11-02')), /今日简报已更新/);
  assert.match(briefCheckMessage(feed('2026-11-02'), feed('2026-11-02')), /暂无新增内容/);
  assert.match(briefCheckMessage(null, feed('2026-11-02', undefined, 'partial')), /部分来源更新/);
  assert.match(githubCheckMessage({checked: 3, partial: true}), /3 个 GitHub 仓库.*简报日期不变/);
});

test('failed reads retain only the same scope, never a historical snapshot under the latest view', () => {
  assert.equal(feedScopeMatches(null, ''), false);
  assert.equal(feedScopeMatches('', ''), true);
  assert.equal(feedScopeMatches('2026-10-30', '2026-10-30'), true);
  // 历史读入后返回今日精选，请求未完成或失败时不可把历史内容当作本期展示。
  assert.equal(feedScopeMatches('2026-10-30', ''), false);
  assert.equal(feedScopeMatches('', '2026-10-30'), false);
  assert.equal(feedScopeMatches('2026-10-30', '2026-10-31'), false);
});

test('checking while viewing history describes the latest date without claiming the body changed', () => {
  const historical = feed('2026-10-30');
  historical.meta.freshness = feed('2026-11-02').meta.freshness;
  const message = briefCheckMessage(feed('2026-10-31'), historical, '2026-11-02', '2026-10-30');
  assert.match(message, /最新简报日期为 2026-11-02；仍在查看 2026-10-30 期/);
  assert.doesNotMatch(message, /已读取.*最新内容/);
});

test('a newer Star run does not replace edition status, date or selected historical content', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE editions(date TEXT PRIMARY KEY,payload TEXT,updated_at TEXT,status TEXT); CREATE TABLE runs(kind TEXT,status TEXT,created_at TEXT);');
  sqlite.prepare('INSERT INTO editions VALUES(?,?,?,?)').run('2026-10-30','[]','2026-10-30T00:30:00Z','complete');
  sqlite.prepare('INSERT INTO editions VALUES(?,?,?,?)').run('2026-10-31','[]','2026-10-31T00:30:00Z','partial');
  sqlite.prepare('INSERT INTO runs VALUES(?,?,?)').run('github_stars','complete','2026-11-02T01:30:00Z');
  const db = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { async first() { return statement.get() ?? null; }, bind(...values) { return { async first() { return statement.get(...values) ?? null; } }; } };
  } };
  try {
    const result = await readFeedMetadata(db, '2026-10-30', '2026-11-02T01:40:00Z');
    assert.equal(result.edition.date, '2026-10-30');
    assert.equal(result.freshness.latestEditionDate, '2026-10-31');
    assert.equal(result.freshness.today, '2026-11-02');
    assert.equal(result.freshness.latestEditionStatus, 'partial');
    assert.equal(result.lastRunStatus, '简报部分来源更新');
    assert.equal(result.freshness.lastStarsCheckedAt, '2026-11-02T01:30:00Z');
    assert.equal((await readFeedMetadata(db, '2026-11-02')).edition, null);
    sqlite.exec('DELETE FROM editions');
    const empty = await readFeedMetadata(db, null, '2026-11-02T01:40:00Z');
    assert.equal(empty.freshness.latestEditionDate, '');
    assert.equal(empty.edition, null);
    assert.equal(empty.lastRunStatus, '尚无简报');
  } finally { sqlite.close(); }
});
