"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, Check, EyeOff, Loader2, Sparkles } from "lucide-react";
import type { IntelItem } from "@/lib/types";
import { FRONTIER_LIMIT, frontierLabel, recentFrontierItems } from "@/lib/frontier";
import type { InterestAction, RecommendationResult } from "./interest";

const dateLabel = (item: IntelItem) => `${item.publishedAt ? "发布于" : "收录于"} ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(item.publishedAt || item.discoveredAt))}`;

export function FrontierNews({ libraryItems, readIds, savedIds, dismissedIds, disabled, refreshKey, onAll, onOpen, onReadSource, onFeedback }: {
  libraryItems: IntelItem[]; readIds: Set<string>; savedIds: Set<string>; dismissedIds: Set<string>; disabled: boolean; refreshKey: string;
  onAll: () => void; onOpen: (item: IntelItem) => void; onReadSource: (item: IntelItem) => void; onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>;
}) {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [showRead, setShowRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const [changing, setChanging] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const dismissedKey = [...dismissedIds].sort().join(',');
  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/recommendations?scope=frontier&limit=${FRONTIER_LIMIT}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as RecommendationResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "前沿资讯暂时无法读取");
      if (sequence === sequenceRef.current) { setItems(result.items); setCheckedAt(Date.now()); }
    } catch (err) {
      if (sequence === sequenceRef.current) setError(err instanceof Error && err.name !== "AbortError" ? err.message : "读取超时，请重试");
    } finally { clearTimeout(timeout); if (sequence === sequenceRef.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { ++sequenceRef.current; controllerRef.current?.abort(); }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    return () => { active = false; invalidate(); };
  }, [load, invalidate, refreshKey, dismissedKey]);

  const archived = recentFrontierItems(libraryItems, checkedAt).filter(item => readIds.has(item.id) && !dismissedIds.has(item.id)).slice(0, FRONTIER_LIMIT);
  const visible = showRead ? archived : items.filter(item => !dismissedIds.has(item.id));
  async function choose(item: IntelItem, action: InterestAction) {
    if (disabled || changing) return;
    setChanging(item.id);
    try { await onFeedback(item, action); }
    finally { setChanging(null); }
  }
  return <section className="content-section ai-frontier-section" aria-label="前沿动态">
    <div className="section-heading"><div><span className="section-mark purple"><Sparkles size={16} /></span><h2>前沿动态</h2><span className="section-description">AI · 科技 · 产品 · 最近 7 天{!loading && visible.length > 0 ? ` · ${visible.length} 条` : ""}</span></div><div className="frontier-heading-actions"><button className="text-link" aria-pressed={showRead} onClick={() => setShowRead(value => !value)}>{showRead ? "返回精选动态" : "查看已读"}<ArrowUpRight size={14} /></button><button className="text-link" onClick={onAll}>查看全部 <ArrowUpRight size={14} /></button></div></div>
    {error && <div className="inline-warning discovery-grid-warning" role="alert"><span>{error}</span><button disabled={loading} onClick={() => void load()}>重试</button></div>}
    {loading && !visible.length ? <div className="frontier-empty" role="status"><Loader2 className="spin" size={20} />正在读取前沿资讯</div> : visible.length ? <div className="frontier-list">{visible.map(item => <article className="frontier-card" key={item.id} data-item-id={item.id}>
      <div className="frontier-meta"><span className="frontier-topic">{frontierLabel(item)}</span><span>{dateLabel(item)}</span><span className={`reading-badge ${readIds.has(item.id) ? "is-read" : "is-unread"}`}>{readIds.has(item.id) ? <Check size={12} /> : <i />}{readIds.has(item.id) ? "已读" : "未读"}</span></div>
      <button className="frontier-open" onClick={() => onOpen(item)}><h3>{item.title}<ArrowUpRight size={16} /></h3><p>{item.summary}</p></button>
      <div className="frontier-footer"><a className="text-link" href={item.sources[0]?.url || item.website} target="_blank" rel="noopener noreferrer" onClick={() => onReadSource(item)}>原始来源 <ArrowUpRight size={12} /></a><div><button className={`grid-interest ${savedIds.has(item.id) ? "is-saved" : ""}`} disabled={disabled || changing !== null || savedIds.has(item.id)} onClick={() => void choose(item, "interested")}>{savedIds.has(item.id) ? <Check size={13} /> : <Bookmark size={13} />}{savedIds.has(item.id) ? "已收藏" : "感兴趣"}</button><button className="grid-dismiss" disabled={disabled || changing !== null} onClick={() => void choose(item, "not_interested")}><EyeOff size={13} />不感兴趣</button></div></div>
    </article>)}</div> : !error && <div className="frontier-empty"><Sparkles size={23} /><div><strong>{showRead ? "最近 7 天还没有已读资讯" : "近 7 天暂未收录可展示的前沿资讯"}</strong><p>{showRead ? "打开资讯详情后会记录在这里。" : "当前资料库没有符合条件的内容；采集范围包括 AI、科技和产品热点。"}</p></div></div>}
  </section>;
}
