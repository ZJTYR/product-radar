import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { emailReadiness, inlinePosterAttachments, smtpFailure } from '../lib/email-smtp.ts';
import { dailyEmail, POSTER_EMAIL_VERSION } from '../lib/email-template.ts';
import { DEFAULT_DELIVERY_TIME, emailTime, isEmailDue } from '../lib/email-timing.ts';
import { EmailDeliveryError, emailDay, emailStatus, retryEmail, sendDailyEmail, sendTestEmail } from '../lib/email-store.ts';

const at = '2026-10-29T12:00:00.000Z';
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
      db.prepare('INSERT INTO preferences(user_id,email,delivery_time,email_enabled) VALUES(?,?,?,?)').bind('owner', recipient, overrides.deliveryTime ?? '20:00', overrides.enabled ?? 1),
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
  assert.equal(captured.attachments.length, 1);
  assert.equal(captured.templateVersion, POSTER_EMAIL_VERSION);
  assert.equal((captured.html.match(/<img /g) || []).length, 1);
  assert.ok(captured.html.includes('src="cid:'));
  assert.ok(!captured.text.includes(item.summary));
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
    assert.deepEqual(JSON.parse(rows[0].payload).attachments, captured.attachments);
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
  const next = await sendDailyEmail(db, 'owner', date, { ...opts(accepted), at: '2026-10-29T12:03:00.000Z' });
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
  assert.equal((await sendTestEmail(db, 'owner', randomUUID(), { ...opts(sender), at: '2026-10-29T12:01:00.000Z' })).delivery.status, 'accepted');
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

test('poster-only HTML embeds one image without remote dependencies or private data', () => {
  const publicItem = { ...item, name: '<script>alert(1)</script>', title: 'A & B', summary: '摘要 <b>内容</b>', sources: [{ label: '坏链接', url: 'javascript:alert(1)' }] };
  const mail = dailyEmail(date, [{ ...publicItem, personalNote: '这段私人记录不应进入邮件' }]);
  const withoutPrivateData = dailyEmail(date, [publicItem]);
  assert.equal((mail.html.match(/<img /g) || []).length, 1);
  assert.ok(!mail.html.includes('<script>'));
  assert.ok(!mail.html.includes('javascript:'));
  assert.ok(!/<img[^>]+src=["']https?:/.test(mail.html));
  assert.ok(!JSON.stringify(mail).includes('这段私人记录'));
  assert.ok(mail.html.includes('view=history'));
  assert.deepEqual(mail.attachments, withoutPrivateData.attachments);
  const attachments = inlinePosterAttachments(mail);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].contentDisposition, 'inline');
  assert.equal(attachments[0].content.subarray(1, 4).toString(), 'PNG');
  assert.ok(mail.html.includes(`cid:${attachments[0].cid}`));
  assert.equal('path' in attachments[0], false);
  assert.equal('href' in attachments[0], false);
});

test('SMTP attachment mapping rejects non-PNG data, injected IDs and multiple images before sending', () => {
  const mail = dailyEmail(date, [item]);
  assert.throws(() => inlinePosterAttachments({ ...mail, attachments: [...mail.attachments, ...mail.attachments] }), { code: 'EPOSTER' });
  assert.throws(() => inlinePosterAttachments({ ...mail, attachments: [{ ...mail.attachments[0], contentBase64: Buffer.from('not a PNG').toString('base64') }] }), { code: 'EPOSTER' });
  assert.throws(() => inlinePosterAttachments({ ...mail, attachments: [{ ...mail.attachments[0], cid: 'bad\\r\\nheader@example.com' }] }), { code: 'EPOSTER' });
});

