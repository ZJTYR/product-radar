import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RadarDatabase } from '../lib/database.ts';
import {
  nextEmailTarget, saveEmailPreferences, storedEmailPreferences, emailScheduleStatus,
  emailScheduleRow, ensureEmailSchedule, attemptScheduledEmail, registerEmailContinuation,
} from '../lib/email-schedule-store.ts';

const at = '2026-10-29T11:00:00.000Z';
const prefs = { email: 'reader@example.com', deliveryTime: '20:00', emailEnabled: true };
async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'radar-schedule-'));
  const path = join(directory, 'schedule.sqlite');
  const db = new RadarDatabase(undefined, path);
  const calls = { started: [], cancelled: [], statuses: [] };
  const runtime = {
    async start(user, generation, target) { const id = `run_${calls.started.length + 1}`; calls.started.push({ user, generation, target, id }); return id; },
    async cancel(id) { calls.cancelled.push(id); },
    async status(id) { calls.statuses.push(id); return 'running'; },
  };
  const options = { at, runtime, deploymentId: 'test-deployment' };
  try { await run({ db, path, calls, runtime, options }); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}
async function markHandled(db, status = 'accepted') {
  await db.prepare("INSERT INTO email_deliveries(id,user_id,kind,dedupe_key,edition_date,edition_version,recipient,payload,status,request_id,message_id,created_at,updated_at) VALUES('daily','owner','daily','2026-10-29','2026-10-29','v1','reader@example.com','{}',?,'2026-10-29','<daily@radar.local>',?,?)").bind(status, at, at).run();
}

test('next targets use Beijing time, midnight and already handled dates', () => {
  assert.equal(nextEmailTarget(at, '20:00'), '2026-10-29T12:00:00.000Z');
  assert.equal(nextEmailTarget('2026-10-29T12:01:00Z', '20:00'), '2026-10-29T12:01:01.000Z');
  assert.equal(nextEmailTarget(at, '20:00', true), '2026-10-30T12:00:00.000Z');
  assert.equal(nextEmailTarget('2026-10-29T15:59:00Z', '00:00', true), '2026-10-29T16:00:00.000Z');
  assert.equal(nextEmailTarget('2026-10-29T16:00:00Z', '00:00', true), '2026-10-30T16:00:00.000Z');
  assert.throws(() => nextEmailTarget(at, '25:00'));
});

test('saving a custom time creates a real task and changing it cancels the old generation', async () => fixture(async ({ db, calls, options }) => {
  const initial = await saveEmailPreferences(db, 'owner', prefs, options);
  assert.deepEqual(initial, { status: 'scheduled', nextRunAt: '2026-10-29T12:00:00.000Z', deliveryTime: '20:00', timeZone: 'Asia/Shanghai' });
  const first = await emailScheduleRow(db, 'owner');
  const changed = await saveEmailPreferences(db, 'owner', { ...prefs, deliveryTime: '21:15' }, options);
  assert.equal(changed.nextRunAt, '2026-10-29T13:15:00.000Z');
  assert.notEqual((await emailScheduleRow(db, 'owner')).generation, first.generation);
  assert.deepEqual(calls.cancelled, ['run_1']);
  assert.equal((await storedEmailPreferences(db, 'owner')).deliveryTime, '21:15');
}));

