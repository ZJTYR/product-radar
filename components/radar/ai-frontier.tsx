"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, Check, EyeOff, Loader2, Sparkles } from "lucide-react";
import type { IntelItem } from "@/lib/types";
import type { InterestAction, RecommendationResult } from "./interest";

const topics = { agents: "Agent 与工作流", knowledge: "知识与记忆", multimodal: "多模态交互", integration: "应用集成", engineering: "应用工程" };
const dateLabel = (item: IntelItem) => `${item.publishedAt ? "发布于" : "收录于"} ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(new Date(item.publishedAt || item.discoveredAt))}`;

export function AIFrontier({ libraryItems, readIds, savedIds, dismissedIds, disabled, refreshKey, onOpen, onReadSource, onFeedback }: {
  libraryItems: IntelItem[]; readIds: Set<string>; savedIds: Set<string>; dismissedIds: Set<string>; disabled: boolean; refreshKey: string;
  onOpen: (item: IntelItem) => void; onReadSource: (item: IntelItem) => void; onFeedback: (item: IntelItem, action: InterestAction) => Promise<boolean>;
}) {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [showRead, setShowRead] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [at] = useState(() => Date.now());
  const [changing, setChanging] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++sequenceRef.current;
    setLoading(true); setError("");
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/recommendations?scope=ai&limit=5", { cache: "no-store", signal: controller.signal });
      const result = await response.json() as RecommendationResult & { error?: string };
      if (!response.ok) throw new Error(result.error || "AI 应用动态暂时无法读取");
      if (sequence === sequenceRef.current) setItems(result.items);
    } catch (err) { if (sequence === sequenceRef.current) setError(err instanceof Error && err.name !== "AbortError" ? err.message : "读取超时，请重试"); }
    finally { clearTimeout(timeout); if (sequence === sequenceRef.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { ++sequenceRef.current; }, []);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) void load(); }); return () => { active = false; invalidate(); }; }, [invalidate, load, refreshKey]);

  const archived = libraryItems.filter(item => item.kind === "ai" && item.aiApplication && readIds.has(item.id) && !dismissedIds.has(item.id) && at >= Date.parse(item.publishedAt || item.discoveredAt) && at - Date.parse(item.publishedAt || item.discoveredAt) <= 7 * 86400000).sort((a, b) => (b.publishedAt || b.discoveredAt).localeCompare(a.publishedAt || a.discoveredAt));
  const visible = showRead ? archived : items.filter(item => !dismissedIds.has(item.id));
  async function choose(item: IntelItem, action: InterestAction) {
    if (disabled || changing) return;
    setChanging(item.id);
    const done = await onFeedback(item, action);
    if (done && action === "not_interested") await load();
    setChanging(null);
  }
  return <section className="content-section ai-frontier-section" aria-label="AI 前沿"><div className="section-heading"><div><span className="section-mark purple"><Sparkles size={16} /></span><h2>AI 前沿</h2><span className="section-description">关注应用层技术与功能 · 最近 7 天</span></div><button className="text-link" aria-pressed={showRead} onClick={() => setShowRead(value => !value)}>{showRead ? "返回未读动态" : "查看已读"}<ArrowUpRight size={14} /></button></div><p className="section-context">从 Agent 工作流、知识与记忆，到多模态交互和应用集成，关注可以用在产品里的新能力。</p>
    {error && <div className="inline-warning discovery-grid-warning" role="alert"><span>{error}</span><button disabled={loading} onClick={() => void load()}>重试</button></div>}
    {loading && !visible.length ? <div className="frontier-empty" role="status"><Loader2 className="spin" size={20} />正在读取应用动态</div> : visible.length ? <div className="frontier-list">{visible.map(item => <article className="frontier-card" key={item.id} data-item-id={item.id}><div className="frontier-meta"><span className="frontier-topic">{item.aiApplication ? topics[item.aiApplication] : item.category}</span><span>{dateLabel(item)}</span><span className={`reading-badge ${readIds.has(item.id) ? "is-read" : "is-unread"}`}>{readIds.has(item.id) ? <Check size={12} /> : <i />}{readIds.has(item.id) ? "已读" : "未读"}</span></div><button className="frontier-open" onClick={() => onOpen(item)}><h3>{item.title}<ArrowUpRight size={16} /></h3><p>{item.summary}</p></button><div className="frontier-detail-lines"><p><strong>应用场景</strong>{item.scenario || item.audience}</p><p><strong>产品启发 · 推断</strong>{item.opportunity.replace(/^(?:产品推断|产品观察|推断)[：:]/, "")}</p><p><strong>使用条件</strong>{item.caveats[0] || "具体条件请查看原始资料"}</p></div><div className="frontier-footer"><a className="text-link" href={item.sources[0]?.url || item.website} target="_blank" rel="noopener noreferrer" onClick={() => onReadSource(item)}>原始来源 <ArrowUpRight size={12} /></a><div><button className={`grid-interest ${savedIds.has(item.id) ? "is-saved" : ""}`} disabled={disabled || changing !== null || savedIds.has(item.id)} onClick={() => void choose(item, "interested")}>{savedIds.has(item.id) ? <Check size={13} /> : <Bookmark size={13} />}{savedIds.has(item.id) ? "已收藏" : "感兴趣"}</button><button className="grid-dismiss" disabled={disabled || changing !== null} onClick={() => void choose(item, "not_interested")}><EyeOff size={13} />不感兴趣</button></div></div></article>)}</div> : !error && <div className="frontier-empty"><Sparkles size={23} /><div><strong>{showRead ? "最近 7 天还没有已读应用动态" : "暂无新的 AI 应用动态"}</strong><p>{showRead ? "打开资讯详情后会记录在这里。" : "有可核验的应用功能、技术或工作流进展时再更新，不以旧消息凑数。"}</p></div></div>}
  </section>;
}
