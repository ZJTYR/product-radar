import type { RadarDatabase } from './database.ts';
import type { IntelItem } from './types.ts';

export function canonicalPayload(value: unknown): string {
 const stable = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(stable) : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry).sort(([a],[b])=>a.localeCompare(b)).map(([key,nested])=>[key,stable(nested)])) : entry;
 return JSON.stringify(stable(value));
}

export async function persistEdition(db: RadarDatabase,date: string,items: IntelItem[],status: string,kind: string,at=new Date().toISOString()) {
 const equal=db.jsonEqual('editions.payload','excluded.payload');
 const changedVersion=db.nextTimestamp('editions.updated_at','excluded.updated_at');
 // 在同一原子UPSERT中比较实际现存内容，不从先前读取的快照推测版本。
 await db.batch([
  ...items.map(item=>db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(item.id,canonicalPayload(item),at)),
  db.prepare(`INSERT INTO editions(date,payload,updated_at,status) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET payload=excluded.payload,updated_at=CASE WHEN ${equal} THEN editions.updated_at ELSE ${changedVersion} END,status=excluded.status`).bind(date,canonicalPayload(items),at,status),
  db.prepare('INSERT INTO runs(id,kind,status,detail,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),kind,status,JSON.stringify({count:items.length,date}),at),
 ]);
 const stored=await db.prepare('SELECT updated_at as "updatedAt" FROM editions WHERE date=?').bind(date).first<{updatedAt:string}>();
 return stored!.updatedAt;
}
