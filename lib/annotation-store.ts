import { randomUUID } from 'node:crypto';
import type { RadarDatabase } from './database.ts';
import type { IntelItem } from './types.ts';
import type { AnnotationList, ReadingAnnotation } from './annotations.ts';
import { createAnnotationAnchor, getAnnotationBlocks } from './annotations.ts';
import { annotationCreateSchema, annotationUpdateSchema } from './annotation-validation.ts';
import type { AnnotationCreateInput } from './annotation-validation.ts';
import { feedbackItemIdSchema } from './validation.ts';
import { favoriteNoteInserts } from './favorite-notes.ts';

export class AnnotationError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

interface AnnotationRow { payload: string; version: string; createVersion: string; createRequest: string; deletedAt: string | null; createdAt: string; updatedAt: string }

function noteFromRow(row: AnnotationRow): ReadingAnnotation {
  return { ...JSON.parse(row.payload), version: row.version, deletedAt: row.deletedAt, createdAt: row.createdAt, updatedAt: row.updatedAt } as ReadingAnnotation;
}

const noteColumns = 'payload,version,create_version as "createVersion",create_request as "createRequest",deleted_at as "deletedAt",created_at as "createdAt",updated_at as "updatedAt"';

async function rowFor(db: RadarDatabase, userId: string, id: string) {
  return db.prepare(`SELECT ${noteColumns} FROM reading_annotations WHERE user_id=? AND id=?`).bind(userId, id).first<AnnotationRow>();
}

// The original request identity excludes client context strings, which are never trusted.
function createIdentity(value: AnnotationCreateInput) {
  return JSON.stringify({
    itemId: value.itemId,
    sourceDate: value.sourceDate ?? null,
    anchors: value.anchors.map(({ blockId, start, end, quote }) => ({ blockId, start, end, quote })),
    body: value.body,
  });
}

function replay(row: AnnotationRow, identity: string): ReadingAnnotation {
  if (row.createRequest !== identity || row.version !== row.createVersion || row.deletedAt) throw new AnnotationError(409, '这条笔记已保存或在其他位置修改，请刷新后查看');
  return noteFromRow(row);
}

async function sourceItem(db: RadarDatabase, itemId: string, sourceDate: string | null): Promise<IntelItem> {
  if (sourceDate) {
    const edition = await db.prepare('SELECT payload FROM editions WHERE date=?').bind(sourceDate).first<{ payload: string }>();
    const item = edition && (JSON.parse(edition.payload) as IntelItem[]).find(item => item.id === itemId);
    if (!item) throw new AnnotationError(404, '这期简报中没有找到该内容，请重新打开后记录');
    return item;
  }
  const row = await db.prepare('SELECT payload FROM intel_items WHERE id=?').bind(itemId).first<{ payload: string }>();
  if (!row) throw new AnnotationError(404, '内容暂时无法找到，请重新打开后记录');
  return JSON.parse(row.payload) as IntelItem;
}

export async function listAnnotations(db: RadarDatabase, userId: string, itemId?: string): Promise<AnnotationList> {
  const itemFilter = itemId === undefined ? undefined : feedbackItemIdSchema.parse(itemId);
  const imports = await favoriteNoteInserts(db, userId, itemFilter);
  if (imports.length) await db.batch(imports);
  const notesStatement = db.prepare(`SELECT ${noteColumns} FROM reading_annotations WHERE user_id=? AND deleted_at IS NULL${itemFilter ? ' AND item_id=?' : ''} ORDER BY updated_at DESC,id`);
  const notes = await (itemFilter ? notesStatement.bind(userId, itemFilter) : notesStatement.bind(userId)).all<AnnotationRow>();
  return { notes: notes.results.map(noteFromRow), favoriteNotes: [] };
}

export async function createAnnotation(db: RadarDatabase, userId: string, input: unknown): Promise<ReadingAnnotation> {
  const value = annotationCreateSchema.parse(input);
  const identity = createIdentity(value);
  const existing = await rowFor(db, userId, value.id);
  if (existing) return replay(existing, identity);
  const sourceDate = value.sourceDate ?? null;
  const item = await sourceItem(db, value.itemId, sourceDate);
  const blocks = new Map(getAnnotationBlocks(item).map(block => [block.id, block]));
  const anchors = value.anchors.map(anchor => {
    const block = blocks.get(anchor.blockId);
    if (!block || anchor.end > block.text.length || block.text.slice(anchor.start, anchor.end) !== anchor.quote) throw new AnnotationError(409, '原文或摘录位置已变化，请重新选择文字');
    return createAnnotationAnchor(anchor.blockId, block.text, anchor.start, anchor.end);
  });
  const at = new Date().toISOString();
  const version = randomUUID();
  const note: ReadingAnnotation = {
    id: value.id, itemId: item.id, itemName: item.name, itemTitle: item.title, itemUrl: item.website, sourceDate,
    anchors, quote: anchors.map(anchor => anchor.quote).join('\n\n'), body: value.body,
    createdAt: at, updatedAt: at, version, deletedAt: null,
  };
  await db.prepare('INSERT INTO reading_annotations(id,user_id,item_id,payload,version,create_version,create_request,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
    .bind(note.id, userId, item.id, JSON.stringify(note), version, version, identity, null, at, at).run();
  const saved = await rowFor(db, userId, value.id);
  if (!saved) throw new AnnotationError(404, '笔记未找到或无法保存，请重新记录');
  return replay(saved, identity);
}

export async function updateAnnotation(db: RadarDatabase, userId: string, input: unknown): Promise<ReadingAnnotation> {
  const value = annotationUpdateSchema.parse(input);
  const existing = await rowFor(db, userId, value.id);
  if (!existing) throw new AnnotationError(404, '笔记未找到，请刷新后查看');
  if (existing.version !== value.version) throw new AnnotationError(409, '笔记已在其他位置更新，请刷新后再编辑');
  const before = noteFromRow(existing);
  if (before.deletedAt && value.deleted !== false) throw new AnnotationError(409, '笔记已删除，请先恢复后再编辑');
  const nextBody = value.body ?? before.body;
  if (!before.anchors.length && !nextBody.trim()) throw new AnnotationError(400, '请写下想法，或删除这条笔记');
  const at = new Date().toISOString();
  const version = randomUUID();
  const note: ReadingAnnotation = { ...before, body: nextBody, updatedAt: at, version, deletedAt: value.deleted === true ? at : value.deleted === false ? null : before.deletedAt };
  await db.prepare('UPDATE reading_annotations SET payload=?,version=?,deleted_at=?,updated_at=? WHERE user_id=? AND id=? AND version=?')
    .bind(JSON.stringify(note), version, note.deletedAt, at, userId, note.id, value.version).run();
  const saved = await rowFor(db, userId, value.id);
  if (!saved || saved.version !== version) throw new AnnotationError(409, '笔记已在其他位置更新，请刷新后核对保存结果');
  return noteFromRow(saved);
}
