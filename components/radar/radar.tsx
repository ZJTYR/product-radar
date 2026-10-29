"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Bookmark, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Compass, ExternalLink, FileText, GitFork as Github, LayoutGrid, Lightbulb, Loader2, Mail, Menu, Radio, RefreshCw, Search, Settings2, Sparkles, Star, X, EyeOff, RotateCcw, Folder, BookOpen } from "lucide-react";
import type { FeedResponse, IntelItem, Preferences, SavedItem } from "@/lib/types";
import { Visual } from "./product-visual";
import { useRadarNavigation } from "./use-radar-navigation";
import { LibraryToolbar } from "./library-toolbar";
import { filterLibrary } from "@/lib/library-search";
import type { RadarLocation, RadarView as View } from "@/lib/radar-navigation";
import type { ReadingAnnotation } from "@/lib/annotations";
import type { EmailDeliveryView, EmailScheduleView } from "@/lib/email-types";
import { briefCheckMessage, editionAvailability, githubCheckMessage, latestEdition, readBriefUpdates, resolveHomeFeatured, shanghaiDay } from "@/lib/home-feed";
import { DismissedItemsDialog, RecommendationsPanel, useInterestFeed } from "./interest";
import { DiscoveryGrid } from "./discovery-grid";
import type { DiscoveryGridHandle } from "./discovery-grid";
import { FrontierNews } from "./frontier-news";
import { ImageGallery } from "./image-gallery";
import { CollectionEditor } from "./collection-editor";
import type { CollectionTarget } from "./collection-editor";
import { AnnotationProvider, AnnotatedText, ReadingAnnotations, useReadingNotes } from "./annotations";

type HistoryDay = { date: string; count: number; updatedAt: string; status: string; readAt: string | null; hasUpdates: boolean };
type ReadItem = { itemId: string; readAt: string };
const navigation = [{ id: "today", label: "今日精选", icon: LayoutGrid }, { id: "recommendations", label: "为你推荐", icon: Sparkles }, { id: "products", label: "产品拆解", icon: Compass }, { id: "design", label: "设计灵感", icon: Sparkles }, { id: "frontier", label: "全部前沿", icon: Sparkles }, { id: "saved", label: "我的收藏", icon: Bookmark }, { id: "history", label: "往期简报", icon: CalendarDays }] as const;
const viewNames: Record<View, string> = { today: "今日精选", recommendations: "为你推荐", products: "产品拆解", design: "设计灵感", frontier: "全部前沿", saved: "我的收藏", history: "往期简报" };
const day = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" }).format(new Date(value.length === 10 ? `${value}T12:00:00+08:00` : value)) : "正在更新";
const time = (value?: string) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "--:--";
const stars = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), url === "/api/refresh" || url.startsWith("/api/email/") ? 60_000 : 20_000);
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

export default function Radar() {
  return <AnnotationProvider><RadarWorkspace /></AnnotationProvider>;
}