test('failure classification distinguishes rejection before/at DATA from uncertainty after DATA', () => {
  assert.equal(smtpFailure({ code: 'ESOCKET', command: 'CONN' }).status, 'failed');
  assert.equal(smtpFailure({ command: 'DATA', responseCode: 550 }).status, 'failed');
  assert.equal(smtpFailure({ code: 'ESOCKET', command: 'DATA' }).status, 'unknown');
  assert.equal(smtpFailure({ command: 'QUIT', responseCode: 421 }).status, 'unknown');
  assert.equal(smtpFailure(new Error('unknown')).status, 'unknown');
});

test('default 20:00 and custom times use Beijing time with a closed midnight boundary', () => {
  assert.equal(DEFAULT_DELIVERY_TIME, '20:00');
  assert.equal(emailTime('2026-10-29T16:00:00Z'), '00:00');
  assert.equal(isEmailDue('20:00', '2026-10-29T11:59:59Z'), false);
  assert.equal(isEmailDue('20:00', '2026-10-29T12:00:00Z'), true);
  assert.equal(isEmailDue('09:15', '2026-10-29T01:14:59Z'), false);
  assert.equal(isEmailDue('09:15', '2026-10-29T01:15:00Z'), true);
  assert.equal(isEmailDue('25:00', at), false);
  assert.equal(isEmailDue('', at), false);
});

test('automatic send waits until saved time and freezes no content before then', async () => fixture(async db => {
  let sends = 0;
  const sender = async message => { sends++; return accepted(message); };
  const early = await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T11:59:59Z' });
  assert.equal(early.skipped, true);
  assert.match(early.reason, /20:00/);
  assert.equal((await db.prepare('SELECT * FROM email_deliveries').all()).results.length, 0);
  const due = await sendDailyEmail(db, 'owner', date, opts(sender));
  assert.equal(due.delivery.status, 'accepted');
  await db.prepare('UPDATE preferences SET delivery_time=? WHERE user_id=?').bind('20:05', 'owner').run();
  assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T12:05:00Z' })).delivery.id, due.delivery.id);
  assert.equal(sends, 1);
}));

test('custom delivery time is enforced by automatic send', async () => fixture(async db => {
  assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(accepted), at: '2026-10-29T01:14:59Z' })).skipped, true);
  assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(accepted), at: '2026-10-29T01:15:00Z' })).delivery.status, 'accepted');
}, { deliveryTime: '09:15' }));

for (const [label, update] of [
  ['paused', ['email_enabled', 0]],
  ['postponed', ['delivery_time', '21:00']],
  ['recipient changed', ['email', 'different@example.com']],
]) test(`an automatic claim rechecks preferences when ${label} after rendering`, async () => fixture(async db => {
  let sends = 0;
  const execute = db.execute.bind(db);
  let changed = false;
  db.execute = async statement => {
    if (!changed && statement.query.startsWith("UPDATE email_deliveries SET status='sending'")) {
      changed = true;
      await execute(db.prepare(`UPDATE preferences SET ${update[0]}=? WHERE user_id=?`).bind(update[1], 'owner'));
    }
    return execute(statement);
  };
  const result = await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; return accepted(message); }));
  assert.equal(result.delivery.status, 'pending');
  assert.equal(result.replayed, true);
  assert.equal(sends, 0);
  const row = await db.prepare('SELECT attempt_count FROM email_deliveries WHERE id=?').bind(result.delivery.id).first();
  assert.equal(row.attempt_count, 0);
}));

test('a newly updated edition cannot send an older poster and refreshes the unsent record next time', async () => fixture(async db => {
  let sends = 0;
  const execute = db.execute.bind(db);
  let changed = false;
  db.execute = async statement => {
    if (!changed && statement.query.startsWith("UPDATE email_deliveries SET status='sending'")) {
      changed = true;
      await execute(db.prepare('UPDATE editions SET payload=?,updated_at=? WHERE date=?').bind(JSON.stringify([{ ...item, summary: '发送前的新补充内容' }]), '2026-10-29T12:00:01Z', date));
    }
    return execute(statement);
  };
  const sender = async message => { sends++; return accepted(message); };
  const waiting = await sendDailyEmail(db, 'owner', date, opts(sender));
  assert.equal(waiting.delivery.status, 'pending');
  assert.equal(sends, 0);
  const before = await db.prepare('SELECT payload FROM email_deliveries WHERE id=?').bind(waiting.delivery.id).first();
  const sent = await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T12:05:00Z' });
  assert.equal(sent.delivery.status, 'accepted');
  assert.equal(sent.delivery.id, waiting.delivery.id);
  const after = await db.prepare('SELECT payload FROM email_deliveries WHERE id=?').bind(sent.delivery.id).first();
  assert.notEqual(after.payload, before.payload);
  assert.equal(sends, 1);
}));

