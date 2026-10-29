"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { ArrowUpRight, BookOpen, Check, Download, Highlighter, Loader2, MessageSquare, Pencil, RefreshCw, Search, Trash2, Undo2, X } from "lucide-react";
import type { IntelItem } from "@/lib/types";
import { createAnnotationAnchor, exportNotesHtml, exportNotesMarkdown, getAnnotationBlocks, resolveAnnotationAnchor } from "@/lib/annotations";
import type { AnnotationAnchor, AnnotationList, ReadingAnnotation } from "@/lib/annotations";
import { annotationDraftKey, draftStorageMessage, listAnnotationDrafts, readAnnotationDraft, removeAnnotationDraft, writeAnnotationDraft } from "@/lib/annotation-drafts";
import type { AnnotationDraft, DraftStorage } from "@/lib/annotation-drafts";

type CreateTarget = { item: IntelItem; sourceDate?: string; anchors: AnnotationAnchor[] };
type EditorState = { id: string; draftKey: string; note?: ReadingAnnotation; target?: CreateTarget; body: string; originalBody: string };
type NotesContextValue = AnnotationList & {
  loading: boolean; error: string; busy: boolean; message: string;
  refresh: () => Promise<AnnotationList | null>;
  openNotebook: (item?: IntelItem, sourceDate?: string) => void;
  openEditor: (target: CreateTarget | ReadingAnnotation) => void;
  highlight: (target: CreateTarget) => Promise<boolean>;
  registerNavigator: (handler: (note: ReadingAnnotation, locate?: boolean) => void) => () => void;
  draftRevision: number;
  getDrafts: (itemId: string, sourceDate?: string) => ReturnType<typeof listAnnotationDrafts>;
  resumeDraft: (item: IntelItem, sourceDate: string | undefined, key: string) => void;
};
const NotesContext = createContext<NotesContextValue | null>(null);
const emptyNotes: AnnotationList = { notes: [], favoriteNotes: [] };
function NoteDate({ value }: { value: string }) { return <>{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))}</>; }

function targetDraftKey(target: CreateTarget) {
  return annotationDraftKey({ itemId: target.item.id, sourceDate: target.sourceDate, anchors: target.anchors });
}
function localDraftStorage(): DraftStorage | null { try { return window.localStorage; } catch { return null; } }

function AnnotationNoteCard({ note, currentItem, busy, onEdit, onDelete, onLocate }: {
  note: ReadingAnnotation; currentItem?: IntelItem; busy: boolean;
  onEdit: (note: ReadingAnnotation) => void; onDelete: (note: ReadingAnnotation) => void;
  onLocate?: (note: ReadingAnnotation) => void;
}) {
  const blocks = currentItem ? getAnnotationBlocks(currentItem) : [];
  const changed = currentItem && note.anchors.some(anchor => {
    const block = blocks.find(block => block.id === anchor.blockId);
    return !block || !resolveAnnotationAnchor(anchor, block.text);
  });
  return <article className="annotation-note-card">
    {note.quote && <blockquote>{note.quote}</blockquote>}
    {note.body ? <p className="annotation-note-body">{note.body}</p> : <p className="annotation-highlight-only"><Highlighter size={13} />已划线</p>}
    {changed && <p className="annotation-context-note">原文已有更新，摘录仍完整保留</p>}
    <footer><time dateTime={note.updatedAt}><NoteDate value={note.updatedAt} />{note.sourceDate ? ` · ${note.sourceDate} 简报` : ""}</time><div>
      {onLocate && note.anchors.length > 0 && <button disabled={busy} onClick={() => onLocate(note)}><ArrowUpRight size={13} />定位原文</button>}
      <button disabled={busy} onClick={() => onEdit(note)}><Pencil size={13} />{note.body ? "编辑" : "写想法"}</button>
      <button disabled={busy} onClick={() => onDelete(note)} aria-label={`删除笔记：${(note.body || note.quote).slice(0, 20)}`}><Trash2 size={13} />删除</button>
    </div></footer>
  </article>;
}

class NotesRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function notesRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, { cache: "no-store", ...options, signal: controller.signal });
    const value = await response.json();
    if (!response.ok) throw new NotesRequestError(value.error || "笔记暂时无法保存，请重试", response.status);
    return value as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("请求超时，请先刷新笔记核对保存结果，再重试。");
    throw error;
  } finally { clearTimeout(timeout); }
}

