import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { emailReadiness, smtpFailure } from '../lib/email-smtp.ts';
import { dailyEmail } from '../lib/email-template.ts';
import { EmailDeliveryError, emailDay, emailStatus, retryEmail, sendDailyEmail, sendTestEmail } from '../lib/email-store.ts';

const at = '2026-10-29T01:00:00.000Z';
const date = '2026-10-29';
const recipient = 'reader@example.com';
const item = { ...seedItems[0], id: 'email-product', title: '公开简报条目', summary: '公开产品摘要' };
const opts = sender => ({ ready: true, at, sender });
const accepted = async message => ({ accepted: true, messageId: message.messageId });
const statusIs = status => error => error instanceof EmailDeliveryError && error.status === status;
async function fixture(run, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'radar-email-'));
  const path = join(directory, 'mail.sqlite');
  const db = new RadarDatabase(undefined, path);
  try {
    await db.batch([
      db.prepare('INSERT INTO preferences(user_id,email,delivery_time,email_enabled) VALUES(?,?,?,?)').bind('owner', recipient, '08:30', overrides.enabled ?? 1),
      db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES(?,?,?,?)').bind(date, JSON.stringify(overrides.items ?? [item]), at, overrides.status ?? 'complete'),
    ]);
    await run(db, path);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

test('SMTP readiness requires a real complete TLS configuration', () => {
  const env = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'sender@example.com', SMTP_PASS: 'private-authorization', MAIL_FROM: 'sender@example.com' };
  assert.equal(emailReadiness(env).deliveryReady, true);
  assert.equal(emailReadiness({ ...env, SMTP_PASS: '' }).deliveryReady, false);
  assert.equal(emailReadiness({ ...env, SMTP_PORT: '465', SMTP_SECURE: 'false' }).deliveryReady, false);
  assert.equal(emailReadiness({ ...env, MAIL_FROM: 'Header\r\nInjected' }).deliveryReady, false);
  assert.equal(emailReadiness({ ...env, SMTP_PORT: '587', SMTP_SECURE: 'false' }).deliveryReady, true);
  assert.equal(emailDay('2026-10-28T16:01:00Z'), date);
});

test('daily email freezes its public edition payload and recipient and survives repeat ingestion and restart', async () => fixture(async (db, path) => {
  let sends = 0;
  let captured;
  const first = await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; captured = message; return accepted(message); }));
  assert.equal(first.delivery.status, 'accepted');
  assert.equal(first.delivery.statusLabel, '发信服务已接收');
  assert.equal(first.delivery.recipient, 're***@example.com');
  assert.ok(captured.text.includes(item.summary));
  assert.equal(captured.recipient, recipient);
  await db.prepare('UPDATE editions SET payload=?,updated_at=? WHERE date=?').bind(JSON.stringify([{ ...item, summary: '稍后补采的摘要' }]), '2026-10-29T02:00:00.000Z', date).run();
  const reopened = new RadarDatabase(undefined, path);
  try {
    const replay = await sendDailyEmail(reopened, 'owner', date, opts(async message => { sends++; return accepted(message); }));
    assert.equal(replay.replayed, true);
    assert.equal(replay.delivery.id, first.delivery.id);
    assert.equal(sends, 1);
    const rows = (await db.prepare('SELECT payload,recipient,edition_version FROM email_deliveries').all()).results;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recipient, recipient);
    assert.equal(rows[0].edition_version, at);
    assert.ok(rows[0].payload.includes(item.summary));
    assert.ok(!rows[0].payload.includes('稍后补采的摘要'));
  } finally { reopened.close(); }
}));

test('two simultaneous clients can claim and transmit only one daily email', async () => fixture(async (db, path) => {
  const secondDb = new RadarDatabase(undefined, path);
  let sends = 0;
  let release;
  let signal;
  const started = new Promise(resolve => { signal = resolve; });
  const gated = new Promise(resolve => { release = resolve; });
  const sender = async message => { sends++; signal(); await gated; return accepted(message); };
  try {
    const firstPromise = sendDailyEmail(db, 'owner', date, opts(sender));
    await started;
    const concurrent = await sendDailyEmail(secondDb, 'owner', date, opts(sender));
    assert.equal(concurrent.replayed, true);
    assert.equal(concurrent.delivery.status, 'sending');
    release();
    assert.equal((await firstPromise).delivery.status, 'accepted');
    assert.equal(sends, 1);
  } finally { release?.(); secondDb.close(); }
}));

