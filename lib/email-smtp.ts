import { z } from 'zod';
import type { EmailReadiness } from './email-types.ts';

export interface InlinePosterAttachment { filename: string; contentType: 'image/png'; contentBase64: string; cid: string }
export interface EmailMessage { subject: string; text: string; html: string; templateVersion?: string; attachments?: InlinePosterAttachment[] }
export interface EmailEnvelope extends EmailMessage { recipient: string; messageId: string }
export interface EmailSendResult { messageId: string; accepted: boolean }
export type EmailSender = (message: EmailEnvelope) => Promise<EmailSendResult>;
type SmtpEnvironment = Record<string, string | undefined>;

const address = z.string().trim().email().max(254);
function smtpConfig(env: SmtpEnvironment) {
  const host = (env.SMTP_HOST || '').trim();
  const port = Number(env.SMTP_PORT || 465);
  const secure = env.SMTP_SECURE === undefined ? port === 465 : env.SMTP_SECURE === 'true';
  const user = (env.SMTP_USER || '').trim();
  const pass = env.SMTP_PASS || '';
  const from = (env.MAIL_FROM || '').trim();
  if (!host || !/^[a-zA-Z0-9.-]+$/.test(host) || ![465, 587].includes(port) || (port === 465 && !secure) || !address.safeParse(user).success || !address.safeParse(from).success || !pass.trim()) return null;
  return { host, port, secure, user, pass, from };
}

export function emailReadiness(env: SmtpEnvironment = process.env): EmailReadiness {
  return { deliveryReady: Boolean(smtpConfig(env)), deliveryMode: 'scheduled', deliveryReason: smtpConfig(env) ? '按保存的北京时间定时发送热点海报，默认 20:00；同一天只发送一份。' : 'SMTP 发信配置尚未完整，请先完成服务端配置。' };
}

/** 附件只接受内存中的 PNG，绝不把冻结 JSON 当作文件路径或远端 URL。 */
export function inlinePosterAttachments(message: EmailMessage) {
  if (!message.attachments) return [];
  if (message.attachments.length !== 1) throw Object.assign(new Error('Invalid poster attachment count'), { code: 'EPOSTER' });
  return message.attachments.map(value => {
    if (!value || value.contentType !== 'image/png' || !/^[a-zA-Z0-9._-]+\.png$/.test(value.filename) || !/^[a-zA-Z0-9._-]+@product-radar\.local$/.test(value.cid) || typeof value.contentBase64 !== 'string' || value.contentBase64.length > 7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.contentBase64)) throw Object.assign(new Error('Invalid poster attachment'), { code: 'EPOSTER' });
    const content = Buffer.from(value.contentBase64, 'base64');
    if (content.length < 24 || content.toString('base64') !== value.contentBase64 || !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || content.readUInt32BE(16) > 4000 || content.readUInt32BE(20) > 12000) throw Object.assign(new Error('Invalid poster PNG'), { code: 'EPOSTER' });
    return { filename: value.filename, content, contentType: value.contentType, cid: value.cid, contentDisposition: 'inline' as const };
  });
}

/** 只使用服务端配置；保留 TLS 校验，不读取 URL 或文件附件。 */
export const sendSmtp: EmailSender = async message => {
  const attachments = inlinePosterAttachments(message);
  const config = smtpConfig(process.env);
  if (!config) throw Object.assign(new Error('SMTP configuration missing'), { code: 'ECONFIG' });
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({
    host: config.host, port: config.port, secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: config.host },
    connectionTimeout: 12_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from: { name: '拾光', address: config.from }, to: message.recipient,
      replyTo: config.from, subject: message.subject, text: message.text, html: message.html,
      messageId: message.messageId, attachments,
    });
    return { messageId: result.messageId || message.messageId, accepted: result.accepted.some(value => String(value).toLowerCase() === message.recipient.toLowerCase()) };
  } finally { transport.close(); }
};

/** 错误详情可能含邮箱或服务端响应，用户状态与日志只保存固定摘要。 */
export function smtpFailure(error: unknown): { status: 'failed' | 'unknown'; message: string } {
  const value = error && typeof error === 'object' ? error as { code?: string; command?: string; responseCode?: number } : {};
  const command = (value.command || '').toUpperCase();
  const explicitlyRejected = command !== 'QUIT' && typeof value.responseCode === 'number' && value.responseCode >= 400 && value.responseCode < 600;
  const beforeData = /^(CONN|EHLO|HELO|STARTTLS|AUTH(?: |$)|MAIL FROM|RCPT TO)/.test(command);
  const locallyRejected = ['ECONFIG', 'EAUTH', 'ENOAUTH', 'EOAUTH2', 'EDNS', 'ETLS', 'EREQUIRETLS', 'EENVELOPE', 'EMAXRECIPIENTS', 'EFILEACCESS', 'EURLACCESS', 'EPOSTER'].includes(value.code || '');
  if (explicitlyRejected || beforeData || locallyRejected) {
    const message = value.code === 'EAUTH' || value.code === 'ENOAUTH' ? 'SMTP 登录失败，请核对邮箱授权码和服务开关。' : value.code === 'ECONFIG' ? 'SMTP 发信配置尚未完整。' : value.code === 'EPOSTER' ? '海报附件无效，邮件尚未发送。' : '发信服务明确拒绝或尚未开始接收邮件；处理原因后可重试。';
    return { status: 'failed', message };
  }
  return { status: 'unknown', message: '发送结果暂不确定，请先查收或检查邮箱发信记录；系统不会自动重发。' };
}
