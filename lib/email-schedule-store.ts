import { randomUUID } from 'node:crypto';
import type { RadarDatabase } from './database.ts';
import type { Preferences } from './types.ts';
import { DEFAULT_DELIVERY_TIME, EMAIL_TIME_ZONE, emailDay, validEmailTime, isEmailDue } from './email-timing.ts';

export type EmailScheduleState = 'starting' | 'scheduled' | 'paused' | 'waiting' | 'error';
export interface EmailScheduleView {
  status: EmailScheduleState;
  nextRunAt: string | null;
  deliveryTime: string;
  timeZone: typeof EMAIL_TIME_ZONE;
  errorMessage?: string;
}
export interface EmailScheduleRuntime {
  start(userId: string, generation: string, nextRunAt: string): Promise<string>;
  cancel(runId: string): Promise<void>;
  status(runId: string): Promise<string>;
}
export interface ScheduleOptions { at?: string; runtime?: EmailScheduleRuntime; deploymentId?: string }
interface ScheduleRow {
  user_id: string; generation: string; run_id: string; delivery_time: string; recipient: string;
  status: EmailScheduleState; next_run_at: string | null; deployment_id: string; error_message: string; updated_at: string;
}
type PreferenceRow = { email: string; delivery_time: string; email_enabled: number };
const clock = (options: ScheduleOptions) => options.at || new Date().toISOString();
const deployment = (options: ScheduleOptions) => options.deploymentId || process.env.VERCEL_DEPLOYMENT_ID || 'local';
const runtime = async (options: ScheduleOptions): Promise<EmailScheduleRuntime> => options.runtime || (await import('./email-schedule-runtime.ts')).emailScheduleRuntime;

export async function storedEmailPreferences(db: RadarDatabase, userId: string): Promise<Preferences | null> {
  const value = await db.prepare('SELECT email,delivery_time,email_enabled FROM preferences WHERE user_id=?').bind(userId).first<PreferenceRow>();
  return value ? { email: value.email, deliveryTime: validEmailTime(value.delivery_time) ? value.delivery_time : DEFAULT_DELIVERY_TIME, emailEnabled: Boolean(value.email_enabled) } : null;
}
export async function emailScheduleRow(db: RadarDatabase, userId: string) {
  return db.prepare('SELECT * FROM email_schedules WHERE user_id=?').bind(userId).first<ScheduleRow>();
}
function view(row: ScheduleRow | null, prefs: Preferences | null): EmailScheduleView {
  if (!prefs?.emailEnabled) return { status: 'paused', nextRunAt: null, deliveryTime: prefs?.deliveryTime || DEFAULT_DELIVERY_TIME, timeZone: EMAIL_TIME_ZONE };
  if (!row) return { status: 'error', nextRunAt: null, deliveryTime: prefs.deliveryTime, timeZone: EMAIL_TIME_ZONE, errorMessage: '定时任务尚未安排，请保存偏好以重新安排。' };
  return { status: row.status, nextRunAt: row.next_run_at, deliveryTime: prefs.deliveryTime, timeZone: EMAIL_TIME_ZONE, ...(row.error_message ? { errorMessage: row.error_message } : {}) };
}

/** 读取不会建立任务或发邮件；可选择核对托管任务是否仍在运行。 */
export async function emailScheduleStatus(db: RadarDatabase, userId: string, options: ScheduleOptions & { inspect?: boolean } = {}): Promise<EmailScheduleView> {
  const prefs = await storedEmailPreferences(db, userId);
  const row = await emailScheduleRow(db, userId);
  const result = view(row, prefs);
  if (options.inspect && prefs?.emailEnabled && row?.run_id && ['scheduled', 'waiting'].includes(row.status)) {
    try {
      const state = await (await runtime(options)).status(row.run_id);
      if (!['pending', 'running'].includes(state)) return { ...result, status: 'error', errorMessage: '定时任务已停止，请保存偏好以重新安排。' };
    } catch { return { ...result, status: 'error', errorMessage: '暂时无法核对定时任务，请稍后刷新或保存偏好重新安排。' }; }
  }
  return result;
}