test('concurrent first creation keeps one immutable daily record and sends once', async () => fixture(async (db, path) => {
  const secondDb = new RadarDatabase(undefined, path);
  let sends = 0;
  const sender = async message => { sends++; return accepted(message); };
  try {
    const results = await Promise.all([sendDailyEmail(db, 'owner', date, opts(sender)), sendDailyEmail(secondDb, 'owner', date, opts(sender))]);
    assert.equal(new Set(results.map(value => value.delivery.id)).size, 1);
    assert.equal(sends, 1);
    assert.equal((await db.prepare('SELECT * FROM email_deliveries').all()).results.length, 1);
  } finally { secondDb.close(); }
}));

test('automatic delivery obeys preference while an explicit send works with auto mail disabled', async () => fixture(async db => {
  let sends = 0;
  const sender = async message => { sends++; return accepted(message); };
  assert.equal((await sendDailyEmail(db, 'owner', date, opts(sender))).skipped, true);
  assert.equal(sends, 0);
  assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(sender), automatic: false })).delivery.status, 'accepted');
  assert.equal(sends, 1);
}, { enabled: 0 }));

test('partial, empty, historical, future and unconfigured editions are not automatically emailed', async () => {
  await fixture(async db => {
    const never = async () => { throw new Error('must not send'); };
    assert.equal((await sendDailyEmail(db, 'owner', date, opts(never))).skipped, true);
  }, { status: 'partial' });
  await fixture(async db => { assert.equal((await sendDailyEmail(db, 'owner', date, opts(accepted))).skipped, true); }, { items: [] });
  await fixture(async db => {
    assert.equal((await sendDailyEmail(db, 'owner', '2026-10-28', opts(accepted))).skipped, true);
    assert.equal((await sendDailyEmail(db, 'owner', '2026-10-30', opts(accepted))).skipped, true);
    assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(accepted), ready: false })).skipped, true);
    assert.equal((await db.prepare('SELECT * FROM email_deliveries').all()).results.length, 0);
  });
});

test('SMTP rejection remains retryable without repeat ingestion silently retrying it', async () => fixture(async db => {
  let sends = 0;
  const first = await sendDailyEmail(db, 'owner', date, opts(async () => { sends++; throw Object.assign(new Error('password-must-never-escape'), { code: 'EAUTH', responseCode: 535, command: 'AUTH LOGIN' }); }));
  assert.equal(first.delivery.status, 'failed');
  assert.equal(first.delivery.canRetry, true);
  assert.ok(!JSON.stringify(first).includes('password-must-never-escape'));
  await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; return accepted(message); }));
  assert.equal(sends, 1);
  const retry = await retryEmail(db, 'owner', first.delivery.id, opts(async message => { sends++; return accepted(message); }));
  assert.equal(retry.delivery.status, 'accepted');
  assert.equal(retry.delivery.id, first.delivery.id);
  assert.equal(sends, 2);
  await assert.rejects(retryEmail(db, 'owner', first.delivery.id, opts(accepted)), statusIs(409));
}));