function RadarWorkspace() {
  const readingNotes = useReadingNotes();
  const navigationState = useRadarNavigation();
  const { location: routeLocation, navigate, closeDetail, ready: navigationReady, restoreScroll } = navigationState;
  const { registerNavigator } = readingNotes;
  const { view, query } = routeLocation;
  const historyDate = routeLocation.view === "history" ? routeLocation.date : "";
  const collectionFilter = routeLocation.collection || "全部收藏";
  const setQuery = (value: string) => navigate({ query: value }, { replace: true });
  const setCollectionFilter = (value: string) => navigate({ collection: value === "全部收藏" ? "" : value });
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [libraryItems, setLibraryItems] = useState<IntelItem[]>([]);
  const [favorites, setFavorites] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState<"brief" | "github" | null>(null);
  const [clockToday, setClockToday] = useState("");
  const [feedRevision, setFeedRevision] = useState(0);
  const [refreshError, setRefreshError] = useState("");
  const [refreshErrorSource, setRefreshErrorSource] = useState<"brief" | "github">("brief");
  const [catalogReady, setCatalogReady] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const loadedEditionRef = useRef("");
  const [loadedEdition, setLoadedEdition] = useState("");
  const selected = routeLocation.item && (!historyDate || loadedEdition === historyDate) ? (historyDate ? feed?.items || [] : libraryItems).find(item => item.id === routeLocation.item) || null : null;
  const selectedSourceDate = historyDate || undefined;
  const [settings, setSettings] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>({ email: "", deliveryTime: "20:00", emailEnabled: false });
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [deliveryReady, setDeliveryReady] = useState(false);
  const [deliveryReason, setDeliveryReason] = useState("正在核对发信配置");
  const [emailDelivery, setEmailDelivery] = useState<EmailDeliveryView | null>(null);
  const [savedEmail, setSavedEmail] = useState("");
  const [savedPreferences, setSavedPreferences] = useState<Preferences | null>(null);
  const [emailSchedule, setEmailSchedule] = useState<EmailScheduleView | null>(null);
  const [emailBusy, setEmailBusy] = useState<"test" | "daily" | "retry" | null>(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const emailLockRef = useRef(false);
  const testRequestRef = useRef<string | null>(null);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [history, setHistory] = useState<HistoryDay[]>([]);
  const [historySaving, setHistorySaving] = useState("");
  const [readItems, setReadItems] = useState<ReadItem[]>([]);
  const [readingReady, setReadingReady] = useState(false);
  const [readingError, setReadingError] = useState("");
  const [homeFeatured, setHomeFeatured] = useState<IntelItem | null>(null);
  const [homeFeaturedReadyVersion, setHomeFeaturedReadyVersion] = useState("");
  const [collectionTarget, setCollectionTarget] = useState<CollectionTarget | null>(null);
  const [dismissedOpen, setDismissedOpen] = useState(false);
  const mutationLockRef = useRef(false);
  const gridRef = useRef<DiscoveryGridHandle>(null);
  const feedSequenceRef = useRef(0);
  const historySequenceRef = useRef(0);
  const readingSequenceRef = useRef(0);
  const pendingReadsRef = useRef(new Set<string>());
  const knownReadsRef = useRef(new Set<string>());
  const detailRef = useRef<HTMLDialogElement>(null);
  const settingsRef = useRef<HTMLDialogElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), 4800); }, []);
  const interest = useInterestFeed({ onFavorites: setFavorites, notify, mutationLockRef });
  const mutationBusy = interest.busy || saving !== null || refreshing !== null;
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
    const sequence = ++readingSequenceRef.current;
    setReadingReady(false);
    try {
      const result = await request<{ items: ReadItem[] }>("/api/reading");
      if (sequence !== readingSequenceRef.current) return false;
      mergeReads(result.items); setReadingReady(true); setReadingError("");
      const pending = [...pendingReadsRef.current];
      pendingReadsRef.current.clear();
      for (const itemId of pending) await markRead(itemId);
      return pendingReadsRef.current.size === 0;
    } catch (err) { if (sequence === readingSequenceRef.current) setReadingError(err instanceof Error ? err.message : "阅读状态暂时无法读取"); return false; }
  }, [markRead, mergeReads]);
  const loadFeed = useCallback(async (date = "") => {
    const sequence = ++feedSequenceRef.current;
    setLoading(true); setError("");
    try {
      const data = await request<FeedResponse>(`/api/feed${date ? `?date=${date}` : ""}`);
      if (sequence !== feedSequenceRef.current) return null;
      setFeed(data); loadedEditionRef.current = date; setLoadedEdition(date); if (!date) { setLibraryItems(data.items); setCatalogReady(true); setFeedRevision(previous => previous + 1); }
      return data;
    } catch (err) { if (sequence === feedSequenceRef.current) setError(err instanceof Error ? err.message : "加载失败"); return null; }
    finally { if (sequence === feedSequenceRef.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const tick = () => setClockToday(shanghaiDay());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const historySequence = historySequenceRef.current;
    void Promise.resolve().then(() => loadFeed()).finally(() => setCatalogReady(true));
    void Promise.resolve().then(reloadReading);
    void request<{ preferences: Preferences; emailConfigured: boolean; deliveryReady: boolean; deliveryReason: string; schedule?:EmailScheduleView }>("/api/preferences").then(data => { setPrefs(data.preferences); setSavedPreferences(data.preferences); setSavedEmail(data.preferences.email); setEmailConfigured(data.emailConfigured); setDeliveryReady(data.deliveryReady); setDeliveryReason(data.deliveryReason); setEmailSchedule(data.schedule || null); }).catch(() => notify("偏好设置暂时无法读取"));
    void request<{ days: HistoryDay[] }>("/api/history").then(data => { if (historySequence === historySequenceRef.current) setHistory(data.days); }).catch(() => notify("简报阅读状态暂时无法读取，请刷新重试"));
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [loadFeed, notify, reloadReading]);
  useEffect(() => { const dialog = detailRef.current; if (selected && dialog) { if (!dialog.open) dialog.showModal(); void markRead(selected.id); } if (!selected && dialog?.open) dialog.close(); }, [markRead, selected]);
  const loadEmailStatus = useCallback(async () => {
    setEmailLoading(true); setEmailError("");
    try {
      const result = await request<{deliveryReady:boolean;deliveryReason:string;latest:EmailDeliveryView|null;schedule?:EmailScheduleView}>("/api/email");
      setDeliveryReady(result.deliveryReady); setDeliveryReason(result.deliveryReason); setEmailDelivery(result.latest); setEmailSchedule(result.schedule || null);
    } catch (failure) { setEmailError(failure instanceof Error ? failure.message : "投递状态暂时无法读取"); }
    finally { setEmailLoading(false); }
  }, []);
  useEffect(() => { if (settings) void Promise.resolve().then(loadEmailStatus); }, [loadEmailStatus, settings]);
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
  const openItem = (item: IntelItem) => { navigate({ item: item.id, annotation: "" }, { detail: true }); };
  const openLibraryItem = (item: IntelItem) => {
    navigate({ view: item.kind === "design" ? "design" : item.kind === "ai" || item.kind === "news" ? "frontier" : "products", date: "", item: item.id, annotation: "", query: "", category: "", read: "all", topic: "all", range: "all", collection: "" }, { detail: true });
  };
  const savedIds = useMemo(() => new Set(favorites.map(f => f.itemId)), [favorites]);
  const allItems = view === "history" ? feed?.items || [] : libraryItems;
  const readIds = useMemo(() => new Set(readItems.map(item => item.itemId)), [readItems]);
  const dismissedIds = useMemo(() => new Set(interest.feedback.filter(entry => entry.action === "not_interested").map(entry => entry.itemId)), [interest.feedback]);
  const editionIds = feed?.meta.editionItemIds;
  const viewItems = !query && (view === "today" || view === "history") && editionIds ? allItems.filter(item => editionIds.includes(item.id)) : allItems;
  const matchesSearch = (item: IntelItem) => {
    const term = query.toLocaleLowerCase().trim();
    return !term || `${item.name} ${item.title} ${item.summary} ${item.category} ${item.audience} ${item.pain} ${item.businessModel} ${item.tags.join(" ")} ${readingNotes.notes.filter(note => note.itemId === item.id).map(note => `${note.quote} ${note.body}`).join(" ")}`.toLocaleLowerCase().includes(term);
  };
  const matchingItems = viewItems.filter(item => {
    const matchesView = view === "products" ? item.kind === "product" : view === "design" ? item.kind === "design" : view === "frontier" ? item.kind === "ai" || item.kind === "news" : view === "saved" ? savedIds.has(item.id) && (collectionFilter === "全部收藏" || favorites.find(f => f.itemId === item.id)?.collection === collectionFilter) : true;
    return matchesSearch(item) && matchesView && ((view === "history" || view === "saved") || !dismissedIds.has(item.id));
  });
  const libraryView = view === "products" || view === "design" || view === "frontier";
  const unresolvedReading = libraryView && routeLocation.read !== "all" && !readingReady;
  const visible = libraryView ? filterLibrary(matchingItems, routeLocation, readIds) : matchingItems;
  const categories = [...new Set(matchingItems.map(item => item.category))].sort((a,b) => a.localeCompare(b,"zh-CN"));
  const products = visible.filter(item => item.kind === "product");
  const designs = visible.filter(item => item.kind === "design");
  const aiItems = visible.filter(item => (item.kind === "ai" || item.kind === "news"));
  const historyFeatured = products.find(item => item.featured) || products[0];
  const feedVersion = feed ? `${feed.meta.date}:${feed.meta.updatedAt}:${feedRevision}` : "";
  const homeFeaturedReady = Boolean(feedVersion) && homeFeaturedReadyVersion === feedVersion;
  const featured = view === "history" ? historyFeatured : homeFeaturedReady && homeFeatured && !dismissedIds.has(homeFeatured.id) ? homeFeatured : null;
  const productList = view === "history" && !query ? products.filter(item => item.id !== featured?.id) : products;
  const hasVisibleContent = view === "today" && !query || visible.length > 0;
  const gridBlockedIds = useMemo(() => new Set([...readIds, ...interest.feedback.map(entry => entry.itemId)]), [readIds, interest.feedback]);
  useEffect(() => {
    if (!feed || historyDate || !readingReady || !interest.feedbackReady) return;
    // 当前卡已读或已收藏时留在原位；明确检查、重访或划走后再选择下一条。
    const next = resolveHomeFeatured(homeFeatured, homeFeaturedReadyVersion === feedVersion, feed.items, feed.meta.editionItemIds, readIds, savedIds, dismissedIds);
    if (homeFeaturedReadyVersion === feedVersion && next === homeFeatured) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setHomeFeatured(next);
      setHomeFeaturedReadyVersion(feedVersion);
    });
    return () => { active = false; };
  }, [feed, feedVersion, homeFeatured, homeFeaturedReadyVersion, historyDate, readingReady, interest.feedbackReady, readIds, savedIds, dismissedIds]);
  const today = clockToday || feed?.meta.freshness?.today || "";
  const latest = feed ? latestEdition(feed.meta) : { date: "", updatedAt: "" };
  const availability = editionAvailability(today, latest.date);
  const libraryFeatured = Boolean(view === "today" && featured && editionIds && !editionIds.includes(featured.id));
  const featuredStateError = readingError || interest.feedbackError;
  const collectionNames = [...new Set(favorites.map(f => f.collection))];
  const changeView = (next: View) => { navigate({ view: next, query: "", category: "", read: "all", topic: "all", range: "all", sort: "recent", collection: "", date: "", item: "", annotation: "" }); setMobileNav(false); };
  const changeLibraryFilter = (patch: Partial<RadarLocation>) => navigate(patch);
  const handleOpenNote = useCallback((note: ReadingAnnotation, locate = false) => {
    const item = libraryItems.find(entry => entry.id === note.itemId);
    const noteView: View = item?.kind === "design" ? "design" : item?.kind === "ai" || item?.kind === "news" ? "frontier" : "products";
    navigate({ view: note.sourceDate ? "history" : noteView, date: note.sourceDate || "", item: note.itemId, annotation: locate ? note.id : "", query: "", category: "", read: "all", topic: "all", range: "all" }, { detail: true });
  }, [libraryItems, navigate]);
  const saveEditionRead = useCallback(async (date: string, read: boolean, version?: string) => {
    const sequence = ++historySequenceRef.current;
    setHistorySaving(date);
    try {
      const result = await request<{ days: HistoryDay[] }>("/api/history", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, read, ...(version ? { version } : {}) }) });
      if (sequence === historySequenceRef.current) setHistory(result.days);
    } catch (err) { notify(err instanceof Error ? err.message : "简报阅读状态未保存，请重试"); }
    finally { if (sequence === historySequenceRef.current) setHistorySaving(""); }
  }, [notify]);
  useEffect(() => registerNavigator(handleOpenNote), [handleOpenNote, registerNavigator]);
  useEffect(() => {
    if (!navigationReady || !catalogReady || loadedEditionRef.current === historyDate) return;
    void loadFeed(historyDate).then(data => { if (data && historyDate) void saveEditionRead(historyDate, true, data.meta.updatedAt); });
  }, [catalogReady, historyDate, loadFeed, navigationReady, saveEditionRead]);
  useEffect(() => {
    if (!navigationReady || !catalogReady || loading) return;
    if (!routeLocation.item) { restoreScroll(); return; }
    if (loadedEditionRef.current !== historyDate) return;
    const found = (historyDate ? feed?.items || [] : libraryItems).find(item => item.id === routeLocation.item);
    if (found) { restoreScroll(); }
    else if (!error) {
      let active = true;
      void Promise.resolve().then(() => { if (active) { notify(historyDate ? "该期简报没有这条资料，已保留当前历史日期。" : "这条资料不存在或已不可用，已返回资料列表。"); navigate({ item: "", annotation: "" }, { replace: true }); } });
      return () => { active = false; };
    }
  }, [catalogReady, error, feed, historyDate, libraryItems, loading, navigate, navigationReady, restoreScroll, notify, routeLocation]);
  async function undoInterest() {
    const token = interest.getUndoToken();
    const done = await interest.undo();
    if (done && token) gridRef.current?.undo(token);
  }
  function openEdition(date: string) { navigate({ view: "history", date, item: "", annotation: "" }); }

  async function toggleFavorite(item: IntelItem) {
    if (mutationLockRef.current || !interest.feedbackReady) return;
    mutationLockRef.current = true; setSaving(item.id);
    try {
      if (savedIds.has(item.id)) { await request(`/api/favorites?itemId=${encodeURIComponent(item.id)}`, { method: "DELETE" }); setFavorites(prev => prev.filter(f => f.itemId !== item.id)); notify("已取消收藏"); }
      else { const data = await request<{ favorite: SavedItem }>("/api/favorites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, collection: "灵感收藏", note: "" }) }); setFavorites(prev => [...prev.filter(f => f.itemId !== item.id), data.favorite]); notify("已加入收藏，可在详情或我的收藏中调整分类"); }
      await interest.loadRecommendations();
    } catch (err) { notify(err instanceof Error ? err.message : "收藏失败，请重试"); }
    finally { mutationLockRef.current = false; setSaving(null); }
  }
  async function saveCollection(target: CollectionTarget, collection: string) {
    if (mutationLockRef.current) throw new Error("其他操作正在保存，请稍后重试");
    mutationLockRef.current = true; setSaving(target.itemId);
    try {
      const data = await request<{ favorite: SavedItem }>("/api/favorites", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: target.itemId, collection, expectedCollection: target.collection }) });
      setFavorites(previous => previous.map(favorite => favorite.itemId === target.itemId ? data.favorite : favorite));
      if (collectionFilter === target.collection) setCollectionFilter(data.favorite.collection);
      notify("收藏分类已更新"); void readingNotes.refresh();
    } catch (failure) {
      // 冲突时保留输入，并更新下次打开分类面板所用的状态。
      const latest = await request<{ favorites: SavedItem[] }>("/api/favorites").catch(() => null);
      if (latest) setFavorites(latest.favorites);
      throw failure;
    } finally { mutationLockRef.current = false; setSaving(null); }
  }
  async function refreshBrief() {
    if (mutationLockRef.current) return;
    if (historyDate) { navigate({ date: "", item: "", annotation: "" }); loadedEditionRef.current = ""; }
    mutationLockRef.current = true; setRefreshing("brief"); setRefreshErrorSource("brief"); setRefreshError("");
    const historySequence = ++historySequenceRef.current;
    const feedSequence = feedSequenceRef.current + 1;
    try {
      const result = await readBriefUpdates({ feed: () => loadFeed(), reading: reloadReading, interest: interest.reloadState, history: () => request<{ days: HistoryDay[] }>("/api/history") });
      if (feedSequence !== feedSequenceRef.current) return;
      if (result.history && historySequence === historySequenceRef.current) setHistory(result.history.days);
      if (result.failures.length) {
        const message = `检查未完成：${result.failures.join("；")}，请重试。`;
        setRefreshError(message); notify(message);
      } else if (result.feed) notify(briefCheckMessage(feed, result.feed, shanghaiDay()));
    } catch (err) { const message = err instanceof Error ? err.message : "检查失败，请稍后重试"; setRefreshError(message); notify(message); }
    finally { mutationLockRef.current = false; setRefreshing(null); }
  }
  async function refreshGithub() {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true; setRefreshing("github"); setRefreshErrorSource("github"); setRefreshError("");
    const startingSequence = feedSequenceRef.current;
    try {
      const result = await request<{ ok: boolean; checked: number; partial: boolean }>("/api/refresh", { method: "POST" });
      if (startingSequence !== feedSequenceRef.current) { notify(githubCheckMessage(result)); return; }
      // 只更新当前画面内的 Star 快照，不把此操作当作下一批产品或当日简报。
      const sequence = ++feedSequenceRef.current;
      const data = await request<FeedResponse>(`/api/feed${historyDate ? `?date=${historyDate}` : ""}`);
      if (sequence === feedSequenceRef.current) {
        setFeed(data);
        if (!historyDate) { setLibraryItems(data.items); setHomeFeatured(current => data.items.find(item => item.id === current?.id) || current); }
      }
      notify(githubCheckMessage(result));
    } catch (err) { const message = err instanceof Error ? err.message : "GitHub 数据核对失败，请稍后重试"; setRefreshError(message); notify(message); }
    finally { mutationLockRef.current = false; setRefreshing(null); }
  }
  async function savePreferences(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPrefsSaving(true);
    try { const result = await request<{ preferences: Preferences; schedule?:EmailScheduleView }>("/api/preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) }); setPrefs(result.preferences); setSavedPreferences(result.preferences); setSavedEmail(result.preferences.email); setEmailSchedule(result.schedule || null); notify(!result.preferences.emailEnabled ? "定时发送已关闭" : result.schedule?.status === "scheduled" ? `已设为每天 ${result.preferences.deliveryTime} 发送热点海报` : "偏好已保存，请核对下方定时任务状态"); await loadEmailStatus(); }
    catch (err) { notify(err instanceof Error ? err.message : "保存失败"); }
    finally { setPrefsSaving(false); }
  }
  async function sendEmail(kind: "test" | "daily" | "retry") {
    if (emailLockRef.current || prefsSaving) return;
    emailLockRef.current = true;
    setEmailBusy(kind); setEmailError("");
    try {
      const path = kind === "test" ? "/api/email/test" : kind === "retry" ? "/api/email/retry" : "/api/email/send";
      const payload = kind === "test" ? { requestId: testRequestRef.current ||= crypto.randomUUID() } : kind === "retry" ? { deliveryId: emailDelivery?.id } : {};
      const result = await request<{delivery:EmailDeliveryView;replayed:boolean}>(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      setEmailDelivery(result.delivery);
      if (kind === "test" && ["accepted", "failed"].includes(result.delivery.status)) testRequestRef.current = null;
      if (result.delivery.status === "accepted") notify(result.replayed ? "这封邮件此前已提交，未重复发送" : "发信服务已接收，请到收件箱查看");
      else if (result.delivery.status === "unknown") setEmailError("发送结果尚未确认，请先查收邮件；为避免重复投递，不能直接重发。");
      else if (result.delivery.status === "failed") setEmailError(result.delivery.errorMessage || "发送失败，可在下方重试这封邮件。");
    } catch (failure) { await loadEmailStatus(); setEmailError(failure instanceof Error ? failure.message : "请求未完成，请刷新投递状态后再判断"); }
    finally { emailLockRef.current = false; setEmailBusy(null); }
  }
  const emailRecipientChanged = prefs.email.trim() !== savedEmail.trim();
  const emailPreferencesChanged = Boolean(savedPreferences) && (emailRecipientChanged || prefs.deliveryTime !== savedPreferences?.deliveryTime || prefs.emailEnabled !== savedPreferences?.emailEnabled);
  const emailUnresolvedToday = emailDelivery?.editionDate === today && ["pending", "sending", "unknown"].includes(emailDelivery.status);
  const emailTestBlocked = emailUnresolvedToday && emailDelivery?.kind === "test";
  const emailDailyBlocked = emailDelivery?.editionDate === today && emailDelivery.kind === "daily" && ["sending", "unknown"].includes(emailDelivery.status);
  const emailStatusLabels: Record<EmailDeliveryView["status"],string> = {pending:"等待发送",sending:"正在提交发信服务",accepted:"发信服务已接收",failed:"发送失败",unknown:"发送结果待核对"};
  function exportFavorites() { const content = favorites.map(({ itemId, collection, createdAt, updatedAt }) => ({ itemId, collection, createdAt, updatedAt, notes: readingNotes.notes.filter(note => note.itemId === itemId), product: libraryItems.find(item => item.id === itemId) || null })); const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "拾光-我的收藏.json"; a.click(); URL.revokeObjectURL(url); notify("收藏文件已导出"); }
  const collectionButton = (item: IntelItem) => {
    const favorite = favorites.find(entry => entry.itemId === item.id);
    return favorite ? <button className="collection-trigger" aria-label={`修改 ${item.name} 的收藏分类`} title={`收藏分类：${favorite.collection}`} disabled={mutationBusy || !interest.feedbackReady} onClick={() => setCollectionTarget({ itemId: item.id, name: item.name, collection: favorite.collection })}><Folder size={15} /><span>{favorite.collection}</span><ChevronRight size={13} /></button> : null;
  };
  const bookmark = (item: IntelItem, className = "") => <button className={`bookmark-button ${savedIds.has(item.id) ? "is-saved" : ""} ${className}`} aria-label={savedIds.has(item.id) ? `取消收藏 ${item.name}` : `收藏 ${item.name}`} title={savedIds.has(item.id) ? "取消收藏" : "加入收藏"} disabled={mutationBusy || !interest.feedbackReady} onClick={(event) => { event.stopPropagation(); void toggleFavorite(item); }}>{saving === item.id ? <Loader2 size={17} className="spin" /> : <Bookmark size={17} fill={savedIds.has(item.id) ? "currentColor" : "none"} />}</button>;
  const dismissButton = (item: IntelItem, className = "") => <button className={`dismiss-button ${className}`} aria-label={`不感兴趣 ${item.name}`} title="不感兴趣，减少类似推荐" disabled={mutationBusy || !interest.feedbackReady} onClick={event => { event.stopPropagation(); void interest.submit(item, "not_interested").then(async done => { if (done) { await gridRef.current?.replaceDismissed(item.id, interest.getUndoToken()); if (selected?.id === item.id) closeDetail(); } }); }}><EyeOff size={15} /><span>不感兴趣</span></button>;
  const productCard = (item: IntelItem) => <article className="product-card" key={item.id}><button className="card-open" onClick={() => openItem(item)}><Visual item={item} /><div className="product-card-body"><div className="card-kicker"><span>{item.category}</span>{item.stars != null && <span className="star-count" title={`截至 ${item.starsCheckedAt || "采集时间"}`}><Star size={12} />{stars(item.stars)}</span>}</div><h3>{item.name}<ArrowUpRight size={16} /></h3><p>{item.title || item.summary}</p><div className="card-tags">{item.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}<span className="read-time">{item.readMinutes} 分钟</span></div></div></button>{bookmark(item, "card-bookmark")}{dismissButton(item, "card-dismiss")}</article>;
  const designCard = (item: IntelItem) => <article className="design-card" key={item.id}><button className="card-open" onClick={() => openItem(item)}><Visual item={item} /><div className="design-card-body"><div className="card-kicker"><span>{item.category}</span><span>{item.evidence}</span></div><h3>{item.name}<ArrowUpRight size={19} /></h3><p>{item.subtitle}</p><div className="card-tags">{item.tags.slice(0, 3).map(tag => <span key={tag}>{tag}</span>)}</div><ul className="design-highlights">{item.designNotes.slice(0, 3).map((note, index) => <li key={index}><span>0{index + 1}</span>{note}</li>)}</ul></div></button>{bookmark(item, "card-bookmark")}{dismissButton(item, "card-dismiss")}</article>;

  return <div className={`radar-app ${view === "recommendations" ? "recommendation-view" : ""}`}>
    {mobileNav && <button className="nav-backdrop" onClick={() => setMobileNav(false)} aria-label="关闭导航" />}
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`} aria-label="主导航"><Link className="brand" href="/" aria-label="拾光首页"><div className="brand-mark"><Radio size={24} strokeWidth={1.7} /></div><div><strong>拾光<span>SHIGUANG</span></strong><small>好产品，先看见。</small></div></Link><button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="关闭导航"><X size={20} /></button><div className="nav-label">探索 · DISCOVER</div><nav>{navigation.map(nav => <button key={nav.id} onClick={() => changeView(nav.id)} className={`nav-item ${view === nav.id ? "active" : ""}`}><nav.icon size={18} strokeWidth={1.7} /><span>{nav.label}</span>{nav.id === "saved" && <span className="nav-count">{favorites.length}</span>}{nav.id === "today" && <span className="active-dot" />}</button>)}<button className="nav-item" onClick={() => { setMobileNav(false); readingNotes.openNotebook(); }}><FileText size={18} strokeWidth={1.7} /><span>我的笔记</span></button></nav><div className="sidebar-note"><div className="sidebar-note-icon"><Lightbulb size={18} /></div><strong>把灵感，变成下一步。</strong><p>跨行业发现好产品，<br />从需求、商业与设计中找灵感。</p><button onClick={() => changeView("saved")}>打开我的收藏 <ArrowRight size={14} /></button></div><div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />偏好设置</button><div className="profile"><div className="avatar">P</div><div><strong>{feed?.user.name || "产品探索者"}</strong><span>个人情报工作台</span></div><span className="profile-dot" /></div></div></aside>
    <div className="workspace"><header className="topbar"><div className="topbar-location"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Menu size={21} /></button><span>我的工作台</span><ChevronRight size={13} /><strong>{viewNames[view]}</strong></div><div className="topbar-actions">{view !== "recommendations" && <div className="search"><Search size={16} /><input aria-label="搜索产品、行业、场景或风格" placeholder="搜索产品、行业、场景或风格…" value={query} onChange={event => setQuery(event.target.value)} /><span>⌕</span></div>}<button className="icon-button settings-top" aria-label="偏好设置" onClick={() => setSettings(true)}><Settings2 size={18} /></button><button className="top-avatar" onClick={() => setSettings(true)} aria-label="个人偏好">P</button></div></header>
    <main className="main-content"><div className="page-intro"><div><div className="eyebrow"><span />PRODUCT INTELLIGENCE, DAILY</div><h1>{view === "today" ? <>每一天，都有好发现<span>✦</span></> : viewNames[view]}</h1><p>{view === "today" ? "从软件到实体产品，发现各行各业值得借鉴的好产品。" : view === "recommendations" ? "感兴趣就留下，不感兴趣就划走；根据你的选择推荐下一条灵感。" : view === "products" ? "跨行业拆解产品，看懂需求与商业价值。" : view === "frontier" ? "按主题、日期和阅读状态，回看 AI、科技与产品的变化。" : view === "design" ? "从界面、交互到产品形态，积累可借鉴的设计灵感。" : view === "saved" ? "把值得再看的产品与灵感，收进自己的知识地图。" : "每一份发现，都值得在未来被重新遇见。"}</p></div><div className="intro-actions"><div className="feed-date-summary" aria-label="简报日期与更新状态"><span className="date-label"><CalendarDays size={15} />今天 {today ? day(today) : "正在核对"}</span><span>最新简报 {latest.date ? day(latest.date) : "暂无"}</span><span className={`feed-freshness ${availability === "current" ? "is-current" : "is-pending"}`} role="status">{!feed ? "正在读取简报" : availability === "current" ? feed.meta.freshness?.latestEditionStatus === "partial" ? "今日简报部分来源更新" : "今日简报已更新" : availability === "pending" ? "今日简报尚未产出" : availability === "future" ? "简报日期待核对" : "暂无简报"}</span>{view === "history" && historyDate && <span className="viewing-edition">当前查看 {day(historyDate)}</span>}</div><div className="feed-refresh-actions"><button className="button secondary refresh-button" disabled={mutationBusy || loading} onClick={() => void refreshBrief()}><RefreshCw size={14} className={refreshing === "brief" ? "spin" : ""} />{refreshing === "brief" ? "正在检查" : "检查新简报"}</button><details className="update-more"><summary className="button secondary">更多 <ChevronRight size={14} /></summary><div className="update-more-menu"><button className="button secondary refresh-button github-refresh" disabled={mutationBusy || loading} title={feed?.meta.freshness?.lastStarsCheckedAt ? `上次核对：${day(feed.meta.freshness.lastStarsCheckedAt)} ${time(feed.meta.freshness.lastStarsCheckedAt)}；只核对仓库 Star` : "只核对仓库 Star，新简报由每日采集任务产出"} onClick={() => void refreshGithub()}><Github size={14} className={refreshing === "github" ? "spin" : ""} />{refreshing === "github" ? "正在核对" : "核对 GitHub 数据"}</button><button onClick={() => setSettings(true)}><Settings2 size={14} />偏好设置</button></div></details></div></div></div>
    {view !== "recommendations" && <div className="mobile-search search"><Search size={16} /><input aria-label="手机搜索" placeholder="搜索产品、行业、场景或风格…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button onClick={() => setQuery("")} aria-label="清空搜索"><X size={15} /></button>}</div>}
    {view !== "recommendations" && <div className="brief-strip"><div className="brief-strip-left"><span className="live-dot" /><strong>{historyDate ? `${day(historyDate)}简报` : "本期简报"}</strong><span className="strip-separator" /><span>{feed ? `${historyDate ? feed.items.length : (feed.meta.editionItemIds?.length ?? feed.meta.total)} 条精选` : "正在读取"}</span><span className="desktop-only">·</span><span className="desktop-only">{feed?.meta.sourceCount || 0} 个信息来源</span></div><button onClick={() => setSettings(true)}><Mail size={14} /><span>{emailSchedule?.status === "scheduled" ? `每天 ${emailSchedule.deliveryTime} 热点海报` : emailConfigured ? "邮件简报" : "偏好设置"}</span><ArrowUpRight size={13} /></button></div>}
    {refreshError && <div className="inline-warning preference-warning" role="alert"><span>{refreshError}</span><button disabled={mutationBusy || loading} onClick={() => void (refreshErrorSource === "github" ? refreshGithub() : refreshBrief())}>{refreshErrorSource === "github" ? "重新核对 GitHub" : "重新检查简报"}</button></div>}
    {readingError && <div className="inline-warning preference-warning" role="alert"><span>阅读记录尚未同步：{readingError}</span><button onClick={() => void reloadReading()}>重试保存与读取</button></div>}
    {interest.feedbackError && <div className="inline-warning preference-warning" role="alert"><span>阅读状态暂时无法核对：{interest.feedbackError}</span><button onClick={() => void interest.reconcile()} disabled={mutationBusy}>重试</button></div>}
    {view === "today" && <div className="home-action-links"><button className="text-link" onClick={() => changeView("recommendations")}><Sparkles size={14} />按兴趣继续发现 <ArrowRight size={14} /></button></div>}
    {view !== "recommendations" && <div className="reading-feedback-toolbar"><span>{dismissedIds.size ? `已按偏好收起 ${dismissedIds.size} 条内容` : "你的选择会帮助调整后续推荐"}</span><div>{interest.undoToken && <button disabled={mutationBusy} onClick={() => void undoInterest()}><RotateCcw size={13} />撤销上一次</button>}<button onClick={() => setDismissedOpen(true)}><EyeOff size={13} />已划走</button></div></div>}
    {view === "recommendations" && <RecommendationsPanel data={interest.recommendations} loading={interest.loading} error={interest.error} disabled={mutationBusy || !interest.feedbackReady} undoToken={interest.undoToken} onFeedback={interest.submit} onOpen={openItem} onUndo={undoInterest} retryDisabled={mutationBusy} onRetry={interest.reconcile} onManage={() => setDismissedOpen(true)} onSaved={() => changeView("saved")} />}
    {view !== "recommendations" && <>
    {libraryView && <LibraryToolbar location={routeLocation} categories={categories} count={visible.length} readReady={readingReady} onChange={changeLibraryFilter} />}
    {view === "history" && <section className="history-section"><div className="section-heading"><div><span className="section-mark"><CalendarDays size={16} /></span><h2>简报档案</h2></div><span className="muted">按日期查看 · 已读表示已打开该期</span></div><div className="history-days">{history.length ? history.map(record => <div className={`history-day ${historyDate === record.date ? "chosen" : ""}`} key={record.date}><button className="history-day-open" onClick={() => void openEdition(record.date)} aria-current={historyDate === record.date ? "date" : undefined}><CalendarDays size={19} /><strong>{record.date}</strong><span>{record.count} 条内容</span><span className={`reading-badge ${record.hasUpdates ? "has-updates" : record.readAt ? "is-read" : "is-unread"}`}>{record.hasUpdates ? <RefreshCw size={12} /> : record.readAt ? <Check size={12} /> : <i />}{record.hasUpdates ? "有更新" : record.readAt ? "已读" : "未读"}</span></button>{record.readAt && <button className="history-mark-unread" title="标为未读" aria-label={`将 ${record.date} 简报标为未读`} disabled={historySaving === record.date} onClick={() => void saveEditionRead(record.date, false)}>{historySaving === record.date ? <Loader2 size={13} className="spin" /> : <RotateCcw size={13} />}</button>}</div>) : <p className="muted">第一份简报将在本次更新后归档。</p>}</div></section>}
    {view === "saved" && <div className="collection-toolbar"><div className="collection-tabs">{["全部收藏", ...collectionNames].map(name => <button key={name} onClick={() => setCollectionFilter(name)} className={collectionFilter === name ? "selected" : ""}>{name}</button>)}</div><button className="button secondary" onClick={exportFavorites} disabled={!favorites.length || readingNotes.loading || Boolean(readingNotes.error)}><ArrowDownToLine size={14} />导出收藏</button></div>}
    {loading || !navigationReady ? <div className="loading-grid" aria-label="正在加载简报"><div className="skeleton skeleton-feature" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div> : error ? <div className="empty-state"><CircleHelp size={34} /><h2>资讯暂时没有加载出来</h2><p>{error}</p><button className="button primary" onClick={() => void loadFeed(historyDate)}>重新加载</button></div> : unresolvedReading ? <div className="empty-state"><CircleHelp size={30} /><h2>阅读状态尚未核对</h2><p>{readingError || "正在读取阅读记录，暂不判断资料是否已读。"}</p><button className="button secondary" onClick={() => void reloadReading()}>重新核对阅读记录</button></div> : !hasVisibleContent ? <div className="empty-state">{view === "saved" ? <Bookmark size={34} /> : <Search size={34} />}<h2>{query ? "还没有找到匹配的内容" : view === "saved" ? "给下一个好想法留个位置" : "暂时没有待展示的内容"}</h2><p>{query ? "试试产品名称、行业、业务场景或设计风格。" : view === "saved" ? "点击卡片上的收藏图标，就能把喜欢的内容保存在这里。" : "可以到为你推荐继续探索，也可以在已划走中恢复内容。"}</p><button className="button primary" onClick={() => libraryView ? changeLibraryFilter({ query: "", category: "", read: "all", topic: "all", range: "all", sort: "recent" }) : query ? setQuery("") : view === "saved" ? changeView("today") : changeView("recommendations")}>{libraryView ? "重置筛选" : query ? "清空搜索" : view === "saved" ? "去发现好产品" : "去刷灵感"}<ArrowRight size={15} /></button></div> : <>
    {(view === "today" || view === "history" && featured) && !query && <section className="featured-section"><div className="section-heading"><div><span className="section-mark"><Compass size={16} /></span><h2>{view === "history" ? "本期产品解读" : "先看懂一个产品"}</h2><span className="section-description">它是什么 · 为什么有人需要 · 有什么价值</span></div><button className="text-link" onClick={() => changeView("products")}>全部拆解 <ArrowRight size={14} /></button></div>{featured ? <article className="featured-card" data-item-id={featured.id}><button className="featured-image" onClick={() => openItem(featured)}><Visual item={featured} large /></button><div className="featured-body"><div className="featured-top"><span className="pill green"><span />{libraryFeatured ? "资料库精选" : "本期重点"} · PRODUCT PICK</span><div className="featured-feedback">{dismissButton(featured)}{bookmark(featured)}</div></div>{libraryFeatured && <p className="featured-origin">收录于 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }).format(new Date(featured.discoveredAt))} · 来自已收集资料</p>}<div className="featured-name">{featured.name}<span>{featured.category}</span></div><button className="featured-title" onClick={() => openItem(featured)}><h2>{featured.title}</h2></button><p>{featured.summary}</p><div className="featured-insight"><Lightbulb size={17} /><span><strong>产品价值</strong>{featured.differentiation}</span></div><div className="featured-footer"><span>{featured.github ? <Github size={15} /> : <Compass size={15} />}{featured.stars != null ? `${stars(featured.stars)} Stars` : featured.evidence}<span className="footer-dot">·</span><Clock3 size={13} />{featured.readMinutes} 分钟</span><button onClick={() => openItem(featured)}>阅读拆解 <ArrowUpRight size={17} /></button></div></div></article> : <div className="featured-placeholder" role="status">{featuredStateError ? <><CircleHelp size={28} /><h3>暂时无法核对产品阅读状态</h3><p>请重新读取阅读、收藏与偏好，再为你选择下一款产品。</p><button className="button secondary" disabled={mutationBusy} onClick={() => void refreshBrief()}>重新核对</button></> : !homeFeaturedReady || !readingReady || !interest.feedbackReady ? <><Loader2 size={26} className="spin" /><h3>正在准备产品解读</h3><p>正在核对本期内容与阅读记录。</p></> : <><Compass size={28} /><h3>暂时没有新的产品解读</h3><p>本期与资料库中的产品已看完、已收藏或已划走，新的采集完成后会继续补充。</p><button className="button secondary" onClick={() => changeView("products")}>查看全部产品 <ArrowRight size={14} /></button></>}</div>}</section>}
    {view === "saved" ? <section className="saved-grid">{visible.map(item => <div key={item.id}>{item.kind === "design" ? designCard(item) : productCard(item)}<div className="saved-item-tools">{collectionButton(item)}<button className="saved-notes-trigger" onClick={() => readingNotes.openNotebook(item)}><BookOpen size={14} />笔记{readingNotes.notes.some(note => note.itemId === item.id) ? ` (${readingNotes.notes.filter(note => note.itemId === item.id).length})` : ""}</button></div></div>)}</section> : <>
    {view === "today" && !query && <><FrontierNews libraryItems={libraryItems} readIds={readIds} savedIds={savedIds} dismissedIds={dismissedIds} disabled={mutationBusy || !interest.feedbackReady} refreshKey={feedVersion} onAll={() => changeView("frontier")} onOpen={openItem} onReadSource={item => void markRead(item.id)} onFeedback={interest.submit} /><DiscoveryGrid ref={gridRef} refreshKey={feedVersion} catalogItems={libraryItems} excludedId={featured?.id} blockedIds={gridBlockedIds} savedIds={savedIds} disabled={mutationBusy || !interest.feedbackReady} ready={readingReady && interest.feedbackReady && homeFeaturedReady} onOpen={openItem} onFeedback={interest.submit} getUndoToken={interest.getUndoToken} onUndo={undoInterest} renderVisual={item => <Visual item={item} />} onLibrary={() => changeView("products")} /></>}
    {productList.length > 0 && view !== "design" && (view !== "today" || query) && <section className="content-section"><div className="section-heading"><div><span className="section-mark"><LayoutGrid size={16} /></span><h2>{query ? "搜索结果 · 产品" : view === "products" ? "全部产品发现" : "本期产品"}</h2><span className="section-description">软件、硬件与消费产品 · 看懂需求与价值</span></div><span className="section-counter">{productList.length} 个产品</span></div><div className="product-grid">{productList.map(productCard)}</div></section>}
    {designs.length > 0 && <section className="content-section"><div className="section-heading"><div><span className="section-mark orange"><Sparkles size={16} /></span><h2>让灵感发生</h2><span className="section-description">好看的背后，有值得学习的设计</span></div>{view !== "design" && <button className="text-link" onClick={() => changeView("design")}>更多灵感 <ArrowRight size={14} /></button>}</div><div className="design-grid">{designs.map(designCard)}</div></section>}
    {aiItems.length > 0 && (view !== "today" || query) && view !== "design" && view !== "products" && <section className="content-section"><div className="section-heading"><div><span className="section-mark purple"><Sparkles size={16} /></span><h2>{view === "history" ? "本期前沿动态" : "前沿资讯资料"}</h2><span className="section-description">只关心会影响产品的变化</span></div><span className="muted small">{aiItems.length} 条动态</span></div><div className="ai-list">{aiItems.map(item => <article className="ai-card" key={item.id}><div className="ai-brand" style={{ background: item.accent }}>{item.name.slice(0, 1)}</div><button className="ai-content" onClick={() => openItem(item)}><div className="card-kicker"><span>{item.name}</span><span>{item.evidence}</span>{item.publishedAt && <span>{day(item.publishedAt)} 发布</span>}</div><h3>{item.title}</h3><p>{item.summary}</p><span className="ai-action">产品机会 <ArrowRight size={13} /></span></button><div className="ai-feedback">{bookmark(item)}{dismissButton(item)}</div></article>)}</div></section>}
    </>}
    </>}
    </>}
    <footer className="page-footer"><div><Radio size={15} /><span>拾光</span><span className="footer-dot">·</span><span>让每一次发现，都有下一步</span></div><span>{feed?.meta.scheduleStatus ? `${feed.meta.scheduleStatus} · ` : ""}{feed?.meta.updatedAt ? `资料更新于 ${day(feed.meta.updatedAt)} ${time(feed.meta.updatedAt)}` : "资料来自公开来源"}<span className="footer-dot">·</span>商业判断为分析推断</span></footer>
    </main></div>
    <dialog className="detail-dialog" ref={detailRef} aria-labelledby="detail-heading" onCancel={event => { if (event.target === event.currentTarget) { event.preventDefault(); closeDetail(); } }} onClick={event => { if (event.target === event.currentTarget) closeDetail(); }}>{selected && <div className="dialog-inner" key={selected.id}>
      <div className="dialog-top"><span><span className="live-dot" />{selected.kind === "design" ? "设计灵感" : (selected.kind === "ai" || selected.kind === "news") ? "前沿动态" : "产品解读"}</span><button className="icon-button" onClick={closeDetail} aria-label="关闭详情"><X size={22} /></button></div>
      <div className="detail-scroll"><ReadingAnnotations key={`${selected.id}:${selectedSourceDate || "live"}`} item={selected} sourceDate={selectedSourceDate} focusNoteId={routeLocation.annotation || undefined}>
        <div className="card-kicker"><span>{selected.category}</span><span>{selected.evidence}</span>{selected.stars != null && <span><Star size={12} />{stars(selected.stars)} Stars</span>}</div>
        <h2>{selected.name}</h2><h3 className="detail-title" id="detail-heading"><AnnotatedText blockId="title" text={selected.title} /></h3>
        <p className="detail-summary"><AnnotatedText blockId="summary" text={selected.summary} /></p>
        <div className="detail-links"><a className="button primary" href={selected.website} target="_blank" rel="noopener noreferrer">{selected.kind === "product" ? "了解 / 体验产品" : "查看官方介绍"} <ArrowUpRight size={15} /></a>{selected.github && <a className="button secondary" href={selected.github} target="_blank" rel="noopener noreferrer"><Github size={15} />GitHub</a>}{dismissButton(selected)}{bookmark(selected)}{collectionButton(selected)}</div>
        <ImageGallery item={selected} />
        <div className="detail-reading">
          <section className="analysis-section"><h4><span>01</span>{selected.kind === "product" ? "谁会用它" : "这与谁有关"}</h4><p><AnnotatedText blockId="audience" text={selected.audience} /></p></section>
          <section className="analysis-section"><h4><span>02</span>{selected.kind === "design" ? "设计背景与要解决的问题" : "为什么会有这个需求"}</h4><p><AnnotatedText blockId="pain" text={selected.pain} /></p></section>
          {selected.scenario && <section className="scenario-section"><h4><Lightbulb size={17} />用一个例子看懂</h4><p><AnnotatedText blockId="scenario" text={selected.scenario} /></p></section>}
          <section className="analysis-section workflow-section"><h4><span>03</span>{selected.kind === "product" ? "实际怎么使用" : selected.kind === "design" ? "交互是怎么组织的" : "它如何发挥作用"}</h4>{selected.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean).length > 1 ? <ol className="workflow-steps">{selected.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean).map((step, index) => <li key={index}><span>{index + 1}</span><p><AnnotatedText blockId={`workflow.${index}`} text={step} /></p></li>)}</ol> : <p><AnnotatedText blockId="workflow.0" text={selected.workflow.split(/\s*(?:→|⟶|->)\s*/).filter(Boolean)[0] || selected.workflow} /></p>}</section>
          <section className="value-section"><h4><Check size={17} />{selected.kind === "design" ? "这个设计带来的价值" : (selected.kind === "ai" || selected.kind === "news") ? "这次变化带来的价值" : "它给用户带来什么价值"}</h4><p><AnnotatedText blockId="differentiation" text={selected.differentiation} /></p></section>
          {selected.caveats[0] && <p className="usage-note"><CircleHelp size={15} /><span><strong>使用前了解：</strong><AnnotatedText blockId="caveatIntro" text={selected.caveats[0]} /></span></p>}
          <div className="business-sections"><section className="analysis-section"><h4><span>04</span>{selected.kind === "product" ? "怎么收费，用户为什么付费" : "商业与使用条件"}</h4><p><AnnotatedText blockId="businessModel" text={selected.businessModel} /></p></section><section className="analysis-section"><h4><span>05</span>我们可以借鉴什么</h4><p><AnnotatedText blockId="opportunity" text={selected.opportunity} /></p></section></div>
          {selected.designNotes.length > 0 && <section className="analysis-section"><h4><span><Sparkles size={15} /></span>值得借鉴的设计</h4><ul>{selected.designNotes.map((text, index) => <li key={index}><AnnotatedText blockId={`designNotes.${index}`} text={text} /></li>)}</ul></section>}
        </div>
        <details className="evidence-details"><summary><span><FileText size={16} />数据与来源</span><span>核对事实、日期与使用条件<ChevronRight size={16} /></span></summary><div className="evidence-content">
          <div className="detail-facts"><h4><Check size={16} />已核对的公开资料</h4><ul>{selected.facts.map((fact, index) => <li key={index}><AnnotatedText blockId={`facts.${index}`} text={fact} /></li>)}</ul></div>
          <section className="caveats"><h4>使用条件与待验证信息</h4><ul>{selected.caveats.map((text, index) => <li key={index}><AnnotatedText blockId={`caveats.${index}`} text={text} /></li>)}</ul><p>{selected.publishedAt ? `发布于 ${day(selected.publishedAt)} · ` : ""}收录于 {day(selected.discoveredAt)}{selected.starsCheckedAt ? ` · Star 核对于 ${day(selected.starsCheckedAt)}` : ""}；高关注度与市场表现分别核对，商业机会属于分析推断。</p></section>
          <section className="sources-section"><h4>原始资料</h4>{selected.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer"><span>{source.label}<small>{source.url}</small></span><ExternalLink size={15} /></a>)}</section>
        </div></details>
      </ReadingAnnotations></div></div>}</dialog>
    {collectionTarget && <CollectionEditor key={collectionTarget.itemId} target={collectionTarget} names={collectionNames} disabled={mutationBusy} onSave={saveCollection} onClose={() => setCollectionTarget(null)} />}
    <DismissedItemsDialog open={dismissedOpen} feedback={interest.feedback} items={libraryItems} disabled={mutationBusy} onClose={() => setDismissedOpen(false)} onRestore={interest.restore} onOpen={openLibraryItem} />
    <dialog className="settings-dialog" ref={settingsRef} aria-labelledby="settings-heading" onCancel={() => setSettings(false)} onClick={event => { if (event.target === event.currentTarget) setSettings(false); }}>
      <div className="dialog-inner">
        <div className="dialog-top"><span><Settings2 size={17} />偏好设置</span><button className="icon-button" aria-label="关闭设置" onClick={() => setSettings(false)}><X size={21} /></button></div>
        <form className="settings-form" onSubmit={event => void savePreferences(event)}>
          <div className="settings-title-row"><div className="settings-icon"><Mail size={24} /></div><div><h2 id="settings-heading">热点海报邮件</h2><p>一封邮件，一张海报，手机直接查看。</p></div></div>
          <label>接收邮箱<input type="email" value={prefs.email} placeholder="your@email.com" disabled={emailBusy !== null || prefsSaving} onChange={event => setPrefs({ ...prefs, email: event.target.value })} required /></label>
          <div className="email-switch">
            <div><label htmlFor="email-auto-switch">定时发送</label><p>{prefs.emailEnabled ? "每天一封；关闭后停止自动发送" : "已选择关闭，不再自动发送"}</p></div>
            <input id="email-auto-switch" className="email-toggle" type="checkbox" role="switch" aria-label="定时发送" disabled={!savedPreferences || emailBusy !== null || prefsSaving || (!deliveryReady && !prefs.emailEnabled)} checked={prefs.emailEnabled} onChange={event => setPrefs({ ...prefs, emailEnabled: event.target.checked })} />
          </div>
          <div className="email-time-row"><div><strong>每天发送时间</strong><span>北京时间 · UTC+8</span></div><label className="email-time-input"><span className="sr-only">每天发送时间（北京时间）</span><input type="time" step="60" value={prefs.deliveryTime} disabled={!savedPreferences || emailBusy !== null || prefsSaving} onChange={event => setPrefs({ ...prefs, deliveryTime: event.target.value })} required /></label></div>
          <p className="email-schedule-help">到点后发送当天完整简报；内容晚到时当日补发，同一天不重复。</p>
          <div className={`email-schedule-state is-${emailSchedule?.status || "loading"}`} role="status">
            <Clock3 size={15} /><div><strong>{emailLoading ? "正在核对定时任务" : emailSchedule?.status === "paused" ? "自动发送已关闭" : emailSchedule?.status === "scheduled" ? "定时任务已开启" : emailSchedule?.status === "starting" ? "正在安排定时任务" : emailSchedule?.status === "waiting" ? "等待当天完整简报" : emailSchedule?.status === "error" ? "定时任务需要重试" : "定时任务尚未确认"}</strong>
            {emailSchedule?.nextRunAt && <p>下次：{day(emailSchedule.nextRunAt)} {time(emailSchedule.nextRunAt)}（北京时间）</p>}
            {emailSchedule?.errorMessage && <p>{emailSchedule.errorMessage}</p>}
            {emailSchedule?.status === "paused" && <p>可随时开启；手动发送仍由你决定。</p>}
            {!deliveryReady && <p>{deliveryReason}</p>}
          </div></div>
          <button className="button primary" type="submit" disabled={!savedPreferences || prefsSaving || emailBusy !== null}>{prefsSaving ? <Loader2 size={16} className="spin" /> : <Check size={16} />}{emailSchedule?.status === "error" && !emailPreferencesChanged ? "重试定时任务" : "保存设置"}</button>
          {emailPreferencesChanged && <p className="email-unsaved" role="status">有未保存的修改，点击保存后生效。</p>}
        </form>
        <section className="email-delivery-panel" aria-label="邮件投递">
          <div className="email-preview-row"><span>邮件只含内嵌海报，无需加载外部图片</span><a className="text-link" href="/api/email/poster" target="_blank" rel="noopener noreferrer">预览今日海报<ArrowUpRight size={13} /></a></div>
          <div className="email-delivery-actions">
            <button className="button secondary" disabled={!deliveryReady || !savedEmail || emailRecipientChanged || emailBusy !== null || prefsSaving || Boolean(emailTestBlocked)} onClick={() => void sendEmail("test")}>{emailBusy === "test" ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}发送测试海报</button>
            <button className="button secondary" disabled={!deliveryReady || !savedEmail || emailRecipientChanged || emailBusy !== null || prefsSaving || Boolean(emailDailyBlocked)} onClick={() => void sendEmail("daily")}>{emailBusy === "daily" ? <Loader2 size={14} className="spin" /> : <Mail size={14} />}立即发送今日海报</button>
          </div>
          {emailRecipientChanged && <p className="small muted">请先保存接收邮箱，再发送邮件。</p>}
          <div className="email-delivery-heading"><strong>最近投递</strong><button className="text-link" disabled={emailLoading || emailBusy !== null} onClick={() => void loadEmailStatus()}>{emailLoading ? "正在读取" : "刷新状态"}</button></div>
          {emailDelivery ? <div className={`email-delivery-record is-${emailDelivery.status}`} role="status"><strong>{emailStatusLabels[emailDelivery.status]}</strong><p>{emailDelivery.kind === "test" ? "测试邮件" : `${emailDelivery.editionDate} 简报`} · {emailDelivery.recipient}</p><p>{day(emailDelivery.updatedAt)} {time(emailDelivery.updatedAt)}</p>{emailDelivery.errorMessage && <p>{emailDelivery.errorMessage}</p>}{emailDelivery.status === "unknown" && <p>请先查收邮件，当前结果未确认，不自动重发。</p>}{emailDelivery.canRetry && emailDelivery.status === "failed" && <button className="button secondary" disabled={emailBusy !== null || !deliveryReady} onClick={() => void sendEmail("retry")}>重试这封邮件</button>}</div> : !emailLoading && <p className="small muted">还没有投递记录。</p>}
          {emailError && <p className="inline-warning" role="alert">{emailError}</p>}
        </section>
      </div>
    </dialog>
    {toast && <div className="toast" popover="manual" ref={toastRef} role="status"><Check size={17} />{toast}<button onClick={() => setToast("")} aria-label="关闭提示"><X size={15} /></button></div>}
  </div>;
}
