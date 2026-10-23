import { neon } from '@neondatabase/serverless';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const schema = [
 'CREATE TABLE IF NOT EXISTS intel_items (id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS editions (date TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL,status TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL,item_id TEXT NOT NULL,collection TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,item_id))',
 'CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY,email TEXT NOT NULL,delivery_time TEXT NOT NULL,email_enabled INTEGER NOT NULL DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)',
];
type Value = string | number | null;
type Row = Record<string, unknown>;
// Existing queries contain no question marks in SQL literals. Values always stay bound.
export function postgresQuery(query: string) { let i=0; return query.replace(/\?/g, () => `$${++i}`); }
class Statement {
 constructor(readonly db: RadarDatabase, readonly query: string, readonly values: Value[] = []) {}
 bind(...values: Value[]) { return new Statement(this.db, this.query, values); }
 async all<T = Row>() { return { results: await this.db.execute(this) as T[] }; }
 async first<T = Row>() { return (await this.all<T>()).results[0] ?? null; }
 async run() { await this.db.execute(this); return { success: true }; }
}
export class RadarDatabase {
 private local?: DatabaseSync;
 private remote?: ReturnType<typeof neon>;
 private ready?: Promise<void>;
 constructor(private url?: string, private localPath = '.local/radar.sqlite') {}
 prepare(query: string) { return new Statement(this, query); }
 private initialize() {
  if (!this.ready) this.ready = (async () => {
   if (this.url) {
    this.remote = neon(this.url);
    await this.remote.transaction(schema.map(query => this.remote!.query(query)));
   } else {
    if (process.env.VERCEL) throw new Error('DATABASE_URL is required on Vercel');
    mkdirSync(dirname(this.localPath), { recursive: true });
    this.local = new DatabaseSync(this.localPath);
    this.local.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    for (const query of schema) this.local.exec(query);
   }
  })().catch(error => { this.ready = undefined; throw error; });
  return this.ready;
 }
 async execute(statement: Statement): Promise<Row[]> {
  await this.initialize();
  if (this.remote) return await this.remote.query(postgresQuery(statement.query), statement.values) as Row[];
  const prepared = this.local!.prepare(statement.query);
  if (/^\s*(SELECT|WITH)\b/i.test(statement.query)) return prepared.all(...statement.values) as Row[];
  prepared.run(...statement.values); return [];
 }
 async batch(statements: Statement[]) {
  await this.initialize();
  if (statements.some(statement => statement.db !== this)) throw new Error('Mixed database batch');
  if (this.remote) return this.remote.transaction(statements.map(statement => this.remote!.query(postgresQuery(statement.query), statement.values)));
  this.local!.exec('BEGIN IMMEDIATE');
  try {
   const results = statements.map(statement => this.local!.prepare(statement.query).run(...statement.values));
   this.local!.exec('COMMIT'); return results;
  } catch (error) { this.local!.exec('ROLLBACK'); throw error; }
 }
 close() { this.local?.close(); }
}
let db: RadarDatabase | undefined;
export function getDatabase() { return db ??= new RadarDatabase(process.env.DATABASE_URL); }
