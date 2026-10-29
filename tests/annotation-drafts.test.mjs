import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationDraftKey, listAnnotationDrafts, parseAnnotationDraftAddress, readAnnotationDraft, writeAnnotationDraft, removeAnnotationDraft } from '../lib/annotation-drafts.ts';

const anchor = { blockId: 'summary', start: 0, end: 4, quote: '原文摘录', prefix: '', suffix: '后文' };
const note = { id: 'note-1', itemId: 'product-1', itemName: '产品', itemTitle: '标题', itemUrl: 'https://example.com', sourceDate: '2026-10-29', anchors: [anchor], quote: '原文摘录', body: '已保存的想法', createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z', version: 'version-1', deletedAt: null };
const draft = { id: 'note-1', body: '还在写的新想法', originalBody: note.body, note, updatedAt: '2026-10-29T01:00:00.000Z' };
function memoryStorage(map = new Map()) { return { get length() { return map.size; }, key: index => [...map.keys()][index] ?? null, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }; }

test('draft addresses isolate product, edition, note and quote context', () => {
  const addresses = [
    { itemId: 'product-1', anchors: [] },
    { itemId: 'product-2', anchors: [] },
    { itemId: 'product-1', sourceDate: '2026-10-28', anchors: [] },
    { itemId: 'product-1', sourceDate: '2026-10-29', anchors: [] },
    { itemId: 'product-1', annotationId: 'note-1' },
    { itemId: 'product-1', annotationId: 'note-2' },
    { itemId: 'product-1', anchors: [anchor] },
    { itemId: 'product-1', anchors: [{ ...anchor, suffix: '另一段后文' }] },
  ];
  assert.equal(new Set(addresses.map(annotationDraftKey)).size, addresses.length);
  assert.equal(annotationDraftKey({ itemId: 'product-1', sourceDate: null }), annotationDraftKey({ itemId: 'product-1' }));
});

test('a new storage instance restores content, operation id and original optimistic version', () => {
  const disk = new Map();
  const key = annotationDraftKey({ itemId: note.itemId, sourceDate: note.sourceDate, annotationId: note.id });
  assert.equal(writeAnnotationDraft(memoryStorage(disk), key, draft).persisted, true);
  assert.deepEqual(readAnnotationDraft(memoryStorage(disk), key), { draft });
  assert.equal(readAnnotationDraft(memoryStorage(disk), annotationDraftKey({ itemId: note.itemId, annotationId: note.id })).draft, null);
});

test('a draft can preserve removing all text from an existing thought', () => {
  const storage = memoryStorage();
  const key = annotationDraftKey({ itemId: note.itemId, annotationId: note.id });
  assert.equal(writeAnnotationDraft(storage, key, { ...draft, body: '' }).persisted, true);
  assert.equal(readAnnotationDraft(storage, key).draft.body, '');
  assert.equal(readAnnotationDraft(storage, key).draft.originalBody, note.body);
});

test('a new thought retains its operation id across refresh without needing a saved note', () => {
  const storage = memoryStorage();
  const key = annotationDraftKey({ itemId: 'product-1', anchors: [] });
  const fresh = { id: 'new-note-id', body: '想法草稿', originalBody: '', updatedAt: draft.updatedAt };
  assert.equal(writeAnnotationDraft(storage, key, fresh).persisted, true);
  assert.deepEqual(readAnnotationDraft(storage, key).draft, fresh);
});

test('saving or explicitly discarding removes only the addressed draft and can be repeated', () => {
  const storage = memoryStorage();
  const first = annotationDraftKey({ itemId: 'first' });
  const second = annotationDraftKey({ itemId: 'second' });
  writeAnnotationDraft(storage, first, draft); writeAnnotationDraft(storage, second, draft);
  assert.deepEqual(removeAnnotationDraft(storage, first), { removed: true });
  assert.deepEqual(removeAnnotationDraft(storage, first), { removed: true });
  assert.equal(readAnnotationDraft(storage, first).draft, null);
  assert.deepEqual(readAnnotationDraft(storage, second).draft, draft);
});

test('unavailable, quota-limited and silently dropped writes never report a persistent save', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(writeAnnotationDraft(null, 'key', draft).persisted, false);
  assert.equal(writeAnnotationDraft(broken, 'key', draft).persisted, false);
  assert.equal(readAnnotationDraft(broken, 'key').draft, null);
  assert.equal(removeAnnotationDraft(broken, 'key').removed, false);
  const dropped = { getItem: () => null, setItem() {}, removeItem() {} };
  assert.equal(writeAnnotationDraft(dropped, 'key', draft).persisted, false);
});

test('corrupt local data is reported and preserved for recovery', () => {
  const storage = memoryStorage();
  storage.setItem('key', '{broken');
  assert.ok(readAnnotationDraft(storage, 'key').error);
  assert.equal(storage.getItem('key'), '{broken');
  storage.setItem('key', JSON.stringify({ ...draft, note: { ...note, id: 'wrong-id' } }));
  assert.ok(readAnnotationDraft(storage, 'key').error);
});

