"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowUpRight, Bookmark, Check, Compass, EyeOff, Loader2, RotateCcw, Star } from "lucide-react";
import type { IntelItem } from "@/lib/types";
import type { InterestAction, RecommendationResult } from "./interest";

export interface DiscoveryGridHandle {
  undo: (token: string, readIds: ReadonlySet<string>) => void;
  reload: () => void;
  visibleItemIds: () => string[];
  replaceDismissed: (itemId: string, token: string | null) => Promise<void>;
  replaceRead: (productIds: ReadonlySet<string>, readIds: ReadonlySet<string>) => Promise<void>;
}
interface UndoSlot { token: string; index: number; item: IntelItem; changed: boolean }
interface Props {
  refreshKey: string;
  catalogItems: IntelItem[];
  excludedId?: string;
  productKeys: ReadonlyMap<string, string>;
  blockedIds: ReadonlySet<string>;
  savedIds: Set<string>;
  disabled: boolean;
  ready: boolean;
  onOpen: (item: IntelItem) => void;
  onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>;
  getUndoToken: () => string | null;
  onUndo: () => Promise<void>;
  renderVisual: (item: IntelItem) => ReactNode;
  onLibrary: () => void;
}

const SIZE = 8;
const stars = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export const DiscoveryGrid = forwardRef<DiscoveryGridHandle, Props>(function DiscoveryGrid({ refreshKey, catalogItems, excludedId, productKeys, blockedIds, savedIds, disabled, ready, onOpen, onFeedback, getUndoToken, onUndo, renderVisual, onLibrary }, ref) {
  const [scope, setScope] = useState<"products" | "github">("products");
  const [slots, setSlots] = useState<(IntelItem | null)[]>(Array(SIZE).fill(null));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState<number | null>(null);
  const [undoAvailable, setUndoAvailable] = useState(false);
  const slotsRef = useRef(slots);
  const queueRef = useRef<IntelItem[]>([]);
  const blockedRef = useRef(blockedIds);
  const savedRef = useRef(savedIds);
  const excludedRef = useRef(excludedId);
  const productKeysRef = useRef(productKeys);
  const seenRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const requestRef = useRef<Promise<IntelItem[]> | null>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const activeScopeRef = useRef(scope);
  const activeRefreshRef = useRef(refreshKey);
  const undoRef = useRef<UndoSlot | null>(null);
  blockedRef.current = blockedIds; savedRef.current = savedIds; excludedRef.current = excludedId; productKeysRef.current = productKeys;

  const updateSlots = useCallback((next: (IntelItem | null)[]) => { slotsRef.current = next; setSlots(next); }, []);
  useEffect(() => {
    const byId = new Map(catalogItems.map(item => [item.id, item]));
    const current = slotsRef.current;
    const next = current.map(item => item ? byId.get(item.id) || item : null);
    if (next.some((item, index) => item !== current[index])) updateSlots(next);
    queueRef.current = queueRef.current.map(item => byId.get(item.id) || item);
  }, [catalogItems, updateSlots]);
  const productKey = useCallback((id: string) => productKeysRef.current.get(id) ?? id, []);
  const eligible = useCallback((item: IntelItem) => {
    const featuredId = excludedRef.current;
    if (featuredId && productKey(item.id) === productKey(featuredId)) return false;
    return !blockedRef.current.has(item.id) && !savedRef.current.has(item.id) && !seenRef.current.has(productKey(item.id));
  }, [productKey]);

  const fetchCandidates = useCallback(async () => {
    if (requestRef.current) return requestRef.current;
    const generation = generationRef.current;
    const exclude = [...new Set([...slotsRef.current.flatMap(item => item ? [item.id] : []), ...(excludedRef.current ? [excludedRef.current] : [])])];
    const promise = (async () => {
      const params = new URLSearchParams({ scope, limit: "24", exclude: exclude.join(",") });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`/api/recommendations?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as RecommendationResult & { error?: string };
        if (!response.ok) throw new Error(data.error || "候选内容暂时无法读取");
        if (!mountedRef.current || generation !== generationRef.current) return [];
        const ids = new Set(queueRef.current.map(item => item.id));
        const candidates = data.items.filter(item => eligible(item) && !ids.has(item.id));
        queueRef.current = [...queueRef.current.filter(eligible), ...candidates];
        setError("");
        return queueRef.current;
      } catch (err) {
        if (mountedRef.current && generation === generationRef.current) setError(err instanceof Error && err.name !== "AbortError" ? err.message : "读取超时，请重试补齐");
        return [];
      } finally { clearTimeout(timer); if (generation === generationRef.current) requestRef.current = null; }
    })();
    requestRef.current = promise;
    return promise;
  }, [eligible, scope]);

  const takeCandidate = useCallback((skip?: ReadonlySet<string>) => {
    queueRef.current = queueRef.current.filter(item => eligible(item) && !skip?.has(item.id));
    const next = queueRef.current.shift() || null;
    if (next) seenRef.current.add(productKey(next.id));
    return next;
  }, [eligible, productKey]);

  const replaceSlot = useCallback(async (index: number, itemId: string, skip?: ReadonlySet<string>) => {
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generation === generationRef.current && slotsRef.current[index]?.id === itemId;
    let replacement = takeCandidate(skip);
    if (!replacement) {
      await fetchCandidates();
      if (!isCurrent()) return false;
      replacement = takeCandidate(skip);
    }
    if (!isCurrent()) return false;
    const next = [...slotsRef.current];
    next[index] = replacement;
    updateSlots(next);
    return true;
  }, [fetchCandidates, takeCandidate, updateSlots]);

  const startBatch = useCallback(async () => {
    ++generationRef.current; requestRef.current = null; queueRef.current = []; seenRef.current = new Set(); undoRef.current = null;
    updateSlots(Array(SIZE).fill(null)); setUndoAvailable(false); setChanging(null); setLoading(true); setError("");
    const generation = generationRef.current;
    await fetchCandidates();
    if (!mountedRef.current || generation !== generationRef.current) return;
    updateSlots(Array.from({ length: SIZE }, () => takeCandidate())); setLoading(false);
  }, [fetchCandidates, takeCandidate, updateSlots]);

  const invalidate = useCallback(() => { ++generationRef.current; requestRef.current = null; initializedRef.current = false; }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; invalidate(); };
  }, [invalidate]);
  useEffect(() => {
    if (!ready || initializedRef.current && activeScopeRef.current === scope && activeRefreshRef.current === refreshKey) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) { initializedRef.current = true; activeScopeRef.current = scope; activeRefreshRef.current = refreshKey; void startBatch(); } });
    return () => { active = false; };
  }, [ready, refreshKey, scope, startBatch]);

  useEffect(() => {
    if (!ready || !excludedId) return;
    const index = slotsRef.current.findIndex(item => item && productKey(item.id) === productKey(excludedId));
    if (index < 0) return;
    const itemId = slotsRef.current[index]!.id;
    const generation = generationRef.current;
    let active = true;
    void (async () => {
      let replacement = takeCandidate();
      if (!replacement) { await fetchCandidates(); replacement = takeCandidate(); }
      if (!active || !mountedRef.current || generation !== generationRef.current || slotsRef.current[index]?.id !== itemId) return;
      const next = [...slotsRef.current]; next[index] = replacement; updateSlots(next);
    })();
    return () => { active = false; };
  }, [excludedId, fetchCandidates, productKey, ready, takeCandidate, updateSlots]);

  useImperativeHandle(ref, () => ({
    reload: () => { if (!disabled) void startBatch(); },
    visibleItemIds: () => slotsRef.current.flatMap(item => item ? [item.id] : []),
    replaceRead: async (productIds, readIds) => {
      const index = slotsRef.current.findIndex(item => item && productIds.has(item.id));
      const item = slotsRef.current[index];
      if (!item) return;
      setChanging(index);
      if (await replaceSlot(index, item.id, readIds)) setChanging(null);
    },
    replaceDismissed: async (itemId: string, token: string | null) => {
      const index = slotsRef.current.findIndex(item => item?.id === itemId);
      const item = slotsRef.current[index];
      if (index < 0 || !item) return;
      setChanging(index);
      if (!await replaceSlot(index, item.id)) return;
      undoRef.current = token ? { token, index, item, changed: true } : null;
      setUndoAvailable(Boolean(token)); setChanging(null);
    },
    undo: (token, readIds) => {
      const previous = undoRef.current;
      if (!previous || previous.token !== token) return;
      if (previous.changed && !readIds.has(previous.item.id)) {
        const replacement = slotsRef.current[previous.index];
        if (replacement) { seenRef.current.delete(productKey(replacement.id)); queueRef.current.unshift(replacement); }
        const next = [...slotsRef.current]; next[previous.index] = previous.item; updateSlots(next);
      }
      undoRef.current = null; setUndoAvailable(false);
    },
  }), [disabled, productKey, replaceSlot, startBatch, updateSlots]);

  async function choose(index: number, action: InterestAction) {
    const item = slotsRef.current[index];
    if (!item || disabled || changing !== null) return;
    const generation = generationRef.current;
    setChanging(index);
    const done = await onFeedback(item, action);
    if (!mountedRef.current || generation !== generationRef.current) return;
    if (!done) { setChanging(null); setError("选择结果已重新核对，请重试；当前卡片暂时保留。"); return; }
    if (action === "not_interested") {
      if (!await replaceSlot(index, item.id)) return;
    }
    const token = getUndoToken();
    undoRef.current = token ? { token, index, item, changed: action === "not_interested" } : null;
    setUndoAvailable(Boolean(token)); setChanging(null);
    if (queueRef.current.filter(eligible).length < SIZE) void fetchCandidates();
  }

  async function refillEmpty() {
    if (disabled || changing !== null) return;
    const generation = generationRef.current;
    setLoading(true); await fetchCandidates();
    if (!mountedRef.current || generation !== generationRef.current) return;
    updateSlots(slotsRef.current.map(item => item || takeCandidate())); setLoading(false);
  }

  return <section className="content-section product-discovery" aria-label="产品发现"><div className="section-heading"><div><span className="section-mark"><Compass size={16} /></span><h2>产品发现</h2><span className="section-description">跨行业好产品 · 根据你的选择继续发现</span></div><button className="text-link" onClick={onLibrary}>查看全部资料 <ArrowUpRight size={14} /></button></div>
    <div className="discovery-grid-toolbar"><div className="discovery-grid-tabs" aria-label="产品发现筛选"><button className={scope === "products" ? "selected" : ""} disabled={disabled || changing !== null} aria-pressed={scope === "products"} onClick={() => setScope("products")}>综合推荐</button><button className={scope === "github" ? "selected" : ""} disabled={disabled || changing !== null} aria-pressed={scope === "github"} onClick={() => setScope("github")}><Star size={12} />GitHub 高关注</button></div><div>{undoAvailable && <button className="text-link" disabled={disabled || changing !== null || !getUndoToken() || getUndoToken() !== undoRef.current?.token} onClick={() => void onUndo()}><RotateCcw size={13} />撤销上次选择</button>}<span>{loading ? "正在准备候选" : `${slots.filter(Boolean).length} 条展示 · ${queueRef.current.length} 条已准备`}</span></div></div>
    <p className="section-context">打开详情后记为已看。在详情点「已读」，可在原位置换一条。</p>
    {error && <div className="inline-warning discovery-grid-warning" role="alert"><span>{error}</span><button disabled={disabled || loading} onClick={() => void refillEmpty()}>重新核对并补齐</button></div>}
    <div className="product-grid discovery-product-grid">{slots.map((item, index) => <div className="discovery-grid-slot" key={index} data-slot={index}>{item ? <article className={`product-card discovery-product-card ${changing === index ? "is-changing" : ""}`} data-item-id={item.id}><button className="card-open" onClick={() => onOpen(item)}>{renderVisual(item)}<div className="product-card-body"><div className="card-kicker"><span>{item.category}</span>{item.stars != null && <span className="star-count"><Star size={12} />{stars(item.stars)}</span>}</div><h3>{item.name}<ArrowUpRight size={15} /></h3><p>{item.title}</p><div className="card-tags">{item.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}<span className="read-time">{item.readMinutes} 分钟</span></div></div></button><div className="grid-card-actions"><button className={`grid-interest ${savedIds.has(item.id) ? "is-saved" : ""}`} disabled={disabled || changing !== null || savedIds.has(item.id)} onClick={() => void choose(index, "interested")}>{savedIds.has(item.id) ? <Check size={14} /> : <Bookmark size={14} />}{savedIds.has(item.id) ? "已收藏" : "感兴趣并收藏"}</button><button className="grid-dismiss" disabled={disabled || changing !== null} onClick={() => void choose(index, "not_interested")}>{changing === index ? <Loader2 size={14} className="spin" /> : <EyeOff size={14} />}不感兴趣</button></div></article> : <div className={`grid-slot-empty ${loading ? "is-loading" : ""}`} role="status">{loading ? <><Loader2 size={22} className="spin" /><strong>正在准备下一条</strong></> : <><Compass size={25} /><strong>暂时没有新的候选</strong><p>已看和已处理的内容不会重复填入。每日采集更新后继续补充。</p><button className="text-link" onClick={onLibrary}>去资料库回看 <ArrowUpRight size={13} /></button></>}</div>}</div>)}</div>
  </section>;
});
