import { readFileSync } from 'node:fs';
import { getDatabase } from '../lib/database.ts';

// Run with a private snapshot and a server-only DATABASE_URL. Never commit snapshots.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migration');
const source = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (source.version !== 1 || !source.tables) throw new Error('Invalid Sites export');
const tables: Record<string,string[]> = {
 intel_items:['id','payload','updated_at'], editions:['date','payload','updated_at','status'],
 favorites:['user_id','item_id','collection','note','created_at','updated_at'],
 preferences:['user_id','email','delivery_time','email_enabled'],
 runs:['id','kind','status','detail','created_at'], settings:['key','value','updated_at'],
};
const users = new Set([...source.tables.favorites, ...source.tables.preferences].map((row: Record<string,unknown>) => row.user_id));
if (users.size > 1) throw new Error('Multiple source users found; explicit identity mapping is required');
const db = getDatabase();
const statements = Object.entries(tables).flatMap(([table, columns]) => {
 if (!Array.isArray(source.tables[table])) throw new Error(`Missing table ${table}`);
 return source.tables[table].map((row: Record<string,string|number|null>) => db.prepare(
  `INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')}) ON CONFLICT DO NOTHING`,
 ).bind(...columns.map(column => column === 'user_id' ? 'github:107673736' : row[column])));
});
await db.batch(statements);
const counts: Record<string,unknown> = {};
for (const table of Object.keys(tables)) counts[table] = (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first())?.count;
console.log(JSON.stringify({imported:true,sourceExportedAt:source.exportedAt,counts}));
