"use client";

/* eslint-disable @next/next/no-img-element -- Source screenshots retain their original public URLs. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, Bookmark, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Compass, ExternalLink, FileText, GitFork as Github, LayoutGrid, Lightbulb, Loader2, Mail, Menu, Radio, RefreshCw, Search, Settings2, Sparkles, Star, X, EyeOff, RotateCcw } from "lucide-react";
import type { FeedResponse, IntelItem, Preferences, SavedItem } from "@/lib/types";
import { DismissedItemsDialog, RecommendationsPanel, useInterestFeed } from "./interest";
import { DiscoveryGrid } from "./discovery-grid";
import type { DiscoveryGridHandle } from "./discovery-grid";
import { AIFrontier } from "./ai-frontier";

type View = "today" | "recommendations" | "products" | "design" | "saved" | "history";
type HistoryDay = { date: string; count: number; updatedAt: string; status: string; readAt: string | null; hasUpdates: boolean };
type ReadItem = { itemId: string; readAt: string };
const navigation = [{ id: "today", label: "今日精选", icon: LayoutGrid }, { id: "recommendations", label: "为你推荐", icon: Sparkles }, { id: "products", label: "产品拆解", icon: Compass }, { id: "design", label: "设计灵感", icon: Sparkles }, { id: "saved", label: "我的收藏", icon: Bookmark }, { id: "history", label: "往期简报", icon: CalendarDays }] as const;
const viewNames: Record<View, string> = { today: "今日精选", recommendations: "为你推荐", products: "产品拆解", design: "设计灵感", saved: "我的收藏", history: "往期简报" };
const day = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00+08:00` : value)) : "正在更新";
const time = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--:--";
const stars = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), url === "/api/refresh" ? 60_000 : 20_000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal, ...options });
    const json = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) throw new Error(json.error || json.message || "请求未完成，请稍后重试");
    return json as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("请求超时，请重试核对保存结果");
    throw err;
  } finally { clearTimeout(timeout); }
}

function Visual({ item, large = false }: { item: IntelItem; large?: boolean }) {
  return <ProductVisual key={`${item.id}:${item.image || "no-image"}`} item={item} large={large} />;
}

function ProductVisual({ item, large }: { item: IntelItem; large: boolean }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(item.image) && !failed;
  const caption = item.imageCaption || "官方公开配图";
  return <div className={`visual ${large ? "visual-large" : ""} ${hasImage ? "visual-image" : "visual-empty"}`} style={hasImage ? { backgroundColor: item.accent || "#e8eeea" } : undefined}>
    {hasImage ? <><img src={item.image} alt={`${item.name} · ${caption}`} onError={() => setFailed(true)} loading="lazy" /><span className="visual-kind">{caption}</span></> : <div className="visual-fallback"><Compass size={19} /><span><strong>{item.name}</strong><small>{failed ? "产品配图暂时无法加载" : "暂无产品截图"}</small></span></div>}
  </div>;
}

export default function Radar() {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [libraryItems, setLibraryItems] = useState<IntelItem[]>([]);
  const [favorites, setFavorites] = useState<SavedItem[]>([]);
  const [view, setView] = useState<View>("today");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<IntelItem | null>(null);
  const [settings, setSettings] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>({ email: "", deliveryTime: "08:30", emailEnabled: false });
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [historyDate, setHistoryDate] = useState("");
  const [historySaving, setHistorySaving] = useState("");
  const [readItems, setReadItems] = useState<ReadItem[]>([]);
  const [readingReady, setReadingReady] = useState(false);
  const [readingError, setReadingError] = useState("");
  const [homeFeatured, setHomeFeatured] = useState<IntelItem | null>(null);
  const [homeFeaturedReadyVersion, setHomeFeaturedReadyVersion] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("全部收藏");
  const [collection, setCollection] = useState("灵感收藏");
  const [note, setNote] = useState("");
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const mutationLockRef = useRef(false);
  const gridRef = useRef<DiscoveryGridHandle>(null);
  const feedSequenceRef = useRef(0);
  const historySequenceRef = useRef(0);
  const pendingReadsRef = useRef(new Set<string>());
  const knownReadsRef = useRef(new Set<string>());
  const detailRef = useRef<HTMLDialogElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4800); }, []);
  const interest = useInterestFeed({ onFavorites: setFavorites, notify, mutationLockRef });
  const mutationBusy = interest.busy || saving !== null || refreshing;
  const mergeReads = useCallback((items: ReadItem[]) => {
    for (const item of items) knownReadsRef.current.add(item.itemId);
    setReadItems(previous => [...new Map([...previous, ...items].map(item => [item.itemId, item])).values()]);
  }, []);
  const markRead = useCallback(async (itemId: string) => {
    if (knownReadsRef.current.has(itemId) || pendingReadsRef.current.has(itemId)) return;
    pendingReadsRef.current.add(itemId);
    try {
      const result = await request<{ items: ReadItem[] }>("/api/reading", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId }) });
      mergeReads(result.items); pendingReadsRef.current.delete(itemId); setReadingError("");
    } catch (err) { setReadingError(err instanceof Error ? err.message : "已看状态暂时无法保存"); }
  }, [mergeReads]);
  const reloadReading = useCallback(async () => {
    try {
      const result = await request<{ items: ReadItem[] }>("/api/reading");
      mergeReads(result.items); setReadingReady(true); setReadingError("");
      const pending = [...pendingReadsRef.current];
      pendingReadsRef.current.clear();
      for (const itemId of pending) await markRead(itemId);
    } catch (err) { setReadingError(err instanceof Error ? err.message : "阅读状态暂时无法读取"); }
  }, [markRead, mergeReads]);
  const loadFeed = useCallback(async (date = "") => {
    const sequence = ++feedSequenceRef.current;
    setLoading(true); setError("");
    try {
      const data = await request<FeedResponse>(`/api/feed${date ? `?date=${date}` : ""}`);
      if (sequence !== feedSequenceRef.current) return null;
      setFeed(data); if (!date) setLibraryItems(data.items);
      return data;
    } catch (err) { if (sequence === feedSequenceRef.current) setError(err instanceof Error ? err.message : "加载失败"); return null; }
    finally { if (sequence === feedSequenceRef.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const historySequence = historySequenceRef.current;
    void Promise.resolve().then(() => loadFeed());
    void Promise.resolve().then(reloadReading);
    void request<{ preferences: Preferences; emailConfigured: boolean }>("/api/preferences").then(data => { setPrefs(data.preferences); setEmailConfigured(data.emailConfigured); }).catch(() => notify("推送设置暂时无法读取"));
    void request<{ days: HistoryDay[] }>("/api/history").then(data => { if (historySequence === historySequenceRef.current) setHistory(data.days); }).catch(() => notify("简报阅读状态暂时无法读取，请刷新重试"));
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [loadFeed, notify, reloadReading]);
  useEffect(() => { const dialog = detailRef.current; if (selected && dialog) { if (!dialog.open) dialog.showModal(); void markRead(selected.id); } if (!selected && dialog?.open) dialog.close(); }, [markRead, selected]);
  useEffect(() => { const dialog = settingsRef.current; if (settings && dialog && !dialog.open) dialog.showModal(); if (!settings && dialog?.open) dialog.close(); }, [settings]);
  useEffect(() => {
    if (!selected && !settings && !mobileNav && !dismissedOpen) return;
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [selected, settings, mobileNav, dismissedOpen]);
  useEffect(() => {
    const message = toastRef.current;
    if (toast && message && !message.matches(":popover-open")) message.showPopover();
    if (!toast && message?.matches(":popover-open")) message.hidePopover();
  }, [toast]);
  const openItem = (item: IntelItem) => { const saved = favorites.find(f => f.itemId === item.id); setCollection(saved?.collection || "灵感收藏"); setNote(saved?.note || ""); setSelected(item); };
  const savedIds = useMemo(() => new Set(favorites.map(f => f.itemId)), [favorites]);
  const allItems = view === "history" ? feed?.items || [] : libraryItems;
  const readIds = useMemo(() => new Set(readItems.map(item => item.itemId)), [readItems]);
  const dismissedIds = useMemo(() => new Set(interest.feedback.filter(entry => entry.action === "not_interested").map(entry => entry.itemId)), [interest.feedback]);
  const editionIds = feed?.meta.editionItemIds;
  const viewItems = !query && (view === "today" || view === "history") && editionIds ? allItems.filter(item => editionIds.includes(item.id)) : allItems;
  const matchesSearch = (item: IntelItem) => {
    const term = query.toLocaleLowerCase().trim();
    return !term || `${item.name} ${item.title} ${item.summary} ${item.category} ${item.audience} ${item.pain} ${item.businessModel} ${item.tags.join(" ")} ${favorites.find(f => f.itemId === item.id)?.note || ""}`.toLocaleLowerCase().includes(term);
  };
  const visible = viewItems.filter(item => {
    const matchesView = view === "products" ? item.kind === "product" : view === "design" ? item.kind === "design" : view === "saved" ? savedIds.has(item.id) && (collectionFilter === "全部收藏" || favorites.find(f => f.itemId === item.id)?.collection === collectionFilter) : true;
    return matchesSearch(item) && matchesView && ((view === "history" || view === "saved") || !dismissedIds.has(item.id));
  });
  const products = visible.filter(item => item.kind === "product");
  const designs = visible.filter(item => item.kind === "design");
  const aiItems = visible.filter(item => item.kind === "ai");
  const historyFeatured = products.find(item => item.featured) || products[0];
  const feedVersion = feed ? `${feed.meta.date}:${feed.meta.updatedAt}` : "";
  const homeFeaturedReady = Boolean(feedVersion) && homeFeaturedReadyVersion === feedVersion;
  const featured = view === "history" ? historyFeatured : homeFeaturedReady && homeFeatured && !dismissedIds.has(homeFeatured.id) ? homeFeatured : null;
  const productList = view === "history" && !query ? products.filter(item => item.id !== featured?.id) : products;
  const hasVisibleContent = view === "today" && !query || visible.length > 0;
  const gridBlockedIds = useMemo(() => new Set([...readIds, ...interest.feedback.map(entry => entry.itemId)]), [readIds, interest.feedback]);
  useEffect(() => {
    if (!feed || historyDate || !readingReady || !interest.feedbackReady) return;
    if (homeFeaturedReadyVersion === feedVersion) return;
    let active = true;
    const edition = feed.meta.editionItemIds;
    const candidates = feed.items.filter(item => item.kind === "product" && (!edition || edition.includes(item.id)) && !readIds.has(item.id) && !savedIds.has(item.id) && !dismissedIds.has(item.id));
    void Promise.resolve().then(() => {
      if (!active) return;
      setHomeFeatured(candidates.find(item => item.featured) || candidates[0] || null);
      setHomeFeaturedReadyVersion(feedVersion);
    });
    return () => { active = false; };
  }, [feed, feedVersion, homeFeaturedReadyVersion, historyDate, readingReady, interest.feedbackReady, readIds, savedIds, dismissedIds]);
  const collectionNames = [...new Set(favorites.map(f => f.collection))];
  const changeView = (next: View) => { setView(next); setQuery(""); setMobileNav(false); if (historyDate && next !== "history") { setHistoryDate(""); void loadFeed(); } window.scrollTo({ top: 0, behavior: "smooth" }); };
  async function undoInterest() {
    const token = interest.getUndoToken();
    const done = await interest.undo();
    if (done && token) gridRef.current?.undo(token);
  }
  async function openEdition(date: string) {
    setHistoryDate(date);
    const data = await loadFeed(date);
    if (!data) return;
    await saveEditionRead(date, true, data.meta.updatedAt);
  }
  async function saveEditionRead(date: string, read: boolean, version?: string) {
    const sequence = ++historySequenceRef.current;
    setHistorySaving(date);
    try {
      const result = await request<{ days: HistoryDay[] }>("/api/history", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, read, ...(version ? { version } : {}) }) });
      if (sequence === historySequenceRef.current) setHistory(result.days);
    } catch (err) { notify(err instanceof Error ? err.message : "简报阅读状态未保存，请重试"); }
    finally { if (sequence === historySequenceRef.current) setHistorySaving(""); }
  }
  async function toggleFavorite(item: IntelItem) {
    if (mutationLockRef.current || !interest.feedbackReady) return;
    mutationLockRef.current = true; setSaving(item.id);
    try {
      if (savedIds.has(item.id)) { await request(`/api/favorites?itemId=${encodeURIComponent(item.id)}`, { method: "DELETE" }); setFavorites(prev => prev.filter(f => f.itemId !== item.id)); notify("已取消收藏"); }
      else { const data = await request<{ favorite: SavedItem }>("/api/favorites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, collection: "灵感收藏", note: "" }) }); setFavorites(prev => [...prev.filter(f => f.itemId !== item.id), data.favorite]); notify("已加入收藏，可以在详情里分类和写备注"); }
      await interest.loadRecommendations();
    } catch (err) { notify(err instanceof Error ? err.message : "收藏失败，请重试"); }
    finally { mutationLockRef.current = false; setSaving(null); }
  }
  async function saveNotes() {
    if (!selected || mutationLockRef.current || !interest.feedbackReady) return;
    mutationLockRef.current = true; setSaving(selected.id);
    try { const data = await request<{ favorite: SavedItem }>("/api/favorites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: selected.id, collection: collection.trim() || "灵感收藏", note }) }); setFavorites(prev => [...prev.filter(f => f.itemId !== selected.id), data.favorite]); notify("收藏和备注已保存"); await interest.loadRecommendations(); }
    catch (err) { notify(err instanceof Error ? err.message : "保存失败，请重试"); }
    finally { mutationLockRef.current = false; setSaving(null); }
  }
  async function refresh() {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true; setRefreshing(true);
    try { const result = await request<{ ok: boolean; count: number; partial: boolean; errors?: string[] }>("/api/refresh", { method: "POST" }); setHistoryDate(""); await loadFeed(); await interest.loadRecommendations(); const data = await request<{ days: HistoryDay[] }>("/api/history"); setHistory(data.days); notify(result.partial ? `部分 GitHub 数据核对完成；部分来源暂不可用` : `GitHub 数据核对完成，共 ${result.count} 条资料`); }
    catch (err) { notify(err instanceof Error ? err.message : "更新失败，请稍后重试"); }
    finally { mutationLockRef.current = false; setRefreshing(false); }
  }
  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPrefsSaving(true);
    try { const result = await request<{ preferences: Preferences }>("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...prefs, emailEnabled: emailConfigured && prefs.emailEnabled }) }); setPrefs(result.preferences); notify(emailConfigured ? "推送偏好已保存" : "邮箱和时间已保存，发信服务接通后可开启推送"); setSettings(false); }
    catch (err) { notify(err instanceof Error ? err.message : "保存失败"); }
    finally { setPrefsSaving(false); }
  }
  function exportFavorites() { const content = favorites.map(f => ({ ...f, product: allItems.find(i => i.id === f.itemId) || null })); const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "拾光-我的收藏.json"; a.click(); URL.revokeObjectURL(url); notify("收藏文件已导出"); }
  const bookmark = (item: IntelItem, className = "") => <button className={`bookmark-button ${savedIds.has(item.id) ? "is-saved" : ""} ${className}`} aria-label={savedIds.has(item.id) ? `取消收藏 ${item.name}` : `收藏 ${item.name}`} title={savedIds.has(item.id) ? "取消收藏" : "加入收藏"} disabled={mutationBusy || !interest.feedbackReady} onClick={(event) => { event.stopPropagation(); void toggleFavorite(item); }}>{saving === item.id ? <Loader2 size={17} className="spin" /> : <Bookmark size={17} fill={savedIds.has(item.id) ? "currentColor" : "none"} />}</button>;
  const dismissButton = (item: IntelItem, className = "") => <button className={`dismiss-button ${className}`} aria-label={`不感兴趣 ${item.name}`} title="不感兴趣，减少类似推荐" disabled={mutationBusy || !interest.feedbackReady} onClick={event => { event.stopPropagation(); void interest.submit(item, "not_interested").then(async done => { if (done) { await gridRef.current?.replaceDismissed(item.id, interest.getUndoToken()); if (selected?.id === item.id) setSelected(null); } }); }}><EyeOff size={15} /><span>不感兴趣</span></button>;
  const productCard = (item: IntelItem) => <article className="product-card" key={item.id}><button className="card-open" onClick={() => openItem(item)}><Visual item={item} /><div className="product-card-body"><div className="card-kicker"><span>{item.category}</span>{item.stars != null && <span className="star-count" title={`截至 ${item.starsCheckedAt || "采集时间"}`}><Star size={12} />{stars(item.stars)}</span>}</div><h3>{item.name}<ArrowUpRight size={16} /></h3><p>{item.title || item.summary}</p><div className="card-tags">{item.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}<span className="read-time">{item.readMinutes} 分钟</span></div></div></button>{bookmark(item, "card-bookmark")}{dismissButton(item, "card-dismiss")}</article>;
  const designCard = (item: IntelItem) => <article className="design-card" key={item.id}><button className="card-open" onClick={() => openItem(item)}><Visual item={item} /><div className="design-card-body"><div className="card-kicker"><span>{item.category}</span><span>{item.evidence}</span></div><h3>{item.name}<ArrowUpRight size={19} /></h3><p>{item.subtitle}</p><div className="card-tags">{item.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><ul className="design-highlights">{item.designNotes.slice(0, 3).map((note, index) => <li key={index}><span>0{index + 1}</span>{note}</li>)}</ul></div></button>{bookmark(item, "card-bookmark")}{dismissButton(item, "card-dismiss")}</article>;

  return <div className={`radar-app ${view === "recommendations" ? "recommendation-view" : ""}`}>
    {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="主导航"><Link className="brand" href="/" aria-label="拾光首页"><div className="brand-mark"><Radio size={24} strokeWidth={1.7} /></div><div><strong>拾光<span>SHIGUANG</span></strong><small>好产品，先看见。</small></div></Link><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={20} /></button><div className="nav-label">探索 · DISCOVER</div><nav>{navigation.map(nav => <button key={nav.id} onClick={() => changeView(nav.id)} className={`nav-item ${view === nav.id ? "active" : ""}`}><nav.icon size={18} strokeWidth={1.7} /><span>{nav.label}</span>{nav.id === "saved" && <span className="nav-count">{favorites.length}</span>}{nav.id === "today" && <span className="active-dot" />}</button>)}</nav><div className="sidebar-note"><div className="sidebar-note-icon"><Lightbulb size={18} /></div><strong>把灵感，变成下一步。</strong><p>跨行业发现好产品，<br />从需求、商业与设计中找灵感。</p><button onClick={() => changeView("saved")}>打开我的收藏 <ArrowRight size={14} /></button></div><div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />推送与偏好</button><div className="profile"><div className="avatar">P</div><div><strong>{feed?.user.name || "产品探索者"}</strong><span>个人情报工作台</span></div><span className="profile-dot" /></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="topbar-location"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>我的工作台</span><ChevronRight size={13} /><strong>{viewNames[view]}</strong></div><div className="topbar-actions">{view !== "recommendations" && <div className="search"><Search size={16} /><input aria-label="搜索产品、行业、场景或风格" placeholder="搜索产品、行业、场景或风格…" value={query} onChange={event => setQuery(event.target.value)} /><span>⌕</span></div>}<button className="icon-button settings-top" aria-label="推送设置" onClick={() => setSettings(true)}><Bell size={18} /><i /></button><button className="top-avatar" onClick={() => setSettings(true)} aria-label="个人偏好">P</button></div></header>
    <main className="main-content"><div className="page-intro"><div><div className="eyebrow"><span />PRODUCT INTELLIGENCE, DAILY</div><h1>{view === "today" ? <>每一天，都有好发现<span>✦</span></> : viewNames[view]}</h1><p>{view === "today" ? "从软件到实体产品，发现各行各业值得借鉴的好产品。" : view === "recommendations" ? "感兴趣就留下，不感兴趣就划走；根据你的选择推荐下一条灵感。" : view === "products" ? "跨行业拆解高关注与有市场表现依据的产品，看懂需求与商业价值。" : view === "design" ? "从界面、交互到产品形态，积累可借鉴的设计灵感。" : view === "saved" ? "把值得再看的产品与灵感，收进自己的知识地图。" : "每一份发现，都值得在未来被重新遇见。"}</p></div><div className="intro-actions"><span className="date-label"><CalendarDays size={15} />{day(feed?.meta.date)}</span><button className="button secondary refresh-button" disabled={mutationBusy} onClick={() => void refresh()}><RefreshCw size={14} className={refreshing ? "spin" : ""} />{refreshing ? "正在核对" : "更新数据"}</button></div></div>
    {view !== "recommendations" && <div className="mobile-search search"><Search size={16} /><input aria-label="手机搜索" placeholder="搜索产品、行业、场景或风格…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button onClick={() => setQuery("")} aria-label="清空搜索"><X size={15} /></button>}</div>}
    {view !== "recommendations" && <div className="brief-strip"><div className="brief-strip-left"><span className="live-dot" /><strong>{historyDate ? `${day(historyDate)}简报` : "本期简报"}</strong><span className="strip-separator" /><span>{feed ? `${historyDate ? feed.items.length : (feed.meta.editionItemIds?.length ?? feed.meta.total)} 条精选` : "正在读取"}</span><span className="desktop-only">·</span><span className="desktop-only">{feed?.meta.sourceCount || 0} 个信息来源</span></div><button onClick={() => setSettings(true)}><Mail size={14} /><span>{emailConfigured && prefs.emailEnabled ? `每日 ${prefs.deliveryTime} 邮件推送` : "设置邮件简报"}</span><ArrowUpRight size={13} /></button></div>}
    {readingError && <div className="inline-warning preference-warning" role="alert"><span>阅读记录尚未同步：{readingError}</span><button onClick={() => void reloadReading()}>重试保存与读取</button></div>}
    {interest.feedbackError && <div className="inline-warning preference-warning" role="alert"><span>阅读状态暂时无法核对：{interest.feedbackError}</span><button onClick={() => void interest.reconcile()} disabled={mutationBusy}>重试</button></div>}
    {view === "today" && <section className="discovery-entry"><div><Sparkles size={19} /><span><strong>让下一条，更合你的兴趣</strong><small>感兴趣留下，不感兴趣划走，从资料库自动补下一条。</small></span></div><button className="button primary" onClick={() => changeView("recommendations")}>开始刷灵感 <ArrowRight size={15} /></button></section>}
    {view !== "recommendations" && <div className="reading-feedback-toolbar"><span>{dismissedIds.size ? `已按偏好收起 ${dismissedIds.size} 条内容` : "你的选择会帮助调整后续推荐"}</span><div>{interest.undoToken && <button disabled={mutationBusy} onClick={() => void undoInterest()}><RotateCcw size={13} />撤销上一次</button>}<button onClick={() => setDismissedOpen(true)}><EyeOff size={13} />已划走</button></div></div>}
    {view === "recommendations" && <RecommendationsPanel data={interest.recommendations} loading={interest.loading} error={interest.error} disabled={mutationBusy || !interest.feedbackReady} undoToken={interest.undoToken} onFeedback={interest.submit} onOpen={openItem} onUndo={undoInterest} retryDisabled={mutationBusy} onRetry={interest.reconcile} onManage={() => setDismissedOpen(true)} onSaved={() => changeView("saved")} />}
    {view !== "recommendations" && <>
    {view === "history" && <section className="history-section"><div className="section-heading"><div><span className="section-mark"><CalendarDays size={16} /></span><h2>简报档案</h2></div><span className="muted">按日期查看 · 已读表示已打开该期</span></div><div className="history-days">{history.length ? history.map(record => <div className={`history-day ${historyDate === record.date ? "chosen" : ""}`} key={record.date}><button className="history-day-open" onClick={() => void openEdition(record.date)} aria-current={historyDate === record.date ? "date" : undefined}><CalendarDays size={19} /><strong>{record.date}</strong><span>{record.count} 条内容</span><span className={`reading-badge ${record.hasUpdates ? "has-updates" : record.readAt ? "is-read" : "is-unread"}`}>{record.hasUpdates ? <RefreshCw size={12} /> : record.readAt ? <Check size={12} /> : <i />}{record.hasUpdates ? "有更新" : record.readAt ? "已读" : "未读"}</span></button>{record.readAt && <button className="history-mark-unread" title="标为未读" aria-label={`将 ${record.date} 简报标为未读`} disabled={historySaving === record.date} onClick={() => void saveEditionRead(record.date, false)}>{historySaving === record.date ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}</button>}</div>) : <p className="muted">第一份简报将在本次更新后归档。</p>}</div></section>}
    {view === "saved" && <div className="collection-toolbar"><div className="collection-tabs">{["全部收藏", ...collectionNames].map(name => <button key={name} onClick={() => setCollectionFilter(name)} className={collectionFilter === name ? "selected" : ""}>{name}</button>)}</div><button className="button secondary" onClick={exportFavorites} disabled={!favorites.length}><ArrowDownToLine size={14} />导出收藏</button></div>}
    {loading ? <div className="loading-grid" aria-label="正在加载简报"><div className="skeleton skeleton-feature" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : error ? <div className="empty-state"><CircleHelp size={34} /><h2>资讯暂时没有加载出来</h2><p>{error}</p><button className="button primary" onClick={() => void loadFeed(historyDate)}>重新加载</button></div> : !hasVisibleContent ? <div className="empty-state">{view === "saved" ? <Bookmark size={34} /> : <Search size={34} />}<h2>{query ? "还没有找到匹配的内容" : view === "saved" ? "给下一个好想法留个位置" : "暂时没有待展示的内容"}</h2><p>{query ? "试试产品名称、行业、业务场景或设计风格。" : view === "saved" ? "点击卡片上的收藏图标，就能把喜欢的内容保存在这里。" : "可以到为你推荐继续探索，也可以在已划走中恢复内容。"}</p><button className="button primary" onClick={() => query ? setQuery("") : view === "saved" ? changeView("today") : changeView("recommendations")}>{query ? "清空搜索" : view === "saved" ? "去发现好产品" : "去刷灵感"}<ArrowRight size={15} /></button></div> : <>
    {(view === "today" || view === "history") && !query && featured && <section className="featured-section"><div className="section-heading"><div><span className="section-mark"><Compass size={16} /></span><h2>{view === "history" ? "本期产品解读" : "先看懂一个产品"}</h2><span className="section-description">它是什么 · 为什么有人需要 · 有什么价值</span></div><button className="text-link" onClick={() => changeView("products")}>全部拆解 <ArrowRight size={14} /></button></div><article className="featured-card"><button className="featured-image" onClick={() => openItem(featured)}><Visual item={featured} large /></button><div className="featured-body"><div className="featured-top"><span className="pill green"><span />本期重点 · PRODUCT PICK</span><div className="featured-feedback">{dismissButton(featured)}{bookmark(featured)}</div></div><div className="featured-name">{featured.name}<span>{featured.category}</span></div><button className="featured-title" onClick={() => openItem(featured)}><h2>{featured.title}</h2></button><p>{featured.summary}</p><div className="featured-insight"><Lightbulb size={17} /><span><strong>产品价值</strong>{featured.differentiation}</span></div><div className="featured-footer"><span>{featured.github ? <Github size={15} /> : <Compass size={15} />}{featured.stars != null ? `${stars(featured.stars)} Stars` : featured.evidence}<span className="footer-dot">·</span><Clock3 size={13} />{featured.readMinutes} 分钟</span><button onClick={() => openItem(featured)}>阅读拆解 <ArrowUpRight size={17} /></button></div></div></article></section>}
    {view === "saved" ? <section className="saved-grid">{visible.map(item => <div key={item.id}>{item.kind === "design" ? designCard(item) : productCard(item)}<button className="saved-note" onClick={() => openItem(item)}><FileText size={14} /><span><strong>{favorites.find(f => f.itemId === item.id)?.collection}</strong>{favorites.find(f => f.itemId === item.id)?.note || "添加你的想法与备注…"}</span><ChevronRight size={14} /></button></div>)}</section> : <>
    {view === "today" && !query && <><AIFrontier libraryItems={libraryItems} readIds={readIds} savedIds={savedIds} dismissedIds={dismissedIds} disabled={mutationBusy || !interest.feedbackReady} refreshKey={feed?.meta.updatedAt || ""} onOpen={openItem} onReadSource={item => void markRead(item.id)} onFeedback={interest.submit} /><DiscoveryGrid ref={gridRef} excludedId={featured?.id} blockedIds={gridBlockedIds} savedIds={savedIds} disabled={mutationBusy || !interest.feedbackReady} ready={readingReady && interest.feedbackReady && homeFeaturedReady} onOpen={openItem} onFeedback={interest.submit} getUndoToken={interest.getUndoToken} onUndo={undoInterest} renderVisual={item => <Visual item={item} />} onLibrary={() => changeView("products")} /></>}
    {productList.length > 0 && view !== "design" && (view !== "today" || query) && <section className="content-section"><div className="section-heading"><div><span className="section-mark"><LayoutGrid size={16} /></span><h2>{query ? "搜索结果 · 产品" : view === "products" ? "全部产品发现" : "本期产品"}</h2><span className="section-description">软件、硬件与消费产品 · 看懂需求与价值</span></div><span className="section-counter">{productList.length} 个产品</span></div><div className="product-grid">{productList.map(productCard)}</div></section>}
    {designs.length > 0 && <section className="content-section"><div className="section-heading"><div><span className="section-mark orange"><Sparkles size={16} /></span><h2>让灵感发生</h2><span className="section-description">好看的背后，有值得学习的设计</span></div>{view !== "design" && <button className="text-link" onClick={() => changeView("design")}>更多灵感 <ArrowRight size={14} /></button>}</div><div className="design-grid">{designs.map(designCard)}</div></section>}
    {aiItems.length > 0 && (view !== "today" || query) && view !== "design" && view !== "products" && <section className="content-section"><div className="section-heading"><div><span className="section-mark purple"><Sparkles size={16} /></span><h2>{view === "history" ? "本期 AI 动态" : "AI 资讯资料"}</h2><span className="section-description">只关心会影响产品的变化</span></div><span className="muted small">{aiItems.length} 条动态</span></div><div className="ai-list">{aiItems.map(item => <article className="ai-card" key={item.id}><div className="ai-brand" style={{ background: item.accent }}>{item.name.slice(0, 1)}</div><button className="ai-content" onClick={() => openItem(item)}><div className="card-kicker"><span>{item.name}</span><span>{item.evidence}</span>{item.publishedAt && <span>{day(item.publishedAt)} 发布</span>}</div><h3>{item.title}</h3><p>{item.summary}</p><span className="ai-action">产品机会 <ArrowRight size={13} /></span></button><div className="ai-feedback">{bookmark(item)}{dismissButton(item)}</div></article>)}</div></section>}
    </>}
    </>}
    </>}
    <footer className="page-footer"><div><Radio size={15} /><span>拾光</span><span className="footer-dot">·</span><span>让每一次发现，都有下一步</span></div><span>{feed?.meta.scheduleStatus ? `${feed.meta.scheduleStatus} · ` : ""}{feed?.meta.updatedAt ? `资料更新于 ${day(feed.meta.updatedAt)} ${time(feed.meta.updatedAt)}` : "资料来自公开来源"}<span className="footer-dot">·</span>商业判断为分析推断</span></footer>
    </main></div>
    <dialog className="detail-dialog" ref={detailRef} aria-labelledby="detail-heading" onCancel={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>{selected && <div className="dialog-inner" key={selected.id}>
      <div className="dialog-top"><span><span className="live-dot" />{selected.kind === "design" ? "设计灵感" : selected.kind === "ai" ? "AI 动态" : "产品解读"}</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="关闭详情"><X size={22} /></button></div>
      <div className="detail-scroll"><div className="detail-content">
        <div className="card-kicker"><span>{selected.category}</span><span>{selected.evidence}</span>{selected.stars != null && <span><Star size={12} />{stars(selected.stars)} Stars</span>}</div>
        <h2>{selected.name}</h2><h3 className="detail-title" id="detail-heading">{selected.title}</h3>
        <p className="detail-summary">{selected.summary}</p>
        <div className="detail-links"><a className="button primary" href={selected.website} target="_blank" rel="noopener noreferrer">{selected.kind === "product" ? "了解 / 体验产品" : "查看官方介绍"} <ArrowUpRight size={15} /></a>{selected.github && <a className="button secondary" href={selected.github} target="_blank" rel="noopener noreferrer"><Github size={15} />GitHub</a>}{dismissButton(selected)}{bookmark(selected)}</div>
        <div className="detail-product-visual"><Visual item={selected} large /></div>
        <div className="detail-reading">
          <section className="analysis-section"><h4><span>01</span>{selected.kind === "product" ? "谁会用它" : "这与谁有关"}</h4><p>{selected.audience}</p></section>
          <section className="analysis-section"><h4><span>02</span>{selected.kind === "design" ? "设计背景与要解决的问题" : "为什么会有这个需求"}</h4><p>{selected.pain}</p></section>
          {selected.scenario && <section className="scenario-section"><h4><Lightbulb size={17} />用一个例子看懂</h4><p>{selected.scenario}</p></section>}
          <section className="analysis-section workflow-section"><h4><span>03</span>{selected.kind === "product" ? "实际怎么使用" : selected.kind === "design" ? "交互是怎么组织的" : "它如何发挥作用"}</h4>{selected.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean).length > 1 ? <ol className="workflow-steps">{selected.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean).map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol> : <p>{selected.workflow}</p>}</section>
          <section className="value-section"><h4><Check size={17} />{selected.kind === "design" ? "这个设计带来的价值" : selected.kind === "ai" ? "这次变化带来的价值" : "它给用户带来什么价值"}</h4><p>{selected.differentiation}</p></section>
          {selected.caveats[0] && <p className="usage-note"><CircleHelp size={15} /><span><strong>使用前了解：</strong>{selected.caveats[0]}</span></p>}
          <div className="business-sections"><section className="analysis-section"><h4><span>04</span>{selected.kind === "product" ? "怎么收费，用户为什么付费" : "商业与使用条件"}</h4><p>{selected.businessModel}</p></section><section className="analysis-section"><h4><span>05</span>我们可以借鉴什么</h4><p>{selected.opportunity}</p></section></div>
          {selected.designNotes.length > 0 && <section className="analysis-section"><h4><span><Sparkles size={15} /></span>值得借鉴的设计</h4><ul>{selected.designNotes.map((text, index) => <li key={index}>{text}</li>)}</ul></section>}
        </div>
        <details className="evidence-details"><summary><span><FileText size={16} />数据与来源</span><span>核对事实、日期与使用条件<ChevronRight size={16} /></span></summary><div className="evidence-content">
          <div className="detail-facts"><h4><Check size={16} />已核对的公开资料</h4><ul>{selected.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></div>
          <section className="caveats"><h4>使用条件与待验证信息</h4><ul>{selected.caveats.map((text, index) => <li key={index}>{text}</li>)}</ul><p>{selected.publishedAt ? `发布于 ${day(selected.publishedAt)} · ` : ""}收录于 {day(selected.discoveredAt)}{selected.starsCheckedAt ? ` · Star 核对于 ${day(selected.starsCheckedAt)}` : ""}；高关注度与市场表现分别核对，商业机会属于分析推断。</p></section>
          <section className="sources-section"><h4>原始资料</h4>{selected.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.label}<small>{source.url}</small></span><ExternalLink size={15} /></a>)}</section>
        </div></details>
        <section className="note-editor"><div><Bookmark size={18} /><h4>{savedIds.has(selected.id) ? "收藏与我的想法" : "把这条灵感收起来"}</h4></div><label>收藏分类<input value={collection} onChange={event => setCollection(event.target.value)} list="collection-list" maxLength={40} placeholder="例如：值得试用、界面参考" /></label><datalist id="collection-list">{["灵感收藏", "值得试用", "商业模式", "界面参考", ...collectionNames].filter((name, index, names) => names.indexOf(name) === index).map(name => <option value={name} key={name} />)}</datalist><label>我的备注<textarea rows={3} maxLength={2000} placeholder="哪些地方值得借鉴？准备在哪个项目里试一试？" value={note} onChange={event => setNote(event.target.value)} /></label><button className="button primary" disabled={mutationBusy || !interest.feedbackReady} onClick={() => void saveNotes()}>{saving === selected.id ? <Loader2 size={15} className="spin" /> : <Bookmark size={15} />}{savedIds.has(selected.id) ? "保存分类与备注" : "收藏并保存备注"}</button></section>
      </div></div></div>}</dialog>
    <DismissedItemsDialog open={dismissedOpen} feedback={interest.feedback} items={libraryItems} disabled={mutationBusy} onClose={() => setDismissedOpen(false)} onRestore={interest.restore} onOpen={openItem} />
    <dialog className="settings-dialog" ref={settingsRef} aria-labelledby="settings-heading" onCancel={() => setSettings(false)} onClick={event => { if (event.target === event.currentTarget) setSettings(false); }}><div className="dialog-inner"><div className="dialog-top"><span><Mail size={17} />推送与偏好</span><button className="icon-button" aria-label="关闭设置" onClick={() => setSettings(false)}><X size={21} /></button></div><form className="settings-form" onSubmit={event => void savePreferences(event)}><div className="settings-icon"><Mail size={26} /></div><h2 id="settings-heading">让好发现，主动找到你。</h2><p>在手机邮箱读简报，回到工作台深入研究。</p><label>接收邮箱<input type="email" value={prefs.email} placeholder="your@email.com" onChange={event => setPrefs({ ...prefs, email: event.target.value })} required /></label><label>每日推送时间 <span>北京时间 · Asia/Shanghai</span><input type="time" value={prefs.deliveryTime} onChange={event => setPrefs({ ...prefs, deliveryTime: event.target.value })} required /></label><div className="email-switch"><div><strong>每日邮件简报</strong><p>{emailConfigured ? "每天汇总最新产品与设计灵感" : "邮箱和时间可保存，发信服务尚未配置"}</p></div><input type="checkbox" role="switch" aria-label="开启每日邮件简报" disabled={!emailConfigured} checked={emailConfigured && prefs.emailEnabled} onChange={event => setPrefs({ ...prefs, emailEnabled: event.target.checked })} /></div><div className="settings-status"><span className={emailConfigured ? "live-dot" : "status-dot"} /><span>{emailConfigured ? "发信服务已连接，发送结果以投递记录为准。" : "当前未开启自动邮件投递；配置发信服务后可启用。"}</span></div><button className="button primary" type="submit" disabled={prefsSaving}>{prefsSaving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}保存偏好</button></form></div></dialog>
    {toast && <div className="toast" popover="manual" ref={toastRef} role="status"><Check size={17} />{toast}<button onClick={() => setToast("")} aria-label="关闭提示"><X size={15} /></button></div>}
  </div>;
}
