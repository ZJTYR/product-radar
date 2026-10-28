import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { createAnnotationAnchor, getAnnotationBlocks } from '../lib/annotations.ts';
import { AnnotationError, createAnnotation, listAnnotations, updateAnnotation } from '../lib/annotation-store.ts';
import { saveFavorite, removeFavorite, updateFavoriteCollection } from '../lib/feedback.ts';
import { exportNotesMarkdown } from '../lib/annotations.ts';
import { annotationCreateSchema, annotationUpdateSchema } from '../lib/annotation-validation.ts';

const at = '2026-10-26T00:30:00.000Z';
const item = { ...seedItems[0], id: 'annotation-product', name: '笔记测试产品', title: '将重复任务整理成可检查的工作流', audience: '产品经理与运营团队可以把重复任务交给工具，再检查最终结果。', pain: '知识分散，重复整理资料会耗费时间。' };
const historical = { ...item, title: '历史产品介绍', audience: '旧版面向需要整理知识的团队。' };
const requestFor = (overrides = {}) => ({
  id: randomUUID(), itemId: item.id,
  anchors: [createAnnotationAnchor('audience', item.audience, 0, 9)],
  body: '可以在我们的项目中验证这个流程。', ...overrides,
});

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'radar-annotations-'));
  const path = join(directory, 'notes.sqlite');
  const db = new RadarDatabase(undefined, path);
  try {
    await db.batch([
      db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES(?,?,?)').bind(item.id, JSON.stringify(item), at),
      db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES(?,?,?,?)').bind('2026-10-26', JSON.stringify([historical]), at, 'complete'),
      db.prepare('INSERT INTO favorites(user_id,item_id,collection,note,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('owner', item.id, '工作流', '', at, at),
      db.prepare('INSERT INTO favorites(user_id,item_id,collection,note,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('other', item.id, '私人分类', '', at, at),
    ]);
    await run(db, path);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

function hasStatus(status) { return error => error instanceof AnnotationError && error.status === status; }

test('reading annotations persist with server-derived product metadata and context, and remain isolated by owner', async () => fixture(async (db, path) => {
  const input = requestFor();
  input.anchors[0].prefix = '不可信的客户端前缀';
  input.anchors[0].suffix = '不可信的客户端后缀';
  const note = await createAnnotation(db, 'owner', input);
  assert.equal(note.itemName, item.name); assert.equal(note.itemTitle, item.title); assert.equal(note.itemUrl, item.website);
  assert.equal(note.sourceDate, null); assert.equal(note.deletedAt, null);
  assert.deepEqual(note.anchors[0], createAnnotationAnchor('audience', item.audience, 0, 9));
  assert.equal(note.quote, item.audience.slice(0, 9));
  const reopened = new RadarDatabase(undefined, path);
  try {
    assert.deepEqual((await listAnnotations(reopened, 'owner')).notes, [note]);
    assert.deepEqual((await listAnnotations(reopened, 'other')).notes, []);
    await assert.rejects(updateAnnotation(reopened, 'other', { id: note.id, version: note.version, body: '越权修改' }), hasStatus(404));
    await assert.rejects(createAnnotation(reopened, 'other', input), hasStatus(404));
    assert.equal((await listAnnotations(reopened, 'owner', item.id)).notes.length, 1);
    assert.equal((await listAnnotations(reopened, 'owner', 'another-product')).notes.length, 0);
  } finally { reopened.close(); }
}));

test('creation is replay-safe but an old create cannot overwrite a later thought or restore a deleted note', async () => fixture(async db => {
  const input = requestFor();
  const first = await createAnnotation(db, 'owner', input);
  assert.deepEqual(await createAnnotation(db, 'owner', input), first);
  assert.equal((await listAnnotations(db, 'owner')).notes.length, 1);
  await assert.rejects(createAnnotation(db, 'owner', { ...input, body: '同一ID的不同请求' }), hasStatus(409));
  const edited = await updateAnnotation(db, 'owner', { id: first.id, version: first.version, body: '更新后的想法' });
  await assert.rejects(createAnnotation(db, 'owner', input), hasStatus(409));
  assert.equal((await listAnnotations(db, 'owner')).notes[0].body, edited.body);
  const deleted = await updateAnnotation(db, 'owner', { id: edited.id, version: edited.version, deleted: true });
  assert.ok(deleted.deletedAt);
  await assert.rejects(createAnnotation(db, 'owner', input), hasStatus(409));
  assert.equal((await listAnnotations(db, 'owner')).notes.length, 0);
}));

test('selected text is checked against the actual current or historical reading source', async () => fixture(async db => {
  const input = requestFor();
  await assert.rejects(createAnnotation(db, 'owner', { ...input, anchors: [{ ...input.anchors[0], quote: '伪造原文' }] }), hasStatus(409));
  await assert.rejects(createAnnotation(db, 'owner', { ...input, anchors: [{ ...input.anchors[0], blockId: 'notAParagraph' }] }), hasStatus(409));
  await assert.rejects(createAnnotation(db, 'owner', { ...input, anchors: [{ ...input.anchors[0], start: 7000, end: 7010 }] }), hasStatus(409));
  await assert.rejects(createAnnotation(db, 'owner', { ...input, sourceDate: '2026-10-25' }), hasStatus(404));
  await assert.rejects(createAnnotation(db, 'owner', { ...input, itemId: 'missing' }), hasStatus(404));
  const historyInput = requestFor({ sourceDate: '2026-10-26', anchors: [createAnnotationAnchor('audience', historical.audience, 0, historical.audience.length)] });
  const archived = await createAnnotation(db, 'owner', historyInput);
  assert.equal(archived.itemTitle, historical.title); assert.equal(archived.sourceDate, '2026-10-26'); assert.equal(archived.quote, historical.audience);
  await assert.rejects(createAnnotation(db, 'owner', { ...historyInput, id: randomUUID(), sourceDate: null }), hasStatus(409));
  // Original requests still replay after a source edit because they never recreate or replace the snapshot.
  await db.prepare('UPDATE intel_items SET payload=? WHERE id=?').bind(JSON.stringify({ ...item, audience: '改版后的原文' }), item.id).run();
  assert.deepEqual(await createAnnotation(db, 'owner', historyInput), archived);
}));

test('one stale editor cannot overwrite another across database connections', async () => fixture(async (db, path) => {
  const original = await createAnnotation(db, 'owner', requestFor());
  const otherConnection = new RadarDatabase(undefined, path);
  try {
    const writes = await Promise.allSettled([
      updateAnnotation(db, 'owner', { id: original.id, version: original.version, body: '第一个编辑器' }),
      updateAnnotation(otherConnection, 'owner', { id: original.id, version: original.version, body: '第二个编辑器' }),
    ]);
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(writes.filter(result => result.status === 'rejected' && hasStatus(409)(result.reason)).length, 1);
    const winner = writes.find(result => result.status === 'fulfilled').value;
    assert.deepEqual((await listAnnotations(db, 'owner')).notes[0], winner);
    await assert.rejects(updateAnnotation(otherConnection, 'owner', { id: original.id, version: original.version, deleted: true }), hasStatus(409));
  } finally { otherConnection.close(); }
}));

test('soft deletion can be undone with its version while content and quote remain intact', async () => fixture(async db => {
  const original = await createAnnotation(db, 'owner', requestFor());
  const deleted = await updateAnnotation(db, 'owner', { id: original.id, version: original.version, deleted: true });
  assert.equal((await listAnnotations(db, 'owner')).notes.length, 0);
  await assert.rejects(updateAnnotation(db, 'owner', { id: deleted.id, version: deleted.version, body: '直接改已删除内容' }), hasStatus(409));
  const restored = await updateAnnotation(db, 'owner', { id: deleted.id, version: deleted.version, deleted: false });
  assert.equal(restored.deletedAt, null); assert.equal(restored.body, original.body); assert.deepEqual(restored.anchors, original.anchors);
  assert.notEqual(restored.version, deleted.version);
  assert.deepEqual((await listAnnotations(db, 'owner')).notes, [restored]);
}));

test('plain thoughts and highlights keep their own requirements, while old favorite notes become editable notes', async () => fixture(async db => {
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('已有收藏备注', 'owner').run();
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('另一个用户的备注', 'other').run();
  const thought = await createAnnotation(db, 'owner', requestFor({ anchors: [], body: '不针对某段文字的整体想法' }));
  assert.equal(thought.quote, ''); assert.equal(thought.anchors.length, 0);
  await assert.rejects(updateAnnotation(db, 'owner', { id: thought.id, version: thought.version, body: ' \n ' }), hasStatus(400));
  const highlight = await createAnnotation(db, 'owner', requestFor({ body: '' }));
  assert.ok(highlight.quote); assert.equal(highlight.body, '');
  const state = await listAnnotations(db, 'owner');
  assert.equal(state.notes.length, 3); assert.equal(state.favoriteNotes.length, 0);
  const imported = state.notes.find(note => note.body === '已有收藏备注');
  assert.equal(imported.itemName, item.name);
  assert.equal((await listAnnotations(db, 'other')).notes[0].body, '另一个用户的备注');
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=? AND item_id=?').bind(' \n\t ', 'owner', item.id).run();
  assert.deepEqual((await listAnnotations(db, 'owner')).favoriteNotes, []);
}));

test('catalog changes retain annotations and their original quote and product title snapshots', async () => fixture(async db => {
  const note = await createAnnotation(db, 'owner', requestFor());
  const originalEdition = await db.prepare('SELECT payload FROM editions WHERE date=?').bind('2026-10-26').first();
  const changed = { ...item, title: '新标题', audience: '新版完全改写这一段。', images: [{ url: 'https://example.com/shot.png', caption: '官方截图', sourceUrl: 'https://example.com/' }] };
  await db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(item.id, JSON.stringify(changed), new Date().toISOString()).run();
  assert.deepEqual((await listAnnotations(db, 'owner')).notes, [note]);
  assert.deepEqual(await db.prepare('SELECT payload FROM editions WHERE date=?').bind('2026-10-26').first(), originalEdition);
  const edited = await updateAnnotation(db, 'owner', { id: note.id, version: note.version, body: '原文更新后仍能补充我的想法' });
  assert.equal(edited.quote, note.quote); assert.equal(edited.itemTitle, note.itemTitle);
}));

test('annotation input rejects forged identities, unbounded quotes, duplicate blocks and anchor edits', () => {
  const good = requestFor();
  assert.equal(annotationCreateSchema.safeParse(good).success, true);
  assert.equal(annotationCreateSchema.safeParse({ ...good, userId: 'other' }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, itemName: '伪造产品' }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, anchors: [], body: '  ' }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, body: '字'.repeat(10001) }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, anchors: [good.anchors[0], good.anchors[0]] }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, anchors: [{ ...good.anchors[0], start: -1 }] }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, anchors: [{ ...good.anchors[0], start: 2, end: 2 }] }).success, false);
  assert.equal(annotationCreateSchema.safeParse({ ...good, sourceDate: '2026-02-30' }).success, false);
  const longAnchors = getAnnotationBlocks(item).slice(0, 2).map((block, index) => ({ blockId: block.id, start: 0, end: 4500, quote: String(index).repeat(4500), prefix: '', suffix: '' }));
  assert.equal(annotationCreateSchema.safeParse({ ...good, anchors: longAnchors }).success, false);
  assert.equal(annotationUpdateSchema.safeParse({ id: good.id, version: randomUUID(), anchors: good.anchors }).success, false);
  assert.equal(annotationUpdateSchema.safeParse({ id: good.id, version: randomUUID(), itemId: 'other' }).success, false);
  assert.equal(annotationUpdateSchema.safeParse({ id: good.id, version: randomUUID() }).success, false);
  assert.equal(annotationUpdateSchema.safeParse({ id: good.id, version: 'bad-version', body: '想法' }).success, false);
});