/** Asia/Shanghai 无夏令时，目标由北京时间显式转换，绝不使用服务器本地时区。 */
export function nextEmailTarget(at: string, deliveryTime: string, handledToday = false): string {
  if (!validEmailTime(deliveryTime)) throw new Error('邮件时间无效');
  const date = emailDay(at);
  const today = new Date(`${date}T${deliveryTime}:00+08:00`);
  if (handledToday) return new Date(today.getTime() + 86_400_000).toISOString();
  if (today.getTime() > Date.parse(at)) return today.toISOString();
  return new Date(Date.parse(at) + 1000).toISOString();
}
async function nextTarget(db: RadarDatabase, userId: string, deliveryTime: string, at: string) {
  const handled = await db.prepare("SELECT status FROM email_deliveries WHERE user_id=? AND kind='daily' AND dedupe_key=?").bind(userId, emailDay(at)).first<{ status: string }>();
  return nextEmailTarget(at, deliveryTime, Boolean(handled && handled.status !== 'pending'));
}
async function safelyCancel(runId: string | undefined, options: ScheduleOptions) {
  if (!runId) return;
  try { await (await runtime(options)).cancel(runId); }
  catch { /* 数据库 generation 与最终发送偏好检查仍阻止被替换的任务发信。 */ }
}
async function launch(db: RadarDatabase, userId: string, generation: string, at: string, options: ScheduleOptions) {
  const row = await emailScheduleRow(db, userId);
  if (!row || row.generation !== generation || !row.next_run_at) return emailScheduleStatus(db, userId);
  let runId = '';
  try {
    runId = await (await runtime(options)).start(userId, generation, row.next_run_at);
    await db.prepare("UPDATE email_schedules SET run_id=?,status='scheduled',error_message='',updated_at=? WHERE user_id=? AND generation=? AND status='starting'")
      .bind(runId, at, userId, generation).run();
    const saved = await emailScheduleRow(db, userId);
    if (!saved || saved.generation !== generation) await safelyCancel(runId, options);
  } catch {
    // start 的结果可能未知，保留 generation；迟到的任务也受数据库 claim 和每日去重约束。
    await db.prepare("UPDATE email_schedules SET status='error',error_message=?,updated_at=? WHERE user_id=? AND generation=? AND status='starting'")
      .bind('定时任务暂未安排成功，请保存偏好重试；不会重复发送已处理的当天邮件。', at, userId, generation).run();
  }
  return emailScheduleStatus(db, userId);
}

/** 保存偏好和撤销旧 generation 同一事务完成，关闭后即刻阻止后续自动 claim。 */
export async function saveEmailPreferences(db: RadarDatabase, userId: string, prefs: Preferences, options: ScheduleOptions = {}): Promise<EmailScheduleView> {
  const at = clock(options);
  const old = await emailScheduleRow(db, userId);
  const generation = randomUUID();
  const target = prefs.emailEnabled ? await nextTarget(db, userId, prefs.deliveryTime, at) : null;
  await db.batch([
    db.prepare('INSERT INTO preferences(user_id,email,delivery_time,email_enabled) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,delivery_time=excluded.delivery_time,email_enabled=excluded.email_enabled')
      .bind(userId, prefs.email, prefs.deliveryTime, Number(prefs.emailEnabled)),
    db.prepare("INSERT INTO email_schedules(user_id,generation,run_id,delivery_time,recipient,status,next_run_at,deployment_id,error_message,updated_at) VALUES(?,?,'',?,?,?,?,?,'',?) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,run_id='',delivery_time=excluded.delivery_time,recipient=excluded.recipient,status=excluded.status,next_run_at=excluded.next_run_at,deployment_id=excluded.deployment_id,error_message='',updated_at=excluded.updated_at")
      .bind(userId, generation, prefs.deliveryTime, prefs.email, prefs.emailEnabled ? 'starting' : 'paused', target, deployment(options), at),
  ]);
  await safelyCancel(old?.run_id, options);
  if (!prefs.emailEnabled) return emailScheduleStatus(db, userId);
  return launch(db, userId, generation, at, options);
}

