import { database, initialize, json, route } from '@/lib/server';
export const dynamic = 'force-dynamic';
// Owner-private administrative backup. Never make this Site public.
export function GET() { return route(async () => {
 await initialize(); const db = database();
 const tables = ['intel_items','editions','favorites','preferences','runs','settings'] as const;
 const entries = await Promise.all(tables.map(async name => [name,(await db.prepare(
  name === 'settings' ? "SELECT * FROM settings WHERE key NOT LIKE 'mirror:%'" : `SELECT * FROM ${name}`,
 ).all()).results]));
 return json({version:1,exportedAt:new Date().toISOString(),tables:Object.fromEntries(entries)});
}); }
