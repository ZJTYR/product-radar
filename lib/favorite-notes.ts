import { createHash, randomUUID } from 'node:crypto';
import type { RadarDatabase } from './database.ts';
import type { IntelItem } from './types.ts';
import type { ReadingAnnotation } from './annotations.ts';

// 旧备注保留为兼容存档；相同所有者、产品和原文只建立一条可编辑笔记。
// 分类变化、重载、并发请求和旧客户端重试都不会覆盖已编辑或已删除的笔记。
export async function favoriteNoteInserts(db: RadarDatabase, userId: string, itemId?: string) {
  const query = db.prepare(`SELECT f.item_id as "itemId",f.note as body,f.created_at as "createdAt",f.updated_at as "updatedAt",i.payload as "itemPayload" FROM favorites f LEFT JOIN intel_items i ON i.id=f.item_id WHERE f.user_id=? AND TRIM(f.note)<>''${itemId ? ' AND f.item_id=?' : ''}`);
  const rows = await (itemId ? query.bind(userId, itemId) : query.bind(userId)).all<{ itemId: string; body: string; createdAt: string; updatedAt: string; itemPayload: string | null }>();
  return rows.results.filter(row => row.body.trim()).map(row => {
    const identity = JSON.stringify(['favorite-note-v1', userId, row.itemId, row.body]);
    const hash = createHash('sha256').update(identity).digest('hex');
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const item = row.itemPayload ? JSON.parse(row.itemPayload) as IntelItem : null;
    const version = randomUUID();
    const note: ReadingAnnotation = {
      id, itemId: row.itemId, itemName: item?.name || row.itemId, itemTitle: item?.title || '', itemUrl: item?.website || '',
      sourceDate: null, anchors: [], quote: '', body: row.body,
      createdAt: row.createdAt, updatedAt: row.updatedAt, version, deletedAt: null,
    };
    return db.prepare('INSERT INTO reading_annotations(id,user_id,item_id,payload,version,create_version,create_request,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(id, userId, row.itemId, JSON.stringify(note), version, version, identity, null, row.createdAt, row.updatedAt);
  });
}