/** 由每日采集保证任务仍活跃，不重复创建同一配置的运行。 */
export async function ensureEmailSchedule(db: RadarDatabase, userId: string, options: ScheduleOptions = {}): Promise<EmailScheduleView> {
  const at = clock(options);
  const prefs = await storedEmailPreferences(db, userId);
  const old = await emailScheduleRow(db, userId);
  if (!prefs?.emailEnabled) return emailScheduleStatus(db, userId);
  const matches = old && old.delivery_time === prefs.deliveryTime && old.recipient === prefs.email && old.deployment_id === deployment(options);
  if (matches && old.status === 'starting' && Date.parse(at) - Date.parse(old.updated_at) < 120_000) return view(old, prefs);
  if (matches && old.run_id && ['scheduled', 'waiting'].includes(old.status)) {
    try { if (['pending', 'running'].includes(await (await runtime(options)).status(old.run_id))) return view(old, prefs); }
    catch { return { ...view(old, prefs), status: 'error', errorMessage: '暂时无法核对定时任务，本次没有重复建立任务。' }; }
  }
  const generation = randomUUID();
  const target = await nextTarget(db, userId, prefs.deliveryTime, at);
  // CAS 同时核对旧 generation 与偏好，避免并发采集或保存重建多个有效任务。
  await db.prepare("INSERT INTO email_schedules(user_id,generation,run_id,delivery_time,recipient,status,next_run_at,deployment_id,error_message,updated_at) SELECT ?,?,'',?,?,'starting',?,?,'',? FROM preferences p WHERE p.user_id=? AND p.email=? AND p.delivery_time=? AND p.email_enabled=1 ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,run_id='',delivery_time=excluded.delivery_time,recipient=excluded.recipient,status='starting',next_run_at=excluded.next_run_at,deployment_id=excluded.deployment_id,error_message='',updated_at=excluded.updated_at WHERE email_schedules.generation=?")
    .bind(userId, generation, prefs.deliveryTime, prefs.email, target, deployment(options), at, userId, prefs.email, prefs.deliveryTime, old?.generation || '').run();
  const claimed = await emailScheduleRow(db, userId);
  if (claimed?.generation !== generation) return emailScheduleStatus(db, userId);
  await safelyCancel(old?.run_id, options);
  return launch(db, userId, generation, at, options);
}

export interface ScheduleAttempt { active: boolean; nextRunAt?: string; retryToday?: boolean }
type DailySender = (db: RadarDatabase, userId: string, date: string, options: { automatic: boolean; at?: string }) => Promise<{ skipped: true; reason: string } | { delivery: { status: string }; replayed: boolean }>;
/** 仅供 durable step 使用；SMTP 的唯一 claim 仍由发送状态机负责。 */
export async function attemptScheduledEmail(db: RadarDatabase, userId: string, generation: string, runId: string, send: DailySender, options: ScheduleOptions = {}): Promise<ScheduleAttempt> {
  const at = clock(options);
  const prefs = await storedEmailPreferences(db, userId);
  const row = await emailScheduleRow(db, userId);
  if (!prefs?.emailEnabled || !row || row.generation !== generation || !['starting', 'scheduled', 'waiting'].includes(row.status) || (row.run_id && row.run_id !== runId)) return { active: false };
  if (!isEmailDue(prefs.deliveryTime, at)) {
    return { active: true, nextRunAt: nextEmailTarget(at, prefs.deliveryTime), retryToday: true };
  }
  const result = await send(db, userId, emailDay(at), { automatic: true, ...(options.at ? { at } : {}) });
  const waiting = 'skipped' in result || result.delivery.status === 'pending';
  const waitingReason = 'skipped' in result ? result.reason : '等待当天完整简报或最新内容就绪；不会发送旧简报。';
  const retryAt = new Date(Date.parse(at) + 5 * 60_000).toISOString();
  const retryToday = waiting && emailDay(retryAt) === emailDay(at);
  const nextRunAt = retryToday ? retryAt : nextEmailTarget(at, prefs.deliveryTime, true);
  await db.prepare("UPDATE email_schedules SET run_id=?,status=?,next_run_at=?,error_message=?,updated_at=? WHERE user_id=? AND generation=? AND (run_id=? OR run_id='')")
    .bind(runId, waiting ? 'waiting' : 'scheduled', nextRunAt, waiting ? waitingReason : '', at, userId, generation, runId).run();
  const current = await emailScheduleRow(db, userId);
  if (current?.generation !== generation) return { active: false };
  return { active: true, nextRunAt, retryToday };
}

export async function registerEmailContinuation(db: RadarDatabase, userId: string, generation: string, previousRunId: string, nextRunId: string, nextRunAt: string, options: ScheduleOptions = {}) {
  await db.prepare("UPDATE email_schedules SET run_id=?,next_run_at=?,deployment_id=?,updated_at=? WHERE user_id=? AND generation=? AND run_id=? AND status IN ('scheduled','waiting')")
    .bind(nextRunId, nextRunAt, deployment(options), clock(options), userId, generation, previousRunId).run();
  const current = await emailScheduleRow(db, userId);
  return current?.generation === generation && current.run_id === nextRunId;
}
