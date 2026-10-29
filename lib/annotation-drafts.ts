import type { AnnotationAnchor, ReadingAnnotation } from './annotations.ts';

export interface AnnotationDraft {
  id: string;
  body: string;
  originalBody: string;
  note?: ReadingAnnotation;
  target?: { itemId: string; sourceDate: string | null; anchors: AnnotationAnchor[] };
  updatedAt: string;
}
export interface AnnotationDraftAddress { itemId: string; sourceDate?: string | null; annotationId?: string; anchors?: AnnotationAnchor[] }
export interface DraftStorage { readonly length?: number; key?(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface ListedAnnotationDraft { key: string; draft: AnnotationDraft; address: AnnotationDraftAddress }
const keyPrefix = 'shiguang:owner:annotation-draft:v1:';
export const draftStorageMessage = '浏览器无法可靠保存草稿，请先保存想法；刷新或关闭网页可能丢失未保存内容。';

// 当前工作台仅服务一个固定所有者；不同产品、阅读版本和摘录各有独立草稿。
export function annotationDraftKey(address: AnnotationDraftAddress): string {
  return `${keyPrefix}${JSON.stringify([address.itemId, address.sourceDate || '', address.annotationId || '', address.annotationId ? [] : (address.anchors || []).map(a => [a.blockId, a.start, a.end, a.quote, a.prefix, a.suffix])])}`;
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.length <= max; }
function validDate(value: unknown): value is string | null { return value === null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function validAnchor(value: unknown): value is AnnotationAnchor {
  return record(value) && text(value.blockId, 200) && Boolean(value.blockId) && text(value.quote, 8000) && Boolean(value.quote)
    && text(value.prefix, 200) && text(value.suffix, 200) && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
    && Number(value.start) >= 0 && Number(value.end) > Number(value.start) && Number(value.end) - Number(value.start) === value.quote.length;
}
function validAnchors(value: unknown): value is AnnotationAnchor[] { return Array.isArray(value) && value.length <= 40 && value.every(validAnchor) && value.reduce((total, a) => total + a.quote.length, 0) <= 8000; }
function validTarget(value: unknown): value is NonNullable<AnnotationDraft['target']> {
  return record(value) && text(value.itemId, 200) && Boolean(value.itemId) && validDate(value.sourceDate) && validAnchors(value.anchors);
}
export function parseAnnotationDraftAddress(key: string): AnnotationDraftAddress | null {
  if (!key.startsWith(keyPrefix) || key.length > 100000) return null;
  try {
    const tuple: unknown = JSON.parse(key.slice(keyPrefix.length));
    if (!Array.isArray(tuple) || tuple.length !== 4 || !text(tuple[0], 200) || !tuple[0] || !text(tuple[1], 10) || !validDate(tuple[1] || null) || !text(tuple[2], 200) || !Array.isArray(tuple[3])) return null;
    const anchors = tuple[3].map((a: unknown) => Array.isArray(a) && a.length === 6 ? { blockId: a[0], start: a[1], end: a[2], quote: a[3], prefix: a[4], suffix: a[5] } : null);
    if (!validAnchors(anchors) || tuple[2] && anchors.length) return null;
    return { itemId: tuple[0], sourceDate: tuple[1] || null, ...(tuple[2] ? { annotationId: tuple[2] } : {}), anchors };
  } catch { return null; }
}
function validNote(value: unknown): value is ReadingAnnotation {
  if (!record(value)) return false;
  return ['id', 'itemId', 'version'].every(k => text(value[k], 200) && Boolean(value[k]))
    && ['itemName', 'itemTitle', 'itemUrl', 'quote', 'createdAt', 'updatedAt'].every(k => text(value[k], 12000))
    && text(value.body, 10000) && validDate(value.sourceDate) && value.deletedAt === null
    && validAnchors(value.anchors);
}
function validDraft(value: unknown): value is AnnotationDraft {
  return record(value) && text(value.id, 200) && Boolean(value.id) && text(value.body, 10000) && text(value.originalBody, 10000)
    && text(value.updatedAt, 50) && Number.isFinite(Date.parse(value.updatedAt))
    && (value.note === undefined || validNote(value.note) && value.note.id === value.id)
    && (value.target === undefined || validTarget(value.target));
}
export function readAnnotationDraft(storage: DraftStorage | null, key: string): { draft: AnnotationDraft | null; error?: string } {
  if (!storage) return { draft: null, error: draftStorageMessage };
  try {
    const raw = storage.getItem(key);
    if (!raw) return { draft: null };
    if (raw.length > 150000) return { draft: null, error: '本机草稿格式异常，未覆盖原有草稿。请先保存新的想法。' };
    const draft: unknown = JSON.parse(raw);
    return validDraft(draft) ? { draft } : { draft: null, error: '本机草稿格式异常，未覆盖原有草稿。请先保存新的想法。' };
  } catch { return { draft: null, error: draftStorageMessage }; }
}
export function listAnnotationDrafts(storage: DraftStorage | null, itemId: string, sourceDate?: string | null): { drafts: ListedAnnotationDraft[]; error?: string } {
  if (!storage || !storage.key || !Number.isInteger(storage.length)) return { drafts: [], error: draftStorageMessage };
  try {
    const drafts: ListedAnnotationDraft[] = [];
    let invalid = false;
    for (let i = 0; i < storage.length!; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(keyPrefix)) continue;
      const address = parseAnnotationDraftAddress(key);
      if (!address || address.itemId !== itemId || (address.sourceDate || null) !== (sourceDate || null)) continue;
      const loaded = readAnnotationDraft(storage, key);
      if (!loaded.draft) { if (loaded.error) invalid = true; continue; }
      const draft = loaded.draft;
      if (draft.body === draft.originalBody) continue;
      if (draft.note && (draft.note.itemId !== itemId || (draft.note.sourceDate || null) !== (sourceDate || null) || (address.annotationId ? address.annotationId !== draft.note.id : annotationDraftKey({ itemId, sourceDate, anchors: draft.note.anchors }) !== annotationDraftKey(address)))) { invalid = true; continue; }
      if (address.annotationId && !draft.note || draft.target && annotationDraftKey(draft.target) !== annotationDraftKey(address)) { invalid = true; continue; }
      drafts.push({ key, draft, address });
    }
    drafts.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
    return { drafts, ...(invalid ? { error: '部分本机草稿格式异常，已保留原记录；可继续恢复其他草稿。' } : {}) };
  } catch { return { drafts: [], error: draftStorageMessage }; }
}
export function writeAnnotationDraft(storage: DraftStorage | null, key: string, draft: AnnotationDraft): { persisted: boolean; error?: string } {
  if (!storage) return { persisted: false, error: draftStorageMessage };
  try {
    if (!validDraft(draft)) return { persisted: false, error: '草稿内容超出保存范围，请先缩短内容并保存想法。' };
    const encoded = JSON.stringify(draft);
    if (encoded.length > 150000) return { persisted: false, error: '草稿关联内容过大，请先保存想法。' };
    storage.setItem(key, encoded);
    if (storage.getItem(key) !== encoded) return { persisted: false, error: draftStorageMessage };
    return { persisted: true };
  } catch { return { persisted: false, error: draftStorageMessage }; }
}
export function removeAnnotationDraft(storage: DraftStorage | null, key: string): { removed: boolean; error?: string } {
  if (!storage) return { removed: false, error: draftStorageMessage };
  try { storage.removeItem(key); return storage.getItem(key) === null ? { removed: true } : { removed: false, error: draftStorageMessage }; }
  catch { return { removed: false, error: draftStorageMessage }; }
}