test('poster generation failure happens before SMTP claim and leaves no ambiguous record', async () => fixture(async db => {
  let sends = 0;
  await assert.rejects(sendDailyEmail(db, 'owner', date, { ...opts(async message => { sends++; return accepted(message); }), buildDailyMessage: () => { throw new Error('font error with private path'); } }), error => error instanceof EmailDeliveryError && error.status === 503 && !error.message.includes('private path'));
  assert.equal(sends, 0);
  assert.equal((await db.prepare('SELECT * FROM email_deliveries').all()).results.length, 0);
}));

test('legacy pending cannot bypass schedule or completeness and upgrades only before its first send', async () => fixture(async db => {
  const first = await sendDailyEmail(db, 'owner', date, opts(accepted));
  const legacy = JSON.stringify({ subject: '旧版', text: '旧正文', html: '<p>旧正文</p>' });
  await db.prepare("UPDATE email_deliveries SET payload=?,status='pending',attempt_count=0,claim_token=NULL WHERE id=?").bind(legacy, first.delivery.id).run();
  let sends = 0;
  const sender = async message => { sends++; assert.equal(message.templateVersion, POSTER_EMAIL_VERSION); return accepted(message); };
  assert.equal((await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T11:59:59Z' })).skipped, true);
  await db.prepare('UPDATE editions SET status=? WHERE date=?').bind('partial', date).run();
  assert.equal((await sendDailyEmail(db, 'owner', date, opts(sender))).skipped, true);
  assert.equal(sends, 0);
  assert.equal((await db.prepare('SELECT payload FROM email_deliveries WHERE id=?').bind(first.delivery.id).first()).payload, legacy);
  await db.prepare('UPDATE editions SET status=? WHERE date=?').bind('complete', date).run();
  const result = await sendDailyEmail(db, 'owner', date, opts(sender));
  assert.equal(result.delivery.status, 'accepted');
  assert.equal(result.delivery.id, first.delivery.id);
  assert.equal(sends, 1);
}));

test('legacy failed upgrades on explicit retry while accepted and unknown payloads remain unchanged', async () => fixture(async db => {
  const first = await sendDailyEmail(db, 'owner', date, opts(async () => { throw { code: 'EAUTH' }; }));
  const legacy = JSON.stringify({ subject: '旧版', text: '旧正文', html: '<p>旧正文</p>' });
  await db.prepare('UPDATE email_deliveries SET payload=? WHERE id=?').bind(legacy, first.delivery.id).run();
  let sends = 0;
  await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; return accepted(message); }));
  assert.equal(sends, 0);
  const retried = await retryEmail(db, 'owner', first.delivery.id, opts(async message => { sends++; assert.equal(message.templateVersion, POSTER_EMAIL_VERSION); return accepted(message); }));
  assert.equal(retried.delivery.status, 'accepted');
  for (const status of ['accepted', 'unknown']) {
    await db.prepare('UPDATE email_deliveries SET status=?,payload=? WHERE id=?').bind(status, legacy, first.delivery.id).run();
    const replayed = await sendDailyEmail(db, 'owner', date, opts(async message => { sends++; return accepted(message); }));
    assert.equal(replayed.delivery.status, status);
    assert.equal((await db.prepare('SELECT payload FROM email_deliveries WHERE id=?').bind(first.delivery.id).first()).payload, legacy);
  }
  assert.equal(sends, 1);
}));

