import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RadarDatabase } from './database.ts';
import type { IntelItem } from './types.ts';
import type { EmailDeliveryKind, EmailDeliveryStatus, EmailDeliveryView, EmailSendResponse, EmailStatusResponse } from './email-types.ts';
import { emailReadiness, sendSmtp, smtpFailure } from './email-smtp.ts';
import type { EmailMessage, EmailSender } from './email-smtp.ts';
import { dailyEmail, testEmail } from './email-template.ts';

type DeliveryRow = {
  id: string; user_id: string; kind: EmailDeliveryKind; dedupe_key: string; edition_date: string;
  edition_version: string; recipient: string; payload: string; status: EmailDeliveryStatus;
  request_id: string; message_id: string; claim_token: string | null; attempt_count: number;
  error_message: string; created_at: string; updated_at: string;
};
type PreferenceRow = { email: string; email_enabled: number };
type DeliveryOptions = { sender?: EmailSender; at?: string; ready?: boolean };
export class EmailDeliveryError extends Error { constructor(public status: number, message: string) { super(message); } }
export const emailRequestSchema = z.object({ requestId: z.string().uuid() }).strict();
export const emailRetrySchema = z.object({ deliveryId: z.string().uuid() }).strict();
export const emailSendSchema = z.object({}).strict();
const emailAddress = z.string().trim().email().max(254);
const statusLabels: Record<EmailDeliveryStatus, string> = { pending: '等待发送', sending: '正在发送，请稍后刷新状态', accepted: '发信服务已接收', failed: '发送失败，邮件尚未被接收', unknown: '发送结果待核对，请先查收' };
const currentTime = (options: DeliveryOptions) => options.at || new Date().toISOString();
export const emailDay = (at: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
export function maskEmail(value: string) { const [name, domain] = value.split('@'); return domain ? `${name.slice(0, 2)}***@${domain}` : ''; }
function ready(options: DeliveryOptions) { return options.ready ?? emailReadiness().deliveryReady; }
function requireReady(options: DeliveryOptions) { if (!ready(options)) throw new EmailDeliveryError(409, 'SMTP 发信配置尚未完整，请先完成服务端配置。'); }
async function preferences(db: RadarDatabase, userId: string) {
  const row = await db.prepare('SELECT email,email_enabled FROM preferences WHERE user_id=?').bind(userId).first<PreferenceRow>();
  if (!row || !emailAddress.safeParse(row.email).success) throw new EmailDeliveryError(409, '请先在偏好设置中保存有效的收件邮箱。');
  return row;
}
async function rowById(db: RadarDatabase, userId: string, id: string) { return db.prepare('SELECT * FROM email_deliveries WHERE user_id=? AND id=?').bind(userId, id).first<DeliveryRow>(); }
function publicDelivery(row: DeliveryRow, at = new Date().toISOString()): EmailDeliveryView {
  return { id: row.id, kind: row.kind, editionDate: row.edition_date, recipient: maskEmail(row.recipient), status: row.status, statusLabel: statusLabels[row.status], canRetry: row.status === 'failed' && row.edition_date === emailDay(at), ...(row.error_message ? { errorMessage: row.error_message } : {}), ...(row.message_id ? { messageId: row.message_id } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}

/** 进程在发送后退出也不会再次取得发送权。SMTP 没有可靠的服务端幂等键。 */
async function expireClaims(db: RadarDatabase, userId: string, at: string) {
  const staleAt = new Date(new Date(at).getTime() - 120_000).toISOString();
  await db.prepare("UPDATE email_deliveries SET status='unknown',error_message=?,updated_at=? WHERE user_id=? AND status='sending' AND updated_at<=?")
    .bind('发送进程已结束但未收到确定结果，请先查收或检查发信记录；系统不会自动重发。', at, userId, staleAt).run();
}

export async function emailStatus(db: RadarDatabase, userId: string, at = new Date().toISOString()): Promise<EmailStatusResponse> {
  await expireClaims(db, userId, at);
  const prefs = await db.prepare('SELECT email,email_enabled FROM preferences WHERE user_id=?').bind(userId).first<PreferenceRow>();
  const rows = (await db.prepare('SELECT * FROM email_deliveries WHERE user_id=? ORDER BY updated_at DESC,id DESC LIMIT 5').bind(userId).all<DeliveryRow>()).results;
  const configuration = emailReadiness();
  const deliveries = rows.map(row => publicDelivery(row, at));
  return { ...configuration, enabled: Boolean(prefs?.email_enabled) && configuration.deliveryReady, recipient: maskEmail(prefs?.email || ''), latest: deliveries[0] || null, deliveries };
}

async function insertDelivery(db: RadarDatabase, value: { userId: string; kind: EmailDeliveryKind; key: string; date: string; version: string; recipient: string; message: EmailMessage; requestId: string; at: string }) {
  const id = randomUUID();
  await db.prepare("INSERT INTO email_deliveries(id,user_id,kind,dedupe_key,edition_date,edition_version,recipient,payload,status,request_id,message_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?,?) ON CONFLICT DO NOTHING")
    .bind(id, value.userId, value.kind, value.key, value.date, value.version, value.recipient, JSON.stringify(value.message), value.requestId, `<${id}@product-radar.local>`, value.at, value.at).run();
}

async function transmit(db: RadarDatabase, row: DeliveryRow, options: DeliveryOptions, fromStatus: 'pending' | 'failed', automatic = false): Promise<EmailSendResponse> {
  if (row.status !== fromStatus) return { delivery: publicDelivery(row, currentTime(options)), replayed: true };
  requireReady(options);
  const at = currentTime(options);
  const token = randomUUID();
  // 原子取得唯一发送权，同时核对当前偏好；偏好关闭不会留下自动发送的新任务。
  const enabled = automatic ? ' AND p.email_enabled=1' : '';
  await db.prepare(`UPDATE email_deliveries SET status='sending',claim_token=?,attempt_count=attempt_count+1,error_message='',updated_at=? WHERE user_id=? AND id=? AND status=? AND EXISTS (SELECT 1 FROM preferences p WHERE p.user_id=email_deliveries.user_id AND TRIM(p.email)=email_deliveries.recipient${enabled})`)
    .bind(token, at, row.user_id, row.id, fromStatus).run();
  const claimed = await rowById(db, row.user_id, row.id);
  if (!claimed) throw new EmailDeliveryError(404, '邮件记录不存在。');
  if (claimed.claim_token !== token || claimed.status !== 'sending') {
    if (claimed.status === fromStatus) {
      await db.prepare("UPDATE email_deliveries SET status='failed',error_message=?,updated_at=? WHERE user_id=? AND id=? AND status=?")
        .bind('收件偏好已变更，邮件尚未发送；请核对偏好后再操作。', at, row.user_id, row.id, fromStatus).run();
      const blocked = await rowById(db, row.user_id, row.id);
      return { delivery: publicDelivery(blocked || claimed, at), replayed: true };
    }
    return { delivery: publicDelivery(claimed, at), replayed: true };
  }
  let status: EmailDeliveryStatus = 'accepted';
  let messageId = claimed.message_id;
  let errorMessage = '';
  try {
    const message = JSON.parse(claimed.payload) as EmailMessage;
    const result = await (options.sender || sendSmtp)({ ...message, recipient: claimed.recipient, messageId });
    if (!result.accepted) throw Object.assign(new Error('SMTP rejected recipient'), { code: 'EENVELOPE' });
    messageId = result.messageId || messageId;
  } catch (error) {
    const failure = smtpFailure(error);
    status = failure.status; errorMessage = failure.message;
  }
  const finishedAt = options.at || new Date().toISOString();
  try {
    await db.prepare('UPDATE email_deliveries SET status=?,message_id=?,error_message=?,updated_at=? WHERE user_id=? AND id=? AND claim_token=? AND status=\'sending\'')
      .bind(status, messageId, errorMessage, finishedAt, claimed.user_id, claimed.id, token).run();
    const saved = await rowById(db, claimed.user_id, claimed.id);
    return { delivery: publicDelivery(saved || { ...claimed, status: 'unknown', error_message: '发送后的记录暂时无法核对，请先查收。' }, finishedAt), replayed: false };
  } catch {
    // 邮件可能已发出，数据库暂时不可写不能被当作明确发送失败并重放。
    return { delivery: publicDelivery({ ...claimed, status: 'unknown', message_id: messageId, error_message: '发送结果暂时无法保存，请先查收；系统不会自动重发。', updated_at: finishedAt }, finishedAt), replayed: false };
  }
}

export async function sendDailyEmail(db: RadarDatabase, userId: string, date: string, options: DeliveryOptions & { automatic?: boolean } = {}): Promise<EmailSendResponse | { skipped: true; reason: string }> {
  const at = currentTime(options);
  const automatic = options.automatic ?? true;
  if (date !== emailDay(at)) return { skipped: true, reason: '只发送当天简报，不补发历史或未来简报。' };
  await expireClaims(db, userId, at);
  const existing = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='daily' AND dedupe_key=?").bind(userId, date).first<DeliveryRow>();
  if (existing) return transmit(db, existing, options, 'pending', automatic);
  if (!ready(options)) return { skipped: true, reason: 'SMTP 发信配置尚未完整。' };
  const prefs = await preferences(db, userId);
  if (automatic && !prefs.email_enabled) return { skipped: true, reason: '每日邮件未开启。' };
  const edition = await db.prepare('SELECT payload,status,updated_at FROM editions WHERE date=?').bind(date).first<{ payload: string; status: string; updated_at: string }>();
  if (!edition || edition.status !== 'complete') return { skipped: true, reason: '当天完整简报尚未完成，完成后再发送。' };
  const items = JSON.parse(edition.payload) as IntelItem[];
  if (!items.length) return { skipped: true, reason: '当天简报尚无内容。' };
  await insertDelivery(db, { userId, kind: 'daily', key: date, date, version: edition.updated_at, recipient: prefs.email.trim(), message: dailyEmail(date, items), requestId: date, at });
  const row = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='daily' AND dedupe_key=?").bind(userId, date).first<DeliveryRow>();
  if (!row) throw new EmailDeliveryError(409, '暂时无法建立邮件记录，请刷新核对。');
  return transmit(db, row, options, 'pending', automatic);
}

export async function sendTestEmail(db: RadarDatabase, userId: string, requestId: string, options: DeliveryOptions = {}): Promise<EmailSendResponse> {
  const at = currentTime(options);
  emailRequestSchema.parse({ requestId });
  await expireClaims(db, userId, at);
  const existing = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='test' AND request_id=?").bind(userId, requestId).first<DeliveryRow>();
  if (existing) return transmit(db, existing, options, 'pending');
  requireReady(options);
  const prefs = await preferences(db, userId);
  const key = String(Math.floor(new Date(at).getTime() / 60_000));
  await insertDelivery(db, { userId, kind: 'test', key, date: emailDay(at), version: '', recipient: prefs.email.trim(), message: testEmail(), requestId, at });
  const row = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='test' AND request_id=?").bind(userId, requestId).first<DeliveryRow>();
  if (!row) throw new EmailDeliveryError(429, '每分钟最多发送一封测试邮件，请稍后再试。');
  return transmit(db, row, options, 'pending');
}

export async function retryEmail(db: RadarDatabase, userId: string, id: string, options: DeliveryOptions = {}): Promise<EmailSendResponse> {
  emailRetrySchema.parse({ deliveryId: id });
  const at = currentTime(options);
  await expireClaims(db, userId, at);
  const row = await rowById(db, userId, id);
  if (!row) throw new EmailDeliveryError(404, '邮件记录不存在。');
  if (row.status !== 'failed') throw new EmailDeliveryError(409, row.status === 'unknown' ? '发送结果不确定，请先查收或检查发信记录，不能直接重发。' : '这条邮件当前无需重试，请刷新状态。');
  if (row.edition_date !== emailDay(at)) throw new EmailDeliveryError(409, '只可重试今天的邮件，旧简报不会被重新发送。');
  const prefs = await preferences(db, userId);
  if (prefs.email.trim() !== row.recipient) throw new EmailDeliveryError(409, '收件邮箱已变更，旧投递记录不能直接重发。');
  return transmit(db, row, options, 'failed');
}