test('favorite note import preserves content, product and original times across concurrent reads; edits and deletions are never replayed', async () => fixture(async (db, path) => {
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('原有备注\n保持换行与空格 ', 'owner').run();
  const second = new RadarDatabase(undefined, path);
  try {
    await Promise.all([listAnnotations(db, 'owner'), listAnnotations(second, 'owner')]);
    const first = await listAnnotations(db, 'owner');
    assert.equal(first.notes.length, 1); assert.deepEqual(first.favoriteNotes, []);
    const imported = first.notes[0];
    assert.equal(imported.body, '原有备注\n保持换行与空格 ');
    assert.equal(imported.createdAt, at); assert.equal(imported.updatedAt, at);
    assert.equal(imported.itemId, item.id); assert.equal(imported.itemName, item.name); assert.equal(imported.itemUrl, item.website);
    const edited = await updateAnnotation(db, 'owner', { id: imported.id, version: imported.version, body: '统一编辑后的想法' });
    assert.deepEqual((await listAnnotations(second, 'owner')).notes, [edited]);
    const output = exportNotesMarkdown([edited], []);
    assert.equal(output.split('统一编辑后的想法').length, 2); assert.ok(!output.includes('原有备注'));
    const deleted = await updateAnnotation(db, 'owner', { id: edited.id, version: edited.version, deleted: true });
    assert.deepEqual((await listAnnotations(db, 'owner')).notes, []);
    const restored = await updateAnnotation(db, 'owner', { id: deleted.id, version: deleted.version, deleted: false });
    assert.equal((await listAnnotations(second, 'owner')).notes[0].body, restored.body);
    assert.equal((await db.prepare('SELECT note FROM favorites WHERE user_id=?').bind('owner').first()).note, imported.body);
  } finally { second.close(); }
}));