export function useReadingNotes() {
  const value = useContext(NotesContext);
  if (!value) throw new Error("Reading notes provider is required");
  return value;
}

export function AnnotationProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AnnotationList>(emptyNotes);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadSequence = useRef(0);
  const [notebook, setNotebook] = useState<{ item?: IntelItem; sourceDate?: string } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPersisted, setDraftPersisted] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const getDrafts = useCallback((itemId: string, sourceDate?: string) => listAnnotationDrafts(localDraftStorage(), itemId, sourceDate), []);
  const [conflict, setConflict] = useState<ReadingAnnotation | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState<"markdown" | "html">("markdown");
  const [deleted, setDeleted] = useState<ReadingAnnotation | null>(null);
  const editorDialog = useRef<HTMLDialogElement>(null);
  const notebookDialog = useRef<HTMLDialogElement>(null);
  const editorFocus = useRef<HTMLElement | null>(null);
  const notebookFocus = useRef<HTMLElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const drafts = useRef(new Map<string, AnnotationDraft>());
  const [noteNavigator, setNoteNavigator] = useState<((note: ReadingAnnotation, locate?: boolean) => void) | null>(null);
  const registerNavigator = useCallback((handler: (note: ReadingAnnotation, locate?: boolean) => void) => {
    setNoteNavigator(() => handler);
    return () => { setNoteNavigator((previous: ((note: ReadingAnnotation, locate?: boolean) => void) | null) => previous === handler ? null : previous); };
  }, []);
  const highlightAttempt = useRef<{ key: string; id: string } | null>(null);

  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const result = await notesRequest<AnnotationList>("/api/annotations");
      if (sequence === loadSequence.current) { setData(result); setError(""); }
      return result;
    } catch (failure) {
      if (sequence === loadSequence.current) setError(failure instanceof Error ? failure.message : "笔记读取失败，请重试");
      return null;
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => {
    const handleFocus = () => { if (!busyRef.current) void refresh(); setDraftRevision(previous => previous + 1); };
    const handleStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith("shiguang:owner:annotation-draft:")) setDraftRevision(previous => previous + 1); };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("storage", handleStorage);
    return () => { window.removeEventListener("focus", handleFocus); window.removeEventListener("storage", handleStorage); };
  }, [refresh]);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(timeout);
  }, [message]);
  useEffect(() => {
    const dialog = notebookDialog.current;
    if (notebook && dialog && !dialog.open) { dialog.showModal(); }
    if (!notebook && dialog?.open) { dialog.close(); notebookFocus.current?.focus({ preventScroll: true }); }
  }, [notebook]);
  useEffect(() => {
    const dialog = editorDialog.current;
    if (editor && dialog && !dialog.open) { dialog.showModal(); textarea.current?.focus({ preventScroll: true }); }
    if (!editor && dialog?.open) { dialog.close(); editorFocus.current?.focus({ preventScroll: true }); }
  }, [editor]);
  const notesModalOpen = Boolean(notebook || editor);
  useEffect(() => {
    if (!notesModalOpen) return;
    const previouslyLocked = document.body.classList.contains("modal-open");
    document.body.classList.add("modal-open");
    return () => { if (!previouslyLocked) document.body.classList.remove("modal-open"); };
  }, [notesModalOpen]);
  useEffect(() => {
    if (!editor || editor.body === editor.originalBody || draftPersisted) return;
    const protectUnsaved = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protectUnsaved);
    return () => window.removeEventListener("beforeunload", protectUnsaved);
  }, [editor, draftPersisted]);

  function accept(note: ReadingAnnotation) {
    ++loadSequence.current;
    setLoading(false);
    setData(previous => ({ ...previous, notes: [...previous.notes.filter(entry => entry.id !== note.id), ...(note.deletedAt ? [] : [note])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
    setError("");
  }
  function beginMutation() {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(true); ++loadSequence.current;
    return true;
  }
  function endMutation() { busyRef.current = false; setBusy(false); }
  function openNotebook(item?: IntelItem, sourceDate?: string) {
    notebookFocus.current = document.activeElement as HTMLElement | null;
    setSearch(""); setMessage(""); setNotebook({ item, sourceDate }); void refresh();
  }
  function openEditor(target: CreateTarget | ReadingAnnotation) {
    if (busyRef.current) return;
    editorFocus.current = document.activeElement as HTMLElement | null;
    let existing = "version" in target ? data.notes.find(note => note.id === target.id) || target : undefined;
    const key = existing ? annotationDraftKey({ itemId: existing.itemId, sourceDate: existing.sourceDate, annotationId: existing.id }) : targetDraftKey(target as CreateTarget);
    const restored = readAnnotationDraft(localDraftStorage(), key);
    let draft = drafts.current.get(key) || restored.draft;
    const draftSnapshot = draft;
    const alreadySaved = draftSnapshot && data.notes.find(note => note.id === draftSnapshot.id && note.body === draftSnapshot.body);
    if (alreadySaved) { drafts.current.delete(key); removeAnnotationDraft(localDraftStorage(), key); setDraftRevision(previous => previous + 1); draft = null; }
    if (!existing && draft) existing = data.notes.find(note => note.id === draft.id);
    const originalBody = draft?.originalBody ?? existing?.body ?? "";
    setEditor({ id: existing?.id || draft?.id || crypto.randomUUID(), draftKey: key, note: draft?.note || existing, target: existing ? undefined : target as CreateTarget, body: draft?.body ?? originalBody, originalBody });
    setDraftPersisted(Boolean(draft && restored.draft && JSON.stringify(draft) === JSON.stringify(restored.draft) && !restored.error));
    setDraftStatus(restored.error || (draft ? "已恢复本机草稿，尚未正式保存。" : "想法会自动保留在此浏览器，保存后才能跨设备查看。"));
    setEditorError(""); setConflict(null); setCloseConfirm(false);
  }
  function editorKey(value: EditorState) { return value.draftKey; }
  function resumeDraft(item: IntelItem, sourceDate: string | undefined, key: string) {
    if (busyRef.current) return;
    const listed = getDrafts(item.id, sourceDate);
    const entry = listed.drafts.find(entry => entry.key === key);
    if (!entry) { setError(listed.error || "这条本机草稿已不在当前阅读版本中，请重新打开详情核对。"); setDraftRevision(previous => previous + 1); return; }
    const draft = entry.draft;
    if (data.notes.some(note => note.id === draft.id && note.body === draft.body)) {
      drafts.current.delete(key); removeAnnotationDraft(localDraftStorage(), key); setDraftRevision(previous => previous + 1); setMessage("这条想法已经保存，可在笔记本中查看。"); return;
    }
    editorFocus.current = document.activeElement as HTMLElement | null;
    const anchors = draft.target?.anchors || entry.address.anchors || [];
    const existing = draft.note || data.notes.find(note => note.id === draft.id);
    setEditor({ id: draft.id, draftKey: key, note: existing, target: existing ? undefined : { item, sourceDate, anchors }, body: draft.body, originalBody: draft.originalBody });
    setDraftPersisted(true); setDraftStatus("已恢复本机草稿，尚未正式保存。"); setEditorError(""); setConflict(null); setCloseConfirm(false);
  }
  function retainDraft(value: EditorState) {
    const key = editorKey(value);
    if (value.body === value.originalBody) {
      drafts.current.delete(key);
      const removed = removeAnnotationDraft(localDraftStorage(), key);
      setDraftRevision(previous => previous + 1);
      setDraftPersisted(false); setDraftStatus(removed.error || "当前内容与已保存笔记一致。");
      return removed.removed;
    }
    const draft: AnnotationDraft = { id: value.id, body: value.body, originalBody: value.originalBody, note: value.note, ...(value.target ? { target: { itemId: value.target.item.id, sourceDate: value.target.sourceDate || null, anchors: value.target.anchors } } : {}), updatedAt: new Date().toISOString() };
    drafts.current.set(key, draft);
    const result = writeAnnotationDraft(localDraftStorage(), key, draft);
    setDraftRevision(previous => previous + 1);
    setDraftPersisted(result.persisted);
    setDraftStatus(result.error || "草稿已自动保存在此浏览器，尚未正式保存。");
    return result.persisted;
  }
  function updateEditorBody(body: string) {
    if (!editor) return;
    const next = { ...editor, body };
    setEditor(next); retainDraft(next); setCloseConfirm(false);
  }
  function requestEditorClose() {
    if (!editor || busyRef.current) return;
    if (editor.body !== editor.originalBody && !closeConfirm) { setCloseConfirm(true); return; }
    if (editor.body !== editor.originalBody && !retainDraft(editor)) { setEditorError(draftStorageMessage); return; }
    setEditor(null); setCloseConfirm(false);
  }
  function discardEditor() {
    if (!editor || busyRef.current) return;
    const key = editorKey(editor);
    const result = removeAnnotationDraft(localDraftStorage(), key);
    if (!result.removed) { setEditorError("无法清除本机草稿，请保留当前页面并先保存想法。"); return; }
    drafts.current.delete(key); setDraftRevision(previous => previous + 1); setEditor(null); setCloseConfirm(false);
  }
  const openNoteSource = useCallback((note: ReadingAnnotation, locate: boolean) => {
    if (busy || !noteNavigator) return;
    setNotebook(null);
    requestAnimationFrame(() => noteNavigator(note, locate));
  }, [busy, noteNavigator]);
  async function highlight(target: CreateTarget) {
    const signature = JSON.stringify(target.anchors);
    const existing = data.notes.find(note => note.itemId === target.item.id && JSON.stringify(note.anchors) === signature);
    if (existing) { setMessage("这段内容已划线，可点击划线写想法"); return true; }
    if (!beginMutation()) return false;
    const key = `${target.item.id}:${target.sourceDate || ""}:${signature}`;
    if (highlightAttempt.current?.key !== key) highlightAttempt.current = { key, id: crypto.randomUUID() };
    try {
      const result = await notesRequest<{ note: ReadingAnnotation }>("/api/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: highlightAttempt.current.id, itemId: target.item.id, sourceDate: target.sourceDate, anchors: target.anchors, body: "" }) });
      accept(result.note); highlightAttempt.current = null; setMessage("已划线，点击划线可写想法"); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "划线保存失败，请重试"); return false; }
    finally { endMutation(); }
  }
  async function saveEditor() {
    if (!editor || !beginMutation()) return;
    setEditorError(""); setCloseConfirm(false);
    try {
      const payload = editor.note ? { id: editor.note.id, version: editor.note.version, body: editor.body } : { id: editor.id, itemId: editor.target!.item.id, sourceDate: editor.target!.sourceDate, anchors: editor.target!.anchors, body: editor.body };
      const result = await notesRequest<{ note: ReadingAnnotation }>("/api/annotations", { method: editor.note ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      accept(result.note); drafts.current.delete(editorKey(editor)); removeAnnotationDraft(localDraftStorage(), editorKey(editor)); setDraftRevision(previous => previous + 1); setEditor(null); setMessage("想法已保存");
    } catch (failure) {
      retainDraft(editor);
      setEditorError(failure instanceof Error ? failure.message : "保存失败，请重试");
      if (failure instanceof NotesRequestError && failure.status === 409 && editor.note) {
        const latest = await refresh();
        setConflict(latest?.notes.find(note => note.id === editor.note?.id) || null);
      }
    } finally { endMutation(); }
  }
  async function toggleDeleted(note: ReadingAnnotation, remove: boolean) {
    if (!beginMutation()) return;
    try {
      const result = await notesRequest<{ note: ReadingAnnotation }>("/api/annotations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: note.id, version: note.version, deleted: remove }) });
      accept(result.note); setDeleted(remove ? result.note : null); setMessage(remove ? "笔记已删除" : "笔记已恢复");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "笔记操作失败，请重试"); if (failure instanceof NotesRequestError && failure.status === 409) void refresh(); }
    finally { endMutation(); }
  }
  const notebookNotes = data.notes.filter(note => (!notebook?.item || note.itemId === notebook.item.id) && `${note.itemName} ${note.quote} ${note.body}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const favoriteNotes = data.favoriteNotes.filter(note => (!notebook?.item || note.itemId === notebook.item.id) && `${note.itemName} ${note.body}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const grouped = [...new Set(notebookNotes.map(note => note.itemId))];
  function download() {
    const content = format === "html" ? exportNotesHtml(notebookNotes, favoriteNotes) : exportNotesMarkdown(notebookNotes, favoriteNotes);
    const url = URL.createObjectURL(new Blob([content], { type: format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `拾光笔记-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })}.${format === "html" ? "html" : "md"}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`已导出 ${notebookNotes.length + favoriteNotes.length} 条笔记${format === "html" ? "，打开 HTML 后可打印为 PDF" : ""}`);
  }
  const context = { ...data, loading, error, busy, message, refresh, openNotebook, openEditor, highlight, registerNavigator, draftRevision, getDrafts, resumeDraft };
  const editorQuote = editor?.note?.quote || editor?.target?.anchors.map(anchor => anchor.quote).join("\n\n") || "";

  return <NotesContext.Provider value={context}>{children}
    <dialog className="annotation-notebook" ref={notebookDialog} aria-labelledby="annotation-notebook-heading" onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) setNotebook(null); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) setNotebook(null); }}>
      <div className="annotation-notebook-inner"><div className="dialog-top"><span><BookOpen size={17} /><strong id="annotation-notebook-heading">{notebook?.item ? `${notebook.item.name} · 我的笔记` : "我的笔记"}</strong></span><button className="icon-button" aria-label="关闭笔记本" disabled={busy} onClick={() => setNotebook(null)}><X size={21} /></button></div>
        <div className="annotation-notebook-tools"><label className="annotation-search"><Search size={16} /><input aria-label="搜索笔记" placeholder="搜索产品、摘录或想法" value={search} onChange={event => setSearch(event.target.value)} /></label><div><select aria-label="笔记导出格式" value={format} onChange={event => setFormat(event.target.value as "markdown" | "html")}><option value="markdown">Markdown</option><option value="html">HTML / 打印 PDF</option></select><button className="button secondary" disabled={loading || busy || notebookNotes.length + favoriteNotes.length === 0} onClick={download}><Download size={14} />导出笔记</button><button className="icon-button" aria-label="刷新笔记" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? "spin" : ""} /></button></div></div>
        <div className="annotation-notebook-scroll">{error && <div className="annotation-error" role="alert">{error}<button onClick={() => void refresh()}>重新读取</button></div>}{message && <p className="annotation-message" role="status">{message}</p>}{deleted && <div className="annotation-undo"><span>已删除一条笔记</span><button disabled={busy} onClick={() => void toggleDeleted(deleted, false)}><Undo2 size={14} />撤销删除</button></div>}
          {loading && data.notes.length === 0 && data.favoriteNotes.length === 0 ? <div className="annotation-empty"><Loader2 size={22} className="spin" /><p>正在读取笔记</p></div> : grouped.length === 0 ? <div className="annotation-empty"><Highlighter size={25} /><strong>{search ? "没有找到匹配的笔记" : "把读到的好想法留下来"}</strong><p>{search ? "试试其他关键词。" : "在产品解读中选中文字，即可划线或写想法。"}</p></div> : grouped.map(itemId => {
            const itemNotes = notebookNotes.filter(note => note.itemId === itemId); const item = itemNotes[0];
            return <section className="annotation-note-group" key={itemId}><div className="annotation-group-heading"><h3>{item.itemName}<span>{itemNotes.length} 条</span></h3><button className="text-link" disabled={busy} onClick={() => openNoteSource(item, false)}><ArrowUpRight size={14} />打开产品</button></div>{itemNotes.map(note => <AnnotationNoteCard key={note.id} note={note} currentItem={notebook?.item} busy={busy} onEdit={openEditor} onDelete={note => void toggleDeleted(note, true)} onLocate={note => openNoteSource(note, true)} />)}</section>;
          })}
        </div><footer className="annotation-notebook-footer"><span>共 {notebookNotes.length + favoriteNotes.length} 条{search ? "匹配笔记" : "笔记"} · 仅自己可见</span>{notebook?.item && <button className="text-link" disabled={busy} onClick={() => openEditor({ item: notebook.item!, sourceDate: notebook.sourceDate, anchors: [] })}><MessageSquare size={14} />写一条想法</button>}</footer>
      </div>
    </dialog>
    <dialog className="annotation-editor-dialog" ref={editorDialog} aria-labelledby="annotation-editor-heading" onCancel={event => { event.preventDefault(); event.stopPropagation(); requestEditorClose(); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) requestEditorClose(); }}>
      <form className="annotation-editor-inner" onSubmit={event => { event.preventDefault(); void saveEditor(); }}><div className="dialog-top"><span><MessageSquare size={17} /><strong id="annotation-editor-heading">{editor?.note ? "编辑想法" : "写想法"}</strong></span><button type="button" className="icon-button" disabled={busy} aria-label="关闭想法编辑" onClick={requestEditorClose}><X size={21} /></button></div><div className="annotation-editor-content"><p className="annotation-editor-product">{editor?.note?.itemName || editor?.target?.item.name}</p>{editorQuote && <blockquote>{editorQuote}</blockquote>}<label htmlFor="annotation-thought">我的想法</label><textarea id="annotation-thought" ref={textarea} rows={6} maxLength={10000} placeholder="记下你的理解、疑问，或准备借鉴的地方…" value={editor?.body || ""} onChange={event => updateEditorBody(event.target.value)} /><div className="annotation-editor-count">{editor?.body.length || 0} / 10000</div><p className="annotation-draft-status" role="status">{draftStatus}</p>{editorError && <p className="annotation-error" role="alert">{editorError}</p>}{conflict && <div className="annotation-conflict"><p>另一处已保存新版本：</p><blockquote>{conflict.body || "（仅划线）"}</blockquote><button className="button secondary" type="button" onClick={() => { if (editor) { const next = { ...editor, note: conflict, body: conflict.body === editor.body ? editor.body : [conflict.body, editor.body].filter(Boolean).join("\n\n"), originalBody: conflict.body }; setEditor(next); retainDraft(next); } setConflict(null); setEditorError(""); }}>合并最新想法后继续编辑</button></div>}{closeConfirm && <div className="annotation-close-confirm"><p>还有未保存的想法</p><div><button type="button" onClick={() => setCloseConfirm(false)}>继续编辑</button><button type="button" onClick={requestEditorClose}>保留草稿并关闭</button><button type="button" onClick={discardEditor}>丢弃草稿并关闭</button></div></div>}</div><footer className="annotation-editor-footer"><span>仅自己可见</span><button type="submit" className="button primary" disabled={busy || !editor || (!editorQuote && !editor.body.trim()) || editor.body.length > 10000}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}保存想法</button></footer></form>
    </dialog>
  </NotesContext.Provider>;
}

type ReadingContextValue = { item: IntelItem; sourceDate?: string; focusNoteId?: string };
const ReadingContext = createContext<ReadingContextValue | null>(null);

function rangeIntersections(range: Range, root: HTMLElement) {
  const anchors: AnnotationAnchor[] = [];
  for (const element of root.querySelectorAll<HTMLElement>("[data-note-block]")) {
    if (!range.intersectsNode(element)) continue;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null; let offset = 0; let start = -1; let end = -1;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length || 0;
      if (length && range.intersectsNode(node)) {
        const from = node === range.startContainer ? range.startOffset : 0;
        const to = node === range.endContainer ? range.endOffset : length;
        if (to > from) { if (start < 0) start = offset + from; end = offset + to; }
      }
      offset += length;
    }
    if (start >= 0 && end > start) {
      const text = element.textContent || "";
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end > start) anchors.push(createAnnotationAnchor(element.dataset.noteBlock!, text, start, end));
    }
  }
  return anchors;
}

export function ReadingAnnotations({ item, sourceDate, focusNoteId, children }: { item: IntelItem; sourceDate?: string; focusNoteId?: string; children: ReactNode }) {
  const notes = useReadingNotes();
  const { draftRevision, getDrafts } = notes;
  const root = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ anchors: AnnotationAnchor[]; style: CSSProperties } | null>(null);
  const [locationResult, setLocationResult] = useState<{ key: string; message: string } | null>(null);
  const [localDrafts, setLocalDrafts] = useState<{ key: string; result: ReturnType<typeof listAnnotationDrafts> }>({ key: "", result: { drafts: [] } });
  const draftScopeKey = JSON.stringify([item.id, sourceDate || ""]);
  const draftList = localDrafts.key === draftScopeKey ? localDrafts.result : { drafts: [] };
  const locationKey = JSON.stringify([item.id, sourceDate || "", focusNoteId || ""]);
  const pointerSelecting = useRef(false);
  const preserveSelection = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) setLocalDrafts({ key: draftScopeKey, result: getDrafts(item.id, sourceDate) }); });
    return () => { cancelled = true; };
  }, [draftScopeKey, item.id, sourceDate, draftRevision, getDrafts]);
  useEffect(() => {
    if (!focusNoteId || notes.loading || notes.error) return;
    const frame = requestAnimationFrame(() => {
      const note = notes.notes.find(note => note.id === focusNoteId && note.itemId === item.id);
      const mark = [...(root.current?.querySelectorAll<HTMLElement>("mark[data-note-ids]") || [])].find(element => element.dataset.noteIds?.split(" ").includes(focusNoteId));
      if (mark) {
        let ancestor: HTMLElement | null = mark.parentElement;
        while (ancestor && ancestor !== root.current) { if (ancestor instanceof HTMLDetailsElement) ancestor.open = true; ancestor = ancestor.parentElement; }
        mark.focus({ preventScroll: true });
        mark.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setLocationResult({ key: locationKey, message: "已定位到划线原文，可点击划线查看或编辑想法。" });
      } else setLocationResult({ key: locationKey, message: !note ? "该笔记已删除或暂不可用，已打开对应产品。" : note.anchors.length ? "原文已有变化，暂时无法准确定位；摘录与想法仍完整保留在笔记本中。" : "这条想法未关联划线位置，可在笔记本中继续查看。" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusNoteId, item.id, locationKey, notes.loading, notes.error, notes.notes]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const capture = () => {
      if (preserveSelection.current || pointerSelecting.current) return;
      const selected = window.getSelection();
      if (!selected || selected.isCollapsed || !selected.rangeCount || !selected.anchorNode || !selected.focusNode || !element.contains(selected.anchorNode) || !element.contains(selected.focusNode) || document.querySelector(".annotation-editor-dialog[open],.annotation-notebook[open],.image-lightbox[open]")) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const anchors = rangeIntersections(range, element);
      const total = anchors.reduce((length, anchor) => length + anchor.quote.length, 0);
      if (!anchors.length || anchors.length > 40 || total > 8000) { setSelection(null); return; }
      const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      const rect = rects[0];
      if (!rect) { setSelection(null); return; }
      const dialogRect = element.closest("dialog")?.getBoundingClientRect();
      const leftEdge = Math.max(8, dialogRect?.left || 0); const rightEdge = Math.min(window.innerWidth - 8, dialogRect?.right || window.innerWidth);
      const width = 188; const left = Math.max(leftEdge + 8, Math.min(rect.left + rect.width / 2 - width / 2, rightEdge - width - 8));
      const top = Math.min(window.innerHeight - 66, Math.max((dialogRect?.top || 0) + 8, rect.top > 92 ? rect.top - 53 : rect.bottom + 8));
      setSelection({ anchors, style: { left, top } });
    };
    const change = () => { clearTimeout(timer); timer = setTimeout(capture, 80); };
    const pointerDown = (event: PointerEvent) => { if (!(event.target as Element).closest(".annotation-selection-toolbar")) { pointerSelecting.current = true; setSelection(null); } };
    const pointerUp = () => { pointerSelecting.current = false; change(); };
    const dismiss = () => { if (!preserveSelection.current) setSelection(null); };
    document.addEventListener("selectionchange", change);
    element.addEventListener("pointerdown", pointerDown); document.addEventListener("pointerup", pointerUp); document.addEventListener("pointercancel", pointerUp);
    element.closest(".detail-scroll")?.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("resize", dismiss);
    return () => { clearTimeout(timer); document.removeEventListener("selectionchange", change); element.removeEventListener("pointerdown", pointerDown); document.removeEventListener("pointerup", pointerUp); document.removeEventListener("pointercancel", pointerUp); element.closest(".detail-scroll")?.removeEventListener("scroll", dismiss); window.removeEventListener("resize", dismiss); };
  }, [item.id, sourceDate]);
  const itemNotes = notes.notes.filter(note => note.itemId === item.id);
  async function mark() {
    if (!selection) return;
    preserveSelection.current = true;
    const saved = await notes.highlight({ item, sourceDate, anchors: selection.anchors });
    preserveSelection.current = false;
    if (saved) { window.getSelection()?.removeAllRanges(); setSelection(null); }
  }
  return <ReadingContext.Provider value={{ item, sourceDate, focusNoteId }}><div ref={root} className="detail-content annotation-reading-root">
    <div className="annotation-reading-tools"><span><Highlighter size={14} />选中文字，留下划线或想法</span><div><button disabled={notes.loading || notes.busy} onClick={() => notes.openEditor({ item, sourceDate, anchors: [] })}><MessageSquare size={14} />写想法</button><button disabled={notes.busy} onClick={() => notes.openNotebook(item, sourceDate)}><BookOpen size={14} />笔记{itemNotes.length > 0 ? ` (${itemNotes.length})` : ""}</button></div></div>
    {draftList.drafts.length > 0 && <details className="annotation-draft-list"><summary>继续本机草稿（{draftList.drafts.length}）</summary><ul>{draftList.drafts.map(entry => <li key={entry.key}><button disabled={notes.loading || notes.busy} onClick={() => notes.resumeDraft(item, sourceDate, entry.key)}><span>{(entry.draft.note?.quote || entry.draft.target?.anchors.map(anchor => anchor.quote).join(" ") || entry.address.anchors?.map(anchor => anchor.quote).join(" ") || entry.draft.body).trim().slice(0, 120) || "未完成的想法"}</span><time dateTime={entry.draft.updatedAt}><NoteDate value={entry.draft.updatedAt} /></time></button></li>)}</ul></details>}
    {draftList.error && <p className="annotation-draft-status" role="status">{draftList.error}</p>}
    {notes.message && <p className="annotation-message annotation-reading-message" role="status">{notes.message}</p>}
    {notes.error && <div className="annotation-error annotation-reading-error" role="alert">{notes.error}<button onClick={() => void notes.refresh()}>重试</button></div>}
    {focusNoteId && <p className="annotation-locate-status" role="status">{notes.loading ? "正在读取笔记并定位原文…" : notes.error ? "笔记暂时无法读取，恢复后会继续定位。" : locationResult?.key === locationKey ? locationResult.message : "正在定位划线原文…"}</p>}
    {children}
    {selection && <div className="annotation-selection-toolbar" role="toolbar" aria-label="选中文字操作" style={selection.style} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); preserveSelection.current = true; }} onPointerUp={() => { preserveSelection.current = false; }}><button disabled={notes.busy || notes.loading} onClick={() => void mark()}><Highlighter size={17} />划线</button><button disabled={notes.busy || notes.loading} onClick={() => { preserveSelection.current = false; notes.openEditor({ item, sourceDate, anchors: selection.anchors }); window.getSelection()?.removeAllRanges(); setSelection(null); }}><MessageSquare size={17} />写想法</button></div>}
  </div></ReadingContext.Provider>;
}

export function AnnotatedText({ blockId, text }: { blockId: string; text: string }) {
  const context = useContext(ReadingContext);
  const annotations = useReadingNotes();
  const intervals = useMemo(() => {
    if (!context) return [];
    return annotations.notes.filter(note => note.itemId === context.item.id).flatMap(note => note.anchors.filter(anchor => anchor.blockId === blockId).flatMap(anchor => { const resolved = resolveAnnotationAnchor(anchor, text); return resolved ? [{ ...resolved, note }] : []; }));
  }, [annotations.notes, blockId, context, text]);
  const positions = [...new Set([0, text.length, ...intervals.flatMap(interval => [interval.start, interval.end])])].sort((a, b) => a - b);
  return <span className="annotatable-text" data-note-block={blockId}>{positions.slice(0, -1).map((start, index) => {
    const end = positions[index + 1]; const matches = intervals.filter(interval => interval.start <= start && interval.end >= end);
    const content = text.slice(start, end);
    return matches.length ? <mark className={`annotation-highlight ${matches.some(match => match.note.body) ? "has-thought" : ""} ${matches.some(match => match.note.id === context?.focusNoteId) ? "is-located" : ""}`} data-note-ids={[...new Set(matches.map(match => match.note.id))].join(" ")} key={start} tabIndex={0} role="button" aria-label={`查看批注：${content.slice(0, 36)}`} onClick={() => { const selected = window.getSelection(); if (!selected || selected.isCollapsed) annotations.openEditor(matches[0].note); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); annotations.openEditor(matches[0].note); } }}>{content}</mark> : <span key={start}>{content}</span>;
  })}</span>;
}
