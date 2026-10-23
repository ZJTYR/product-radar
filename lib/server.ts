import { getDatabase } from './database';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { seedItems } from './seed';
import type { IntelItem } from './types';
import { isSameOriginMutation } from './validation';
import { ZodError } from 'zod';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function database() { return getDatabase(); }
export const now = () => new Date().toISOString();
export function shanghaiDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); }
export function emailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM); }
export async function currentUser() { const user = await getChatGPTUser(); if (!user) throw new HttpError(401, '请先登录以保存个人收藏与偏好'); return user; }
export function checkMutation(request: Request) { if (!isSameOriginMutation(request)) throw new HttpError(403, '请从工作台内提交此操作'); }
export async function body(request: Request) { const value = await request.text(); if (value.length > 500_000) throw new HttpError(413, '内容过大'); try { return JSON.parse(value); } catch { throw new HttpError(400, '请求 JSON 格式无效'); } }
export function route(fn: () => Promise<Response>) { return (async () => { await currentUser(); return fn(); })().catch(error => { if (error instanceof ZodError) return Response.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('；') }, { status: 400 }); if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status }); console.error('Product Radar API failure', error); return Response.json({ error: '资料读取或保存失败，请稍后重试' }, { status: 500 }); }); }
export function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function initialize() {
 const db = database();
 if (await db.prepare("SELECT key FROM settings WHERE key='seed_initialized'").first()) return;
 const at = seedItems.map(i => i.starsCheckedAt || i.discoveredAt).sort().at(-1) || now();
 const statements = seedItems.map(item => db.prepare('INSERT INTO intel_items (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO NOTHING').bind(item.id, JSON.stringify(item), at));
 const byDay = new Map<string, IntelItem[]>();
 for (const item of seedItems) { const date = new Date(item.discoveredAt).toLocaleDateString('en-CA', {timeZone:'Asia/Shanghai'}); byDay.set(date, [...(byDay.get(date) || []), item]); }
 for (const [date, items] of byDay) statements.push(db.prepare('INSERT INTO editions (date,payload,updated_at,status) VALUES (?,?,?,?) ON CONFLICT(date) DO NOTHING').bind(date, JSON.stringify(items), at, 'curated'));
 statements.push(db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('seed_initialized','v1',?) ON CONFLICT(key) DO NOTHING").bind(at));
 await db.batch(statements);
}
export async function library() { const result = await database().prepare('SELECT payload FROM intel_items ORDER BY updated_at DESC,id').all<{payload: string}>(); return result.results.map(row => JSON.parse(row.payload) as IntelItem); }
export async function setting(key: string) { return (await database().prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{value:string}>())?.value; }
export async function saveEdition(date: string, items: IntelItem[], status: string, kind: string) {
 const db = database(); const at = now();
 // Database batches are transactional: the library and full daily snapshot commit together. Stable IDs make ingest replay safe.
 await db.batch([
 ...items.map(item => db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(item.id,JSON.stringify(item),at)),
 db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at,status=excluded.status').bind(date,JSON.stringify(items),at,status),
 db.prepare('INSERT INTO runs(id,kind,status,detail,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),kind,status,JSON.stringify({count:items.length,date}),at),
 ]);
 return at;
}