test('ambiguous SMTP result stays unknown and cannot be retried or replayed', async () => fixture(async db => {
  let sends = 0;
  const first = await sendDailyEmail(db, 'owner', date, opts(async () => { sends++; throw Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT', command: 'DATA' }); }));
  assert.equal(first.delivery.status, 'unknown');
  assert.equal(first.delivery.canRetry, false);
  const again = await sendDailyEmail(db, 'owner', date, opts(accepted));
  assert.equal(again.delivery.status, 'unknown');
  assert.equal(again.replayed, true);
  await assert.rejects(retryEmail(db, 'owner', first.delivery.id, opts(accepted)), statusIs(409));
  assert.equal(sends, 1);
}));

test('an abandoned sending claim becomes unknown, not a new send', async () => fixture(async db => {
  const first = await sendDailyEmail(db, 'owner', date, opts(accepted));
  await db.prepare("UPDATE email_deliveries SET status='sending',updated_at=? WHERE id=?").bind('2026-10-29T00:55:00.000Z', first.delivery.id).run();
  const status = await emailStatus(db, 'owner', at);
  assert.equal(status.latest.status, 'unknown');
  const replay = await sendDailyEmail(db, 'owner', date, opts(async () => { throw new Error('must not send'); }));
  assert.equal(replay.delivery.status, 'unknown');
}));

test('database failure after SMTP acceptance never turns into retryable failure', async () => fixture(async db => {
  let sends = 0;
  const execute = db.execute.bind(db);
  let failSave = true;
  db.execute = statement => {
    if (failSave && statement.query.startsWith('UPDATE email_deliveries SET status=?,message_id=')) { failSave = false; return Promise.reject(new Error('temporary database outage')); }
    return execute(statement);
  };
  const first = await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; return accepted(message); }));
  assert.equal(first.delivery.status, 'unknown');
  assert.equal(first.delivery.canRetry, false);
  const next = await sendDailyEmail(db, 'owner', date, { ...opts(accepted), at: '2026-10-29T01:03:00.000Z' });
  assert.equal(next.delivery.status, 'unknown');
  assert.equal(next.replayed, true);
  assert.equal(sends, 1);
}));

test('test requests replay by ID and separate requests are atomically limited to one per minute', async () => fixture(async (db, path) => {
  let sends = 0;
  const sender = async message => { sends++; return accepted(message); };
  const id = randomUUID();
  const first = await sendTestEmail(db, 'owner', id, opts(sender));
  assert.equal(first.delivery.kind, 'test');
  assert.equal((await sendTestEmail(db, 'owner', id, opts(sender))).replayed, true);
  const secondDb = new RadarDatabase(undefined, path);
  try { await assert.rejects(sendTestEmail(secondDb, 'owner', randomUUID(), opts(sender)), statusIs(429)); }
  finally { secondDb.close(); }
  assert.equal(sends, 1);
  assert.equal((await sendTestEmail(db, 'owner', randomUUID(), { ...opts(sender), at: '2026-10-29T01:01:00.000Z' })).delivery.status, 'accepted');
  assert.equal(sends, 2);
}));

test('retry ownership, date and frozen recipient are enforced', async () => fixture(async db => {
  const first = await sendDailyEmail(db, 'owner', date, opts(async () => { throw { code: 'EAUTH' }; }));
  await assert.rejects(retryEmail(db, 'another-owner', first.delivery.id, opts(accepted)), statusIs(404));
  await assert.rejects(retryEmail(db, 'owner', first.delivery.id, { ...opts(accepted), at: '2026-10-30T01:00:00.000Z' }), statusIs(409));
  await db.prepare('UPDATE preferences SET email=? WHERE user_id=?').bind('different@example.com', 'owner').run();
  await assert.rejects(retryEmail(db, 'owner', first.delivery.id, opts(accepted)), statusIs(409));
  assert.equal((await emailStatus(db, 'another-owner', at)).latest, null);
}));

test('HTML escapes curated text and rejects active source URLs while keeping private data out', () => {
  const mail = dailyEmail(date, [{ ...item, name: '<script>alert(1)</script>', title: 'A & B', summary: '摘要 <b>内容</b>', sources: [{ label: '坏链接', url: 'javascript:alert(1)' }], personalNote: '这段私人记录不应进入邮件' }]);
  assert.ok(mail.html.includes('&lt;script&gt;'));
  assert.ok(mail.html.includes('A &amp; B'));
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(!mail.html.includes('javascript:'));
  assert.ok(!JSON.stringify(mail).includes('这段私人记录'));
  assert.ok(mail.html.includes('view=history'));
});

test('failure classification distinguishes rejection before/at DATA from uncertainty after DATA', () => {
  assert.equal(smtpFailure({ code: 'ESOCKET', command: 'CONN' }).status, 'failed');
  assert.equal(smtpFailure({ command: 'DATA', responseCode: 550 }).status, 'failed');
  assert.equal(smtpFailure({ code: 'ESOCKET', command: 'DATA' }).status, 'unknown');
  assert.equal(smtpFailure({ command: 'QUIT', responseCode: 421 }).status, 'unknown');
  assert.equal(smtpFailure(new Error('unknown')).status, 'unknown');
});
