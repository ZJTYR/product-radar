"use client";

/* eslint-disable @next/next/no-img-element -- Product imagery preserves its original public source. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, CircleHelp, Compass, EyeOff, Heart, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import type { IntelItem, SavedItem } from "@/lib/types";

export type InterestAction = "interested" | "not_interested";
export interface ReadingFeedback { itemId: string; action: InterestAction; updatedAt: string }
interface FeedbackResult { feedback: ReadingFeedback[]; favorites: SavedItem[]; undoToken?: string | null }
export interface RecommendationResult {
  items: IntelItem[];
  reasons: Record<string, string>;
  remaining: number;
  feedbackCount: number;
  profile: { positiveTopics: string[]; negativeTopics: string[] };
}

const EMPTY_RECOMMENDATIONS: RecommendationResult = { items: [], reasons: {}, remaining: 0, feedbackCount: 0, profile: { positiveTopics: [], negativeTopics: [] } };

async function interestRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, { cache: "no-store", ...options, signal: controller.signal });
    const data = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(data.error || "阅读偏好暂时无法保存，请重试");
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("连接超时，请重试或刷新核对保存状态");
    throw error;
  } finally { clearTimeout(timeout); }
}

export function useInterestFeed({ onFavorites, notify, mutationLockRef }: {
  onFavorites: (favorites: SavedItem[]) => void;
  notify: (message: string) => void;
  mutationLockRef: MutableRefObject<boolean>;
}) {
  const [feedback, setFeedback] = useState<ReadingFeedback[]>([]);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [recommendations, setRecommendations] = useState<RecommendationResult>(EMPTY_RECOMMENDATIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const undoItemRef = useRef<IntelItem | null>(null);
  const recommendationSequenceRef = useRef(0);
  const feedbackSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  const loadRecommendations = useCallback(async () => {
    const sequence = ++recommendationSequenceRef.current;
    setLoading(true); setError("");
    try {
      const result = await interestRequest<RecommendationResult>("/api/recommendations?limit=12");
      if (mountedRef.current && sequence === recommendationSequenceRef.current) setRecommendations(result);
    } catch (err) {
      if (mountedRef.current && sequence === recommendationSequenceRef.current) setError(err instanceof Error ? err.message : "推荐暂时无法读取");
    } finally { if (mountedRef.current && sequence === recommendationSequenceRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const feedbackVersion = ++feedbackSequenceRef.current;
    const recommendationVersion = ++recommendationSequenceRef.current;
    void interestRequest<FeedbackResult>("/api/feedback").then(result => {
      if (mountedRef.current && feedbackVersion === feedbackSequenceRef.current) {
        setFeedback(result.feedback); onFavorites(result.favorites); setFeedbackReady(true);
      }
    }).catch(err => {
      if (mountedRef.current && feedbackVersion === feedbackSequenceRef.current) setFeedbackError(err instanceof Error ? err.message : "阅读偏好暂时无法读取");
    });
    void interestRequest<RecommendationResult>("/api/recommendations?limit=12").then(result => {
      if (mountedRef.current && recommendationVersion === recommendationSequenceRef.current) setRecommendations(result);
    }).catch(err => {
      if (mountedRef.current && recommendationVersion === recommendationSequenceRef.current) setError(err instanceof Error ? err.message : "推荐暂时无法读取");
    }).finally(() => {
      if (mountedRef.current && recommendationVersion === recommendationSequenceRef.current) setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [onFavorites]);

  const applyResult = useCallback((result: FeedbackResult) => {
    ++feedbackSequenceRef.current;
    setFeedback(result.feedback); setFeedbackReady(true); setFeedbackError(""); onFavorites(result.favorites);
    const consumed = new Set([...result.feedback.map(entry => entry.itemId), ...result.favorites.map(entry => entry.itemId)]);
    setRecommendations(previous => {
      const nextItems = previous.items.filter(item => !consumed.has(item.id));
      return { ...previous, items: nextItems, remaining: Math.max(0, previous.remaining - (previous.items.length - nextItems.length)), feedbackCount: result.feedback.length };
    });
  }, [onFavorites]);

  // Called while holding the shared mutation lock, including after an ambiguous write.
  const reconcileLocked = useCallback(async () => {
    const feedbackVersion = ++feedbackSequenceRef.current;
    const recommendationVersion = ++recommendationSequenceRef.current;
    setLoading(true); setFeedbackReady(false); setUndoToken(null); undoItemRef.current = null;
    const [feedbackResult, recommendationResult] = await Promise.allSettled([
      interestRequest<FeedbackResult>("/api/feedback"),
      interestRequest<RecommendationResult>("/api/recommendations?limit=12"),
    ]);
    if (!mountedRef.current || feedbackVersion !== feedbackSequenceRef.current || recommendationVersion !== recommendationSequenceRef.current) return false;
    if (feedbackResult.status === "fulfilled") {
      setFeedback(feedbackResult.value.feedback); onFavorites(feedbackResult.value.favorites); setFeedbackError("");
    } else {
      setFeedbackError(feedbackResult.reason instanceof Error ? feedbackResult.reason.message : "阅读偏好暂时无法读取");
    }
    if (recommendationResult.status === "fulfilled") setRecommendations(recommendationResult.value);
    const complete = feedbackResult.status === "fulfilled" && recommendationResult.status === "fulfilled";
    if (feedbackResult.status === "fulfilled" && recommendationResult.status === "rejected") setFeedbackError("推荐暂时无法核对，新的选择已暂停，请重试");
    setFeedbackReady(complete); setLoading(false);
    setError(complete ? "" : "状态核对尚未完成，已暂停新的选择；请重新读取收藏、偏好与推荐。");
    return complete;
  }, [onFavorites]);

  const reconcile = useCallback(async () => {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true; setBusy(true);
    try {
      const complete = await reconcileLocked();
      if (mountedRef.current) notify(complete ? "已核对收藏、偏好与推荐" : "状态尚未核对完成，请重新读取");
    } finally { mutationLockRef.current = false; if (mountedRef.current) setBusy(false); }
  }, [mutationLockRef, notify, reconcileLocked]);

  const recoverUncertainWrite = useCallback(async (err: unknown) => {
    const message = err instanceof Error ? err.message : "操作结果暂时无法确认";
    if (!mountedRef.current) return;
    notify(`${message}，正在核对保存状态`);
    const complete = await reconcileLocked();
    if (mountedRef.current) notify(complete ? "已按服务器状态核对收藏、偏好与推荐；请查看最新结果" : "暂时无法核对保存结果，请重新读取后再选择");
  }, [notify, reconcileLocked]);

  const submit = useCallback(async (item: IntelItem, action: InterestAction) => {
    if (mutationLockRef.current || !feedbackReady) return false;
    mutationLockRef.current = true; setBusy(true); ++recommendationSequenceRef.current;
    try {
      const result = await interestRequest<FeedbackResult>("/api/feedback", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, action }) });
      if (!mountedRef.current) return true;
      applyResult(result); setUndoToken(result.undoToken || null); undoItemRef.current = item;
      notify(action === "interested" ? `已留下 ${item.name}，可在我的收藏查看` : `已划走 ${item.name}，会调整后续推荐`);
      await loadRecommendations();
      return true;
    } catch (err) {
      await recoverUncertainWrite(err); return false;
    }
    finally { mutationLockRef.current = false; if (mountedRef.current) setBusy(false); }
  }, [applyResult, feedbackReady, loadRecommendations, mutationLockRef, notify, recoverUncertainWrite]);

  const undo = useCallback(async () => {
    if (mutationLockRef.current || !undoToken) return;
    mutationLockRef.current = true; setBusy(true); ++recommendationSequenceRef.current;
    try {
      const result = await interestRequest<FeedbackResult>("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ undoToken }) });
      if (!mountedRef.current) return;
      applyResult(result); setUndoToken(null);
      const restored = undoItemRef.current;
      const isEligible = restored && !result.feedback.some(entry => entry.itemId === restored.id) && !result.favorites.some(entry => entry.itemId === restored.id);
      notify("已撤销上一次选择");
      await loadRecommendations();
      if (isEligible && mountedRef.current) setRecommendations(previous => {
        const items = [restored, ...previous.items.filter(item => item.id !== restored.id)];
        return { ...previous, items, remaining: Math.max(items.length, previous.remaining) };
      });
    } catch (err) {
      await recoverUncertainWrite(err);
    }
    finally { mutationLockRef.current = false; if (mountedRef.current) setBusy(false); }
  }, [applyResult, loadRecommendations, mutationLockRef, notify, recoverUncertainWrite, undoToken]);

  const restore = useCallback(async (itemId: string) => {
    if (mutationLockRef.current || !feedbackReady) return;
    mutationLockRef.current = true; setBusy(true); ++recommendationSequenceRef.current;
    try {
      const result = await interestRequest<FeedbackResult>(`/api/feedback?itemId=${encodeURIComponent(itemId)}`, { method: "DELETE" });
      if (!mountedRef.current) return;
      applyResult(result); setUndoToken(null); notify("已恢复这条内容，可重新参与推荐");
      await loadRecommendations();
    } catch (err) {
      await recoverUncertainWrite(err);
    }
    finally { mutationLockRef.current = false; if (mountedRef.current) setBusy(false); }
  }, [applyResult, feedbackReady, loadRecommendations, mutationLockRef, notify, recoverUncertainWrite]);

  return { feedback, feedbackReady, feedbackError, recommendations, loading, error, busy, undoToken, submit, undo, restore, reconcile, loadRecommendations };
}

function DiscoveryImage({ item }: { item: IntelItem }) {
  const [failed, setFailed] = useState(false);
  return item.image && !failed ? <div className="discovery-image"><img src={item.image} alt={`${item.name} · ${item.imageCaption || "官方公开配图"}`} draggable={false} onError={() => setFailed(true)} /><span>{item.imageCaption || "官方公开配图"}</span></div> : <div className="discovery-image discovery-image-empty"><Compass size={30} /><strong>{item.name}</strong><span>{failed ? "配图暂时无法加载，可继续阅读" : "暂无产品截图"}</span></div>;
}

function DiscoveryCard({ item, reason, disabled, onFeedback, onOpen }: {
  item: IntelItem; reason?: string; disabled: boolean;
  onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>;
  onOpen: (item: IntelItem) => void;
}) {
  const [drag, setDrag] = useState(0);
  const pointer = useRef<{ id: number; x: number; y: number; horizontal: boolean } | null>(null);
  function begin(event: ReactPointerEvent<HTMLElement>) {
    if (disabled || !event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest("button,a,input,textarea,summary,details")) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const gesture = pointer.current;
    if (!gesture || gesture.id !== event.pointerId || disabled) return;
    const dx = event.clientX - gesture.x; const dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { pointer.current = null; return; }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      gesture.horizontal = true; event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDrag(Math.max(-150, Math.min(150, dx)));
  }
  function end(event: ReactPointerEvent<HTMLElement>) {
    const gesture = pointer.current; pointer.current = null; setDrag(0);
    if (!gesture || gesture.id !== event.pointerId || !gesture.horizontal || disabled) return;
    const dx = event.clientX - gesture.x; const dy = event.clientY - gesture.y;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.abs(dx) >= 90 && Math.abs(dx) > Math.abs(dy) * 1.5) void onFeedback(item, dx > 0 ? "interested" : "not_interested");
  }
  const date = new Date(item.discoveredAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  return <article className={`discovery-card ${drag ? "is-dragging" : ""}`} style={{ transform: `translateX(${drag * .5}px) rotate(${drag / 65}deg)` }} tabIndex={0} aria-label={`${item.name}，左右方向键选择；也可使用下方按钮`} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { pointer.current = null; setDrag(0); }} onKeyDown={event => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest("button,a,input,textarea")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); void onFeedback(item, event.key === "ArrowRight" ? "interested" : "not_interested"); }
  }}>
    {Math.abs(drag) > 30 && <span className={`swipe-indicator ${drag > 0 ? "positive" : "negative"}`} aria-hidden="true">{Math.abs(drag) >= 90 ? "松开以" : "继续"}{drag > 0 ? "留下" : "划走"}</span>}
    <DiscoveryImage item={item} />
    <div className="discovery-card-content"><div className="card-kicker"><span>{item.category}</span><span>{item.readMinutes} 分钟 · 收录于 {date}</span><span>{item.evidence}</span></div><h2>{item.name}</h2><h3>{item.title}</h3><p className="discovery-summary">{item.summary}</p><div className="discovery-value"><LightbulbIcon /><p><strong>值得关注</strong>{item.differentiation}</p></div><div className="card-tags">{item.tags.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div><div className="discovery-reason"><Sparkles size={14} /><span>{reason || "探索一个新的产品方向"}</span></div><button className="text-link discovery-read" onClick={() => onOpen(item)}>看完整拆解与原始资料 <ArrowUpRight size={15} /></button></div>
    <DiscoveryChoices item={item} disabled={disabled} onFeedback={onFeedback} />
  </article>;
}

function DiscoveryChoices({ item, disabled, onFeedback, mobile = false }: {
  item: IntelItem; disabled: boolean; mobile?: boolean;
  onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>;
}) {
  return <div className={`discovery-choices ${mobile ? "discovery-mobile-choices" : "discovery-desktop-choices"}`} aria-label="选择当前推荐">
    <button className="choice-button negative" disabled={disabled} onClick={() => void onFeedback(item, "not_interested")}><X size={21} /><span>不感兴趣<small>左划 · 换一条</small></span></button>
    <button className="choice-button positive" disabled={disabled} onClick={() => void onFeedback(item, "interested")}><Heart size={21} /><span>感兴趣并收藏<small>右划 · 留下来</small></span></button>
  </div>;
}

function LightbulbIcon() { return <Sparkles size={17} aria-hidden="true" />; }

export function RecommendationsPanel({ data, loading, error, disabled, retryDisabled, undoToken, onFeedback, onOpen, onUndo, onRetry, onManage, onSaved }: {
  data: RecommendationResult; loading: boolean; error: string; disabled: boolean; retryDisabled: boolean; undoToken: string | null;
  onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>; onOpen: (item: IntelItem) => void;
  onUndo: () => Promise<void>; onRetry: () => Promise<void>; onManage: () => void; onSaved: () => void;
}) {
  const current = data.items[0];
  return <section className="recommendation-section" aria-label="为你推荐"><div className="recommendation-toolbar"><div><span className="pill green"><Sparkles size={13} />按你的选择推荐</span><p>来自已收集的资料库 · {data.remaining} 条待探索</p></div><div className="recommendation-tools"><button className="button secondary" disabled={disabled || !undoToken} onClick={() => void onUndo()}><RotateCcw size={14} />撤销上一次</button><button className="button secondary" onClick={onManage}><EyeOff size={14} />已划走</button></div></div>
    {error && <div className="inline-warning recommendation-error" role="alert"><span>{current ? `推荐排序暂时无法更新：${error}` : error}</span><button disabled={retryDisabled || loading} onClick={() => void onRetry()}>重新读取</button></div>}
    {loading && !current ? <div className="recommendation-loading" role="status"><Loader2 className="spin" size={24} /><strong>正在挑选下一条灵感</strong></div> : current ? <div className="discovery-layout"><div className="discovery-stage"><DiscoveryCard key={current.id} item={current} reason={data.reasons[current.id]} disabled={disabled || loading} onFeedback={onFeedback} onOpen={onOpen} /><p className="swipe-help"><ArrowLeft size={14} />左划不感兴趣<span>·</span>右划感兴趣<ArrowRight size={14} /><span className="desktop-only">也可以聚焦卡片后使用 ← / →</span></p><div className="recommendation-live" role="status" aria-live="polite">{disabled ? "正在保存选择，请稍候" : `当前推荐：${current.name}`}</div></div><aside className="discovery-aside"><div className="recommendation-explainer"><Sparkles size={20} /><h3>把好灵感留下来</h3><p>根据你的选择调整主题、产品类型与可识别来源的顺序，同时保留新方向。</p><div className="interest-explainer-row"><Heart size={16} /><span><strong>感兴趣</strong>加入收藏，便于分类与写备注</span></div><div className="interest-explainer-row"><X size={16} /><span><strong>不感兴趣</strong>移走这一条，自动补下一条</span></div><div className="interest-explainer-row"><RotateCcw size={16} /><span><strong>随时调整</strong>可以撤销，也能恢复已划走内容</span></div>{data.profile.positiveTopics.length > 0 && <div className="interest-topics"><span>最近留下的方向</span><div className="card-tags">{data.profile.positiveTopics.slice(0, 4).map(topic => <span key={topic}>{topic}</span>)}</div></div>}<small>已记录 {data.feedbackCount} 条阅读选择。一次划走不会屏蔽整个主题或作者。</small></div>{data.items.length > 1 && <div className="discovery-next"><h3>接下来还可以看看</h3>{data.items.slice(1, 4).map(item => <button key={item.id} onClick={() => onOpen(item)}><span><strong>{item.name}</strong><small>{item.category}</small></span><ArrowUpRight size={15} /></button>)}</div>}</aside></div> : !error ? <div className="empty-state recommendation-empty"><Check size={34} /><h2>这一轮灵感已看完</h2><p>已有资料中暂时没有未处理的推荐。每天采集更新后会继续补充，也可以恢复已划走的内容重新看看。</p><div><button className="button primary" onClick={onSaved}><Bookmark size={15} />查看留下的灵感</button><button className="button secondary" onClick={onManage}><EyeOff size={15} />管理已划走</button></div></div> : <div className="empty-state recommendation-empty"><CircleHelp size={34} /><h2>下一条灵感暂时没有读取出来</h2><p>你的收藏与已保存选择会保留。请稍后重试。</p></div>}
    {current && <DiscoveryChoices item={current} disabled={disabled || loading} onFeedback={onFeedback} mobile />}
  </section>;
}

export function DismissedItemsDialog({ open, feedback, items, disabled, onClose, onRestore, onOpen }: {
  open: boolean; feedback: ReadingFeedback[]; items: IntelItem[]; disabled: boolean;
  onClose: () => void; onRestore: (itemId: string) => Promise<void>; onOpen: (item: IntelItem) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = dialogRef.current; if (open && dialog && !dialog.open) dialog.showModal(); if (!open && dialog?.open) dialog.close(); }, [open]);
  const dismissed = feedback.filter(entry => entry.action === "not_interested");
  const itemMap = new Map(items.map(item => [item.id, item]));
  return <dialog ref={dialogRef} className="dismissed-dialog" aria-labelledby="dismissed-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div className="dialog-inner"><div className="dialog-top"><span><EyeOff size={17} />阅读偏好</span><button className="icon-button" onClick={onClose} aria-label="关闭已划走内容"><X size={21} /></button></div><div className="dismissed-content"><h2 id="dismissed-title">已划走的内容 <span>{dismissed.length}</span></h2><p>恢复后，这条内容可以重新参与推荐；原有收藏和历史简报仍会保留。</p>{dismissed.length ? <ul className="dismissed-list">{dismissed.map(entry => { const item = itemMap.get(entry.itemId); return <li key={entry.itemId}><div><strong>{item?.name || entry.itemId}</strong><p>{item?.title || "这条内容目前不在已加载资料中"}</p>{item && <button className="text-link" onClick={() => { onClose(); onOpen(item); }}>查看详情 <ArrowUpRight size={13} /></button>}</div><button className="button secondary" disabled={disabled} onClick={() => void onRestore(entry.itemId)}><RotateCcw size={14} />恢复推荐</button></li>; })}</ul> : <div className="dismissed-empty"><Check size={28} /><strong>还没有划走的内容</strong><p>浏览时选择“不感兴趣”的内容会出现在这里。</p></div>}</div></div></dialog>;
}