test('pausing disables preferences before cancellation and starts no replacement', async () => fixture(async ({ db, calls, runtime, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  const old = await emailScheduleRow(db, 'owner');
  runtime.cancel = async id => { assert.equal((await storedEmailPreferences(db, 'owner')).emailEnabled, false); calls.cancelled.push(id); };
  const stopped = await saveEmailPreferences(db, 'owner', { ...prefs, emailEnabled: false }, options);
  assert.equal(stopped.status, 'paused'); assert.equal(stopped.nextRunAt, null);
  assert.equal(calls.started.length, 1);
  let sent = 0;
  assert.deepEqual(await attemptScheduledEmail(db, 'owner', old.generation, old.run_id, async () => { sent++; }, { at: '2026-10-29T12:00:00Z' }), { active: false });
  assert.equal(sent, 0);
}));

test('today accepted or unknown goes directly to tomorrow even before the selected time', async () => fixture(async ({ db, options, calls }) => {
  await markHandled(db);
  const result = await saveEmailPreferences(db, 'owner', prefs, options);
  assert.equal(result.nextRunAt, '2026-10-30T12:00:00.000Z');
  await db.prepare("UPDATE email_deliveries SET status='unknown'").run();
  const changed = await saveEmailPreferences(db, 'owner', { ...prefs, deliveryTime: '21:00' }, options);
  assert.equal(changed.nextRunAt, '2026-10-30T13:00:00.000Z');
  assert.equal(calls.started.length, 2);
}));

test('a rejected task creation is visible while saved preferences remain intact', async () => fixture(async ({ db, runtime, options }) => {
  runtime.start = async () => { throw new Error('private upstream failure'); };
  const result = await saveEmailPreferences(db, 'owner', prefs, options);
  assert.equal(result.status, 'error');
  assert.ok(result.errorMessage.includes('暂未安排成功'));
  assert.ok(!result.errorMessage.includes('private'));
  assert.deepEqual(await storedEmailPreferences(db, 'owner'), prefs);
}));

test('daily ingestion reuses an active task and replaces a stopped or older deployment task', async () => fixture(async ({ db, calls, runtime, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  await ensureEmailSchedule(db, 'owner', options);
  assert.equal(calls.started.length, 1);
  runtime.status = async () => 'failed';
  await ensureEmailSchedule(db, 'owner', options);
  assert.equal(calls.started.length, 2);
  await ensureEmailSchedule(db, 'owner', { ...options, deploymentId: 'new-deployment' });
  assert.equal(calls.started.length, 3);
}));

test('concurrent ingestion claims only one new schedule generation', async () => fixture(async ({ db, calls, options }) => {
  await db.prepare('INSERT INTO preferences(user_id,email,delivery_time,email_enabled) VALUES(?,?,?,1)').bind('owner', prefs.email, prefs.deliveryTime).run();
  const results = await Promise.all([ensureEmailSchedule(db, 'owner', options), ensureEmailSchedule(db, 'owner', options)]);
  assert.equal(calls.started.length, 1);
  assert.ok(results.every(value => ['starting', 'scheduled'].includes(value.status)));
}));

test('schedule status inspection never starts a workflow or invokes email', async () => fixture(async ({ db, calls, runtime, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  runtime.status = async () => 'cancelled';
  const result = await emailScheduleStatus(db, 'owner', { ...options, inspect: true });
  assert.equal(result.status, 'error');
  assert.equal(calls.started.length, 1);
  assert.equal((await emailScheduleRow(db, 'owner')).status, 'scheduled');
}));

test('an obsolete generation never reaches the email sender', async () => fixture(async ({ db, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  const old = await emailScheduleRow(db, 'owner');
  await saveEmailPreferences(db, 'owner', { ...prefs, deliveryTime: '21:00' }, options);
  let sends = 0;
  const result = await attemptScheduledEmail(db, 'owner', old.generation, old.run_id, async () => { sends++; }, { at: '2026-10-29T14:00:00Z' });
  assert.equal(result.active, false); assert.equal(sends, 0);
}));

test('due execution uses the current day and schedules tomorrow after a definitive outcome', async () => fixture(async ({ db, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  const row = await emailScheduleRow(db, 'owner');
  let args;
  const result = await attemptScheduledEmail(db, 'owner', row.generation, row.run_id, async (...values) => { args = values; return { delivery: { status: 'accepted' }, replayed: false }; }, { at: '2026-10-29T12:00:00Z' });
  assert.equal(args[2], '2026-10-29'); assert.equal(args[3].automatic, true);
  assert.deepEqual(result, { active: true, nextRunAt: '2026-10-30T12:00:00.000Z', retryToday: false });
}));

test('19:59 sleeps to the configured minute without sending early', async () => fixture(async ({ db, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  const row = await emailScheduleRow(db, 'owner'); let sends = 0;
  const result = await attemptScheduledEmail(db, 'owner', row.generation, row.run_id, async () => { sends++; }, { at: '2026-10-29T11:59:59Z' });
  assert.equal(sends, 0); assert.equal(result.nextRunAt, '2026-10-29T12:00:00.000Z');
}));

test('missing current content or a pending version race retries only within the same Beijing day', async () => fixture(async ({ db, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options);
  const row = await emailScheduleRow(db, 'owner');
  const waiting = await attemptScheduledEmail(db, 'owner', row.generation, row.run_id, async () => ({ skipped: true, reason: '尚未完整' }), { at: '2026-10-29T12:00:00Z' });
  assert.deepEqual(waiting, { active: true, nextRunAt: '2026-10-29T12:05:00.000Z', retryToday: true });
  assert.equal((await emailScheduleStatus(db, 'owner')).status, 'waiting');
  const late = await attemptScheduledEmail(db, 'owner', row.generation, row.run_id, async () => ({ delivery: { status: 'pending' }, replayed: true }), { at: '2026-10-29T15:58:00Z' });
  assert.equal(late.retryToday, false); assert.equal(late.nextRunAt, '2026-10-30T12:00:00.000Z');
}));

test('daily continuation only adopts a successor for its current generation and run', async () => fixture(async ({ db, options }) => {
  await saveEmailPreferences(db, 'owner', prefs, options); const row = await emailScheduleRow(db, 'owner');
  assert.equal(await registerEmailContinuation(db, 'owner', row.generation, row.run_id, 'run_next', '2026-10-30T12:00:00Z', options), true);
  assert.equal(await registerEmailContinuation(db, 'owner', row.generation, row.run_id, 'run_late', '2026-10-30T12:00:00Z', options), false);
  assert.equal((await emailScheduleRow(db, 'owner')).run_id, 'run_next');
}));

test('legacy 08:30 migration runs once and a later custom 08:30 survives restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'radar-schedule-migrate-')); const path = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE preferences(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,delivery_time TEXT NOT NULL,email_enabled INTEGER NOT NULL DEFAULT 0);INSERT INTO preferences VALUES('owner','reader@example.com','08:30',1)"); old.close();
  const db = new RadarDatabase(undefined, path);
  try {
    assert.equal((await storedEmailPreferences(db, 'owner')).deliveryTime, '20:00');
    assert.equal((await db.prepare("SELECT value FROM settings WHERE key='email_schedule_v1_migration'").first()).value, 'done');
    await db.prepare("UPDATE preferences SET delivery_time='08:30'").run();
    const reopened = new RadarDatabase(undefined, path);
    try { assert.deepEqual(await storedEmailPreferences(reopened, 'owner'), { ...prefs, deliveryTime: '08:30' }); }
    finally { reopened.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('initialization with a completed migration marker never overwrites a custom 08:30', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'radar-schedule-marker-')); const path = join(directory, 'existing.sqlite');
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE preferences(user_id TEXT PRIMARY KEY,email TEXT NOT NULL,delivery_time TEXT NOT NULL,email_enabled INTEGER NOT NULL DEFAULT 0);INSERT INTO preferences VALUES('owner','reader@example.com','08:30',1);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);INSERT INTO settings VALUES('email_schedule_v1_migration','done','2026-10-29T00:00:00Z')"); old.close();
  const first = new RadarDatabase(undefined, path); const second = new RadarDatabase(undefined, path);
  try {
    const values = await Promise.all([storedEmailPreferences(first, 'owner'), storedEmailPreferences(second, 'owner')]);
    assert.ok(values.every(value => value.deliveryTime === '08:30' && value.emailEnabled));
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); }
});