test('removing a favorite before opening the notebook preserves its old remark as an independent editable note', async () => fixture(async db => {
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('取消收藏也不能丢的备注', 'owner').run();
  await removeFavorite(db, 'owner', item.id);
  assert.equal(await db.prepare('SELECT item_id FROM favorites WHERE user_id=?').bind('owner').first(), null);
  const imported = (await listAnnotations(db, 'owner')).notes[0];
  assert.equal(imported.body, '取消收藏也不能丢的备注'); assert.equal(imported.createdAt, at);
  const edited = await updateAnnotation(db, 'owner', { id: imported.id, version: imported.version, body: '取消收藏后继续编辑' });
  assert.equal(edited.body, '取消收藏后继续编辑');
  await saveFavorite(db, 'owner', { itemId: item.id, collection: '重新收藏', note: '' });
  assert.deepEqual((await listAnnotations(db, 'owner')).notes, [edited]);
}));

test('collection-only saves preserve remarks and note timestamps and reject stale editors or cancelled favorites', async () => fixture(async db => {
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('分类修改前的备注', 'owner').run();
  const moved = await updateFavoriteCollection(db, 'owner', { itemId: item.id, collection: '值得试用', expectedCollection: '工作流' });
  assert.equal(moved.collection, '值得试用'); assert.equal(moved.note, '分类修改前的备注'); assert.equal(moved.createdAt, at);
  const imported = (await listAnnotations(db, 'owner')).notes[0];
  assert.equal(imported.updatedAt, at);
  assert.equal((await updateFavoriteCollection(db, 'owner', { itemId: item.id, collection: '值得试用', expectedCollection: '工作流' })).collection, '值得试用');
  await assert.rejects(updateFavoriteCollection(db, 'owner', { itemId: item.id, collection: '过期修改', expectedCollection: '工作流' }), /分类已在其他页面修改/);
  assert.equal((await db.prepare('SELECT collection FROM favorites WHERE user_id=?').bind('other').first()).collection, '私人分类');
  await removeFavorite(db, 'owner', item.id);
  await assert.rejects(updateFavoriteCollection(db, 'owner', { itemId: item.id, collection: '误恢复', expectedCollection: '值得试用' }), /收藏已取消/);
  assert.deepEqual((await listAnnotations(db, 'owner')).notes, [imported]);
}));

test('old clients cannot erase an earlier remark when saving a different one, and imports keep edited snapshots', async () => fixture(async db => {
  await db.prepare('UPDATE favorites SET note=? WHERE user_id=?').bind('旧版第一条备注', 'owner').run();
  await saveFavorite(db, 'owner', { itemId: item.id, collection: '工作流', note: '旧客户端补充的备注' });
  const notes = (await listAnnotations(db, 'owner')).notes;
  assert.deepEqual(notes.map(note => note.body).sort(), ['旧版第一条备注', '旧客户端补充的备注'].sort());
  const first = notes.find(note => note.body === '旧版第一条备注');
  await updateAnnotation(db, 'owner', { id: first.id, version: first.version, body: '已编辑的新内容' });
  await saveFavorite(db, 'owner', { itemId: item.id, collection: '工作流', note: '旧版第一条备注' });
  const refreshed = (await listAnnotations(db, 'owner')).notes;
  assert.equal(refreshed.length, 2); assert.ok(refreshed.some(note => note.body === '已编辑的新内容'));
}));
