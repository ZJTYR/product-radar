import type { FeedResponse, IntelItem } from './types.ts';
import { expandProductIds, productKeys } from './product-identity.ts';

export function shanghaiDay(value: Date | string | number = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export function selectHomeFeatured(items: IntelItem[], editionIds: string[] | undefined, readIds: ReadonlySet<string>, savedIds: ReadonlySet<string>, dismissedIds: ReadonlySet<string>, reservedIds: readonly string[] = []) {
  const excluded = expandProductIds(productKeys(items), [...readIds, ...reservedIds]);
  const candidates = items.filter(item => item.kind === 'product' && !excluded.has(item.id) && !savedIds.has(item.id) && !dismissedIds.has(item.id));
  const edition = candidates.filter(item => !editionIds || editionIds.includes(item.id));
  if (edition.length) return edition.find(item => item.featured) || edition[0];
  // Star 核对会改变资料库排序；补位按真实收录时间选择，避免把旧资料当作今日采集。
  return [...candidates].sort((left, right) => Date.parse(right.discoveredAt) - Date.parse(left.discoveredAt) || left.id.localeCompare(right.id))[0] || null;
}

export function resolveHomeFeatured(current: IntelItem | null, sameSession: boolean, items: IntelItem[], editionIds: string[] | undefined, readIds: ReadonlySet<string>, savedIds: ReadonlySet<string>, dismissedIds: ReadonlySet<string>, reservedIds?: readonly string[]) {
  if (sameSession && current && !dismissedIds.has(current.id)) return current;
  return selectHomeFeatured(items, editionIds, readIds, savedIds, dismissedIds, reservedIds);
}

export function editionAvailability(today: string, latestDate: string) {
  if (!latestDate) return 'missing';
  if (latestDate > today) return 'future';
  return latestDate === today ? 'current' : 'pending';
}

export function latestEdition(meta: FeedResponse['meta']) {
  return {
    date: meta.freshness?.latestEditionDate ?? meta.date,
    updatedAt: meta.freshness?.latestEditionUpdatedAt ?? meta.updatedAt,
  };
}

export function briefCheckMessage(previous: FeedResponse | null, current: FeedResponse, today = current.meta.freshness.today) {
  const next = latestEdition(current.meta);
  const before = previous ? latestEdition(previous.meta) : null;
  const changed = !before || next.date !== before.date || next.updatedAt !== before.updatedAt;
  const status = editionAvailability(today, next.date);
  if (status === 'missing') return '已检查，暂时还没有简报；每日采集完成后会显示在这里。';
  if (status === 'future') return '已读取简报，但最新简报日期需要核对。';
  if (status === 'pending') return `今日简报尚未产出，最新一期为 ${next.date}；已重新读取现有资料。`;
  if (current.meta.freshness.latestEditionStatus === 'partial') return changed ? `已读取 ${next.date} 简报，部分来源更新，其余来源仍待补充。` : `已检查，${next.date} 简报暂无新增内容，部分来源仍待补充。`;
  return changed ? `已读取 ${next.date} 的最新简报。` : `已检查，${next.date} 简报暂无新增内容。`;
}

interface BriefReaders<THistory> {
  feed: () => Promise<FeedResponse | null>;
  reading: () => Promise<boolean>;
  interest: () => Promise<boolean>;
  history: () => Promise<THistory>;
}

// 各接口独立返回结果；任何一次读取失败都不能被“暂无新增”的成功提示掩盖。
export async function readBriefUpdates<THistory>(readers: BriefReaders<THistory>) {
  const [feed, reading, interest, history] = await Promise.allSettled([readers.feed(), readers.reading(), readers.interest(), readers.history()]);
  const failures: string[] = [];
  if (feed.status === 'rejected' || !feed.value) failures.push('简报资料读取失败');
  if (reading.status === 'rejected' || !reading.value) failures.push('阅读记录尚未核对完成');
  if (interest.status === 'rejected' || !interest.value) failures.push('收藏、偏好与推荐尚未核对完成');
  if (history.status === 'rejected') failures.push('简报档案读取失败');
  return { feed: feed.status === 'fulfilled' ? feed.value : null, history: history.status === 'fulfilled' ? history.value : null, failures };
}

export function githubCheckMessage(result: { checked: number; partial: boolean }) {
  return result.partial ? `已核对 ${result.checked} 个 GitHub 仓库，部分来源暂不可用；简报日期不变。` : `已核对 ${result.checked} 个 GitHub 仓库的 Star；简报日期不变。`;
}
