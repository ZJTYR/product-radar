"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Folder, Loader2, X } from "lucide-react";

export type CollectionTarget = { itemId: string; name: string; collection: string };

export function CollectionEditor({ target, names, disabled, onSave, onClose }: {
  target: CollectionTarget; names: string[]; disabled: boolean;
  onSave: (target: CollectionTarget, collection: string) => Promise<void>;
  onClose: () => void;
}) {
  const [collection, setCollection] = useState(target.collection);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = saving || disabled;
  const options = [...new Set(["灵感收藏", "值得试用", "商业模式", "界面参考", ...names])];

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const locked = document.body.classList.contains("modal-open");
    document.body.classList.add("modal-open");
    element?.showModal(); input.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (!locked) document.body.classList.remove("modal-open"); previousFocus?.focus({ preventScroll: true }); };
  }, []);

  async function save() {
    if (pending.current || disabled || !collection.trim()) return;
    pending.current = true; setSaving(true); setError("");
    try { await onSave(target, collection.trim()); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "分类保存失败，请重试"); }
    finally { pending.current = false; setSaving(false); }
  }

  return <dialog ref={dialog} className="collection-dialog" aria-labelledby="collection-editor-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="dialog-top"><span><Folder size={17} /><strong id="collection-editor-title">收藏分类</strong></span><button type="button" className="icon-button" aria-label="关闭分类" disabled={busy} onClick={onClose}><X size={21} /></button></div>
      <div className="collection-editor-content"><p>{target.name}</p><label htmlFor="favorite-collection">分类名称</label><input id="favorite-collection" ref={input} value={collection} maxLength={80} disabled={busy} onChange={event => setCollection(event.target.value)} placeholder="选择已有分类，或输入新分类" />
        <div className="collection-options" aria-label="已有收藏分类">{options.map(name => <button type="button" key={name} title={name} disabled={busy} aria-pressed={collection === name} onClick={() => setCollection(name)}>{name}</button>)}</div>
        {error && <p className="collection-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy || !collection.trim()}>{saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}保存分类</button></footer>
    </form>
  </dialog>;
}
