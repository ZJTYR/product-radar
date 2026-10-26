import type { RadarDatabase } from './database.ts';
import type { HistoryDay, ItemRead } from './types.ts';

export class ReadingRecordMissing extends Error {}
export class ReadingVersionConflict extends Error {}

export async function itemReadingState(db: RadarDatabase, userId: string) {
 const rows = await db.prepare('SELECT item_id as "itemId",read_at as "readAt" FROM reading_items WHERE user_id=? ORDER BY read_at DESC,item_id').bind(userId).all<ItemRead>();
 return { items: rows.results };
}

export async function recordItemRead(db: RadarDatabase, userId: string, itemId: string) {
 if (!await db.prepare('SELECT id FROM intel_items WHERE id=?').bind(itemId).first()) throw new ReadingRecordMissing('找不到该内容');
 // 已看是中性记录，不修改反馈、收藏或兴趣权重；重复打开保留首次阅读时间。
 await db.prepare('INSERT INTO reading_items(user_id,item_id,read_at) VALUES(?,?,?) ON CONFLICT(user_id,item_id) DO NOTHING').bind(userId,itemId,new Date().toISOString()).run();
 return itemReadingState(db,userId);
}

export async function editionReadingState(db: RadarDatabase, userId: string) {
 const rows = await db.prepare('SELECT e.date,e.payload,e.updated_at as "updatedAt",e.status,r.read_at as "readAt",r.read_version as "readVersion" FROM editions e LEFT JOIN edition_reads r ON r.edition_date=e.date AND r.user_id=? ORDER BY e.date DESC LIMIT 365').bind(userId).all<{date:string;payload:string;updatedAt:string;status:string;readAt:string|null;readVersion:string|null}>();
 const days: HistoryDay[] = rows.results.map(row=>({date:row.date,count:JSON.parse(row.payload).length,updatedAt:row.updatedAt,status:row.status,readAt:row.readAt,hasUpdates:Boolean(row.readAt && row.readVersion && Date.parse(row.updatedAt)>Date.parse(row.readVersion))}));
 return { days };
}

export async function setEditionRead(db: RadarDatabase,userId: string,date: string,read: boolean,version?: string) {
 const edition=await db.prepare('SELECT updated_at as "updatedAt" FROM editions WHERE date=?').bind(date).first<{updatedAt:string}>();
 if(!edition) throw new ReadingRecordMissing('这一天还没有简报');
 if(read) {
  if(!version || !Number.isFinite(Date.parse(version)) || Date.parse(version)>Date.parse(edition.updatedAt)) throw new ReadingVersionConflict('简报版本无效，请重新打开后再标记已读');
  const normalizedVersion=new Date(version).toISOString();
  // 只记录客户端实际打开的版本；新内容在请求期间到达时仍会显示“有更新”。
  await db.prepare('INSERT INTO edition_reads(user_id,edition_date,read_at,read_version) VALUES(?,?,?,?) ON CONFLICT(user_id,edition_date) DO UPDATE SET read_at=CASE WHEN excluded.read_version>=edition_reads.read_version THEN excluded.read_at ELSE edition_reads.read_at END,read_version=CASE WHEN excluded.read_version>=edition_reads.read_version THEN excluded.read_version ELSE edition_reads.read_version END').bind(userId,date,new Date().toISOString(),normalizedVersion).run();
 } else await db.prepare('DELETE FROM edition_reads WHERE user_id=? AND edition_date=?').bind(userId,date).run();
 return editionReadingState(db,userId);
}
