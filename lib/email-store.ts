import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RadarDatabase } from './database.ts';
import type { IntelItem } from './types.ts';
import type { EmailDeliveryKind, EmailDeliveryStatus, EmailDeliveryView, EmailSendResponse, EmailStatusResponse } from './email-types.ts';
import { emailReadiness, inlinePosterAttachments, sendSmtp, smtpFailure } from './email-smtp.ts';
import type { EmailMessage, EmailSender } from './email-smtp.ts';
import { dailyEmail, POSTER_EMAIL_VERSION, testEmail } from './email-template.ts';
import { emailDay, emailTime, isEmailDue } from './email-timing.ts';
export { emailDay } from './email-timing.ts';

type DeliveryRow = {
  id: string; user_id: string; kind: EmailDeliveryKind; dedupe_key: string; edition_date: string;
  edition_version: string; recipient: string; payload: string; status: EmailDeliveryStatus;
  request_id: string; message_id: string; claim_token: string | null; attempt_count: number;
  error_message: string; created_at: string; updated_at: string;
};
type PreferenceRow = { email: string; email_enabled: number; delivery_time: string };
type EditionRow = { payload: string; status: string; updated_at: string };
type DeliveryOptions = { sender?: EmailSender; at?: string; ready?: boolean; buildDailyMessage?: typeof dailyEmail };
export class EmailDeliveryError extends Error { constructor(public status: number, message: string) { super(message); } }
export const emailRequestSchema = z.object({ requestId: z.string().uuid() }).strict();
export const emailRetrySchema = z.object({ deliveryId: z.string().uuid() }).strict();
export const emailSendSchema = z.object({}).strict();
const emailAddress = z.string().trim().email().max(254);
const statusLabels: Record<EmailDeliveryStatus, string> = { pending: '等待发送', sending: '正在发送，请稍后刷新状态', accepted: '发信服务已接收', failed: '发送失败，邮件尚未被接收', unknown: '发送结果待核对，请先查收' };
const currentTime = (options: DeliveryOptions) => options.at || new Date().toISOString();
export function maskEmail(value: string) { const [name, domain] = value.split('@'); return domain ? `${name.slice(0, 2)}***@${domain}` : ''; }
function ready(options: DeliveryOptions) { return options.ready ?? emailReadiness().deliveryReady; }
function requireReady(options: DeliveryOptions) { if (!ready(options)) throw new EmailDeliveryError(409, 'SMTP 发信配置尚未完整，请先完成服务端配置。'); }
async function preferences(db: RadarDatabase, userId: string) {
  const row = await db.prepare('SELECT email,email_enabled,delivery_time FROM preferences WHERE user_id=?').bind(userId).first<PreferenceRow>();
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
  const prefs = await db.prepare('SELECT email,email_enabled,delivery_time FROM preferences WHERE user_id=?').bind(userId).first<PreferenceRow>();
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

function buildDailyMessage(date: string, items: IntelItem[], options: DeliveryOptions): EmailMessage {
  try {
    const message = (options.buildDailyMessage || dailyEmail)(date, items);
    if (message.templateVersion !== POSTER_EMAIL_VERSION || message.attachments?.length !== 1) throw new Error('Missing poster');
    inlinePosterAttachments(message);
    return message;
  } catch { throw new EmailDeliveryError(503, '热点海报生成失败，邮件尚未发送，请稍后重试。'); }
}

function isPosterMessage(payload: string): boolean {
  try {
    const message = JSON.parse(payload) as EmailMessage;
    if (message.templateVersion !== POSTER_EMAIL_VERSION || message.attachments?.length !== 1) return false;
    inlinePosterAttachments(message);
    return true;
  } catch { return false; }
}

async function completeEdition(db: RadarDatabase, date: string) {
  const edition = await db.prepare('SELECT payload,status,updated_at FROM editions WHERE date=?').bind(date).first<EditionRow>();
  if (!edition || edition.status !== 'complete') return null;
  const items = JSON.parse(edition.payload) as IntelItem[];
  return items.length ? { ...edition, items } : null;
}

/** 仅替换确定未发出的旧模板；已接收、不确定和发送中记录绝不改写。 */
async function refreshUnsentPoster(db: RadarDatabase, row: DeliveryRow, fromStatus: 'pending' | 'failed', options: DeliveryOptions, edition?: Awaited<ReturnType<typeof completeEdition>>) {
  if (row.status !== fromStatus) return row;
  const needsUpgrade = !isPosterMessage(row.payload);
  const needsRefresh = row.status === 'pending' && row.attempt_count === 0 && edition && edition.updated_at !== row.edition_version;
  if (!needsUpgrade && !needsRefresh) return row;
  const source = row.kind === 'daily' ? edition || await completeEdition(db, row.edition_date) : null;
  if (row.kind === 'daily' && !source) throw new EmailDeliveryError(409, '当天完整简报尚未完成，邮件尚未发送。');
  const message = row.kind === 'daily' ? buildDailyMessage(row.edition_date, source!.items, options) : testEmail(row.edition_date);
  await db.prepare('UPDATE email_deliveries SET payload=?,edition_version=?,updated_at=? WHERE user_id=? AND id=? AND status=? AND payload=?')
    .bind(JSON.stringify(message), source?.updated_at || '', currentTime(options), row.user_id, row.id, fromStatus, row.payload).run();
  return await rowById(db, row.user_id, row.id) || row;
}

async function transmit(db: RadarDatabase, row: DeliveryRow, options: DeliveryOptions, fromStatus: 'pending' | 'failed', automatic = false): Promise<EmailSendResponse> {
  if (row.status !== fromStatus) return { delivery: publicDelivery(row, currentTime(options)), replayed: true };
  requireReady(options);
  const at = currentTime(options);
  const token = randomUUID();
  const prefs = await preferences(db, row.user_id);
  if (automatic && (!prefs.email_enabled || !isEmailDue(prefs.delivery_time, at) || row.edition_date !== emailDay(at))) return { delivery: publicDelivery(row, at), replayed: true };
  // 发送前最后一次原子核对：渲染期间暂停、改时间、换邮箱或当天简报被更新，都不能绕过。
  const enabled = automatic ? ' AND p.email_enabled=1 AND p.delivery_time=? AND p.delivery_time<=?' : '';
  const editionGate = automatic ? " AND edition_date=? AND EXISTS (SELECT 1 FROM editions e WHERE e.date=email_deliveries.edition_date AND e.status='complete' AND e.updated_at=email_deliveries.edition_version)" : '';
  const values = [token, at, row.user_id, row.id, fromStatus, ...(automatic ? [prefs.delivery_time, emailTime(at), emailDay(at)] : [])];
  await db.prepare(`UPDATE email_deliveries SET status='sending',claim_token=?,attempt_count=attempt_count+1,error_message='',updated_at=? WHERE user_id=? AND id=? AND status=? AND EXISTS (SELECT 1 FROM preferences p WHERE p.user_id=email_deliveries.user_id AND TRIM(p.email)=email_deliveries.recipient${enabled})${editionGate}`)
    .bind(...values).run();
  const claimed = await rowById(db, row.user_id, row.id);
  if (!claimed) throw new EmailDeliveryError(404, '邮件记录不存在。');
  if (claimed.claim_token !== token || claimed.status !== 'sending') {
    // 自动任务可能正被暂停或改期，保留 pending 供新的有效设置使用。
    if (automatic) return { delivery: publicDelivery(claimed, at), replayed: true };
    // 手动发送渲染期间换邮箱也尚未取得发送权，保留可恢复的 pending。
    // 下一次明确发送会按现偏好采用新收件人；已尝试发送的记录不进入此分支。
    if (claimed.kind === 'daily' && claimed.status === 'pending' && claimed.attempt_count === 0 && !claimed.claim_token) return { delivery: publicDelivery(claimed, at), replayed: true };
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
  let existing = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='daily' AND dedupe_key=?").bind(userId, date).first<DeliveryRow>();
  if (existing && existing.status !== 'pending') return { delivery: publicDelivery(existing, at), replayed: true };
  if (!ready(options)) return { skipped: true, reason: 'SMTP 发信配置尚未完整。' };
  const prefs = await preferences(db, userId);
  if (automatic && !prefs.email_enabled) return { skipped: true, reason: '定时发送已关闭。' };
  if (automatic && !isEmailDue(prefs.delivery_time, at)) return { skipped: true, reason: `等待北京时间 ${prefs.delivery_time} 定时发送。` };
  const edition = await completeEdition(db, date);
  if (!edition) return { skipped: true, reason: '当天完整且非空的简报尚未就绪，暂不发送。' };
  // 渲染期间换邮箱可能留下尚未取得过发送权的记录；下一次有效请求可安全采用新收件人。
  // 已尝试发送、已接收或结果未知的记录仍保持原收件人，绝不因此重放。
  if (existing && existing.attempt_count === 0 && !existing.claim_token && existing.recipient !== prefs.email.trim()) {
    await db.prepare("UPDATE email_deliveries SET recipient=?,updated_at=? WHERE user_id=? AND id=? AND status='pending' AND attempt_count=0 AND claim_token IS NULL AND recipient=? AND EXISTS (SELECT 1 FROM preferences p WHERE p.user_id=email_deliveries.user_id AND TRIM(p.email)=?)")
      .bind(prefs.email.trim(), at, userId, existing.id, existing.recipient, prefs.email.trim()).run();
    existing = await rowById(db, userId, existing.id);
  }
  if (existing) return transmit(db, await refreshUnsentPoster(db, existing, 'pending', options, edition), options, 'pending', automatic);
  await insertDelivery(db, { userId, kind: 'daily', key: date, date, version: edition.updated_at, recipient: prefs.email.trim(), message: buildDailyMessage(date, edition.items, options), requestId: date, at });
  const row = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='daily' AND dedupe_key=?").bind(userId, date).first<DeliveryRow>();
  if (!row) throw new EmailDeliveryError(409, '暂时无法建立邮件记录，请刷新核对。');
  return transmit(db, row, options, 'pending', automatic);
}

export async function sendTestEmail(db: RadarDatabase, userId: string, requestId: string, options: DeliveryOptions = {}): Promise<EmailSendResponse> {
  const at = currentTime(options);
  emailRequestSchema.parse({ requestId });
  await expireClaims(db, userId, at);
  const existing = await db.prepare("SELECT * FROM email_deliveries WHERE user_id=? AND kind='test' AND request_id=?").bind(userId, requestId).first<DeliveryRow>();
  if (existing) return transmit(db, await refreshUnsentPoster(db, existing, 'pending', options), options, 'pending');
  requireReady(options);
  const prefs = await preferences(db, userId);
  const key = String(Math.floor(new Date(at).getTime() / 60_000));
  await insertDelivery(db, { userId, kind: 'test', key, date: emailDay(at), version: '', recipient: prefs.email.trim(), message: testEmail(emailDay(at)), requestId, at });
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
  return transmit(db, await refreshUnsentPoster(db, row, 'failed', options), options, 'failed');
}