test('oversized or invalid draft records cannot replace a valid saved draft', () => {
  const storage = memoryStorage();
  writeAnnotationDraft(storage, 'key', draft);
  assert.equal(writeAnnotationDraft(storage, 'key', { ...draft, body: 'x'.repeat(10001) }).persisted, false);
  assert.equal(writeAnnotationDraft(storage, 'key', { ...draft, updatedAt: 'invalid-date' }).persisted, false);
  assert.equal(writeAnnotationDraft(storage, 'key', { ...draft, note: { ...note, anchors: Array.from({ length: 40 }, () => ({ ...anchor, quote: 'x'.repeat(8000) })) } }).persisted, false);
  assert.deepEqual(readAnnotationDraft(storage, 'key').draft, draft);
});

test('selected-text drafts can be enumerated after reload without reselecting the passage', () => {
  const disk = new Map();
  const target = { itemId: 'product-1', sourceDate: '2026-10-29', anchors: [anchor] };
  const key = annotationDraftKey(target);
  const thought = { id: 'new-operation-id', body: '对摘录的想法', originalBody: '', target, updatedAt: draft.updatedAt };
  writeAnnotationDraft(memoryStorage(disk), key, thought);
  const listed = listAnnotationDrafts(memoryStorage(disk), 'product-1', '2026-10-29');
  assert.equal(listed.drafts.length, 1);
  assert.deepEqual(listed.drafts[0].draft, thought);
  assert.deepEqual(listed.drafts[0].address.anchors, [anchor]);
  assert.equal(listed.drafts[0].draft.id, 'new-operation-id');
});

test('draft lists isolate current product and exact edition and update after removal', () => {
  const storage = memoryStorage();
  for (const [itemId, sourceDate] of [['product-1', null], ['product-1', '2026-10-28'], ['product-1', '2026-10-29'], ['product-2', '2026-10-29']]) {
    const target = { itemId, sourceDate, anchors: [anchor] };
    writeAnnotationDraft(storage, annotationDraftKey(target), { id: `${itemId}-${sourceDate}`, body: '草稿', originalBody: '', target, updatedAt: draft.updatedAt });
  }
  assert.equal(listAnnotationDrafts(storage, 'product-1').drafts.length, 1);
  assert.equal(listAnnotationDrafts(storage, 'product-1', '2026-10-29').drafts.length, 1);
  assert.equal(listAnnotationDrafts(storage, 'unknown', '2026-10-29').drafts.length, 0);
  const current = listAnnotationDrafts(storage, 'product-1', '2026-10-29').drafts[0];
  removeAnnotationDraft(storage, current.key);
  assert.equal(listAnnotationDrafts(storage, 'product-1', '2026-10-29').drafts.length, 0);
  assert.equal(listAnnotationDrafts(storage, 'product-1', '2026-10-28').drafts.length, 1);
});

test('legacy selected-text drafts recover their target from the original versioned storage key', () => {
  const storage = memoryStorage();
  const address = { itemId: 'product-1', sourceDate: '2026-10-29', anchors: [anchor] };
  const key = annotationDraftKey(address);
  const legacy = { id: 'legacy-operation-id', body: '旧格式草稿', originalBody: '', updatedAt: draft.updatedAt };
  storage.setItem(key, JSON.stringify(legacy));
  const listed = listAnnotationDrafts(storage, 'product-1', '2026-10-29');
  assert.equal(listed.drafts.length, 1);
  assert.equal(listed.drafts[0].draft.target, undefined);
  assert.deepEqual(listed.drafts[0].address.anchors, [anchor]);
  assert.equal(listed.drafts[0].draft.id, legacy.id);
});

test('legacy edit drafts retain their note version when discovered from storage', () => {
  const storage = memoryStorage();
  const key = annotationDraftKey({ itemId: note.itemId, sourceDate: note.sourceDate, annotationId: note.id });
  writeAnnotationDraft(storage, key, draft);
  const listed = listAnnotationDrafts(storage, note.itemId, note.sourceDate);
  assert.equal(listed.drafts[0].draft.note.version, note.version);
  assert.equal(listed.drafts[0].address.annotationId, note.id);
});

test('mismatched metadata and invalid legacy addresses cannot leak into another product or date', () => {
  const storage = memoryStorage();
  const key = annotationDraftKey({ itemId: 'product-1', sourceDate: '2026-10-29', anchors: [anchor] });
  const mismatched = { id: 'new-note', body: '草稿', originalBody: '', target: { itemId: 'product-2', sourceDate: '2026-10-29', anchors: [anchor] }, updatedAt: draft.updatedAt };
  writeAnnotationDraft(storage, key, mismatched);
  assert.equal(listAnnotationDrafts(storage, 'product-1', '2026-10-29').drafts.length, 0);
  assert.ok(listAnnotationDrafts(storage, 'product-1', '2026-10-29').error);
  assert.notEqual(storage.getItem(key), null);
  assert.equal(parseAnnotationDraftAddress(annotationDraftKey({ itemId: 'product-1', sourceDate: '2026-02-30' })), null);
  assert.equal(parseAnnotationDraftAddress('another-app:key'), null);
  assert.equal(parseAnnotationDraftAddress(`${key}broken`), null);
});