test('an unclaimed pending daily message adopts a newly saved recipient without sending to the old one', async () => fixture(async db => {
  const execute = db.execute.bind(db);
  let changed = false;
  db.execute = async statement => {
    if (!changed && statement.query.startsWith("UPDATE email_deliveries SET status='sending'")) {
      changed = true;
      await execute(db.prepare('UPDATE preferences SET email=? WHERE user_id=?').bind('new@example.com', 'owner'));
    }
    return execute(statement);
  };
  const recipients = [];
  const sender = async message => { recipients.push(message.recipient); return accepted(message); };
  const first = await sendDailyEmail(db, 'owner', date, opts(sender));
  assert.equal(first.delivery.status, 'pending');
  assert.deepEqual(recipients, []);
  const next = await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T12:05:00Z' });
  assert.equal(next.delivery.id, first.delivery.id);
  assert.equal(next.delivery.status, 'accepted');
  assert.deepEqual(recipients, ['new@example.com']);
}));

test('a manual recipient change before claim leaves an unsent daily message recoverable by the next manual send', async () => fixture(async db => {
  const execute = db.execute.bind(db);
  let changed = false;
  db.execute = async statement => {
    if (!changed && statement.query.startsWith("UPDATE email_deliveries SET status='sending'")) {
      changed = true;
      await execute(db.prepare('UPDATE preferences SET email=? WHERE user_id=?').bind('new@example.com', 'owner'));
    }
    return execute(statement);
  };
  const recipients = [];
  const sender = async message => { recipients.push(message.recipient); return accepted(message); };
  const first = await sendDailyEmail(db, 'owner', date, { ...opts(sender), automatic: false });
  assert.equal(first.delivery.status, 'pending');
  assert.equal(first.replayed, true);
  assert.deepEqual(recipients, []);
  const waiting = await db.prepare('SELECT status,recipient,attempt_count,claim_token FROM email_deliveries WHERE id=?').bind(first.delivery.id).first();
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.recipient, recipient);
  assert.equal(waiting.attempt_count, 0);
  assert.equal(waiting.claim_token, null);
  const next = await sendDailyEmail(db, 'owner', date, { ...opts(sender), at: '2026-10-29T12:05:00Z', automatic: false });
  assert.equal(next.delivery.id, first.delivery.id);
  assert.equal(next.delivery.status, 'accepted');
  assert.deepEqual(recipients, ['new@example.com']);
  const sent = await db.prepare('SELECT recipient,attempt_count FROM email_deliveries WHERE id=?').bind(next.delivery.id).first();
  assert.equal(sent.recipient, 'new@example.com');
  assert.equal(sent.attempt_count, 1);
}));

for (const status of ['accepted', 'sending', 'unknown', 'failed']) test(`a ${status} daily message never adopts a newly saved recipient after a send attempt`, async () => fixture(async db => {
  const first = await sendDailyEmail(db, 'owner', date, opts(accepted));
  await db.prepare('UPDATE email_deliveries SET status=? WHERE id=?').bind(status, first.delivery.id).run();
  await db.prepare('UPDATE preferences SET email=? WHERE user_id=?').bind('new@example.com', 'owner').run();
  let sends = 0;
  const result = await sendDailyEmail(db, 'owner', date, { ...opts(async message => { sends++; return accepted(message); }), automatic: false });
  assert.equal(result.delivery.status, status);
  assert.equal(result.replayed, true);
  assert.equal(sends, 0);
  const frozen = await db.prepare('SELECT recipient,attempt_count FROM email_deliveries WHERE id=?').bind(first.delivery.id).first();
  assert.equal(frozen.recipient, recipient);
  assert.equal(frozen.attempt_count, 1);
  if (status === 'failed') await assert.rejects(retryEmail(db, 'owner', first.delivery.id, opts(accepted)), statusIs(409));
}));
