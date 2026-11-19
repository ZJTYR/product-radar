import type { IntelItem } from './types.ts';

export const FRONTIER_LIMIT = 6;
export const FRONTIER_RECENT_DAYS = 7;
const DAY = 86_400_000;
const topicOrder = { ai: 0, technology: 1, product: 2 };
const applicationLabels = { agents: 'Agent 与工作流', knowledge: '知识与记忆', multimodal: '多模态交互', integration: '应用集成', engineering: '应用工程' };

export function frontierTopic(item: IntelItem): 'ai' | 'technology' | 'product' | null {
  if (item.kind === 'ai' && item.aiApplication) return 'ai';
  if (item.kind === 'news' && item.newsTopic) return item.newsTopic;
  return null;
}

export function frontierLabel(item: IntelItem) {
  if (item.kind === 'ai' && item.aiApplication) return `AI · ${applicationLabels[item.aiApplication]}`;
  return item.newsTopic === 'technology' ? '科技动态' : '产品热点';
}

export function frontierEventTime(item: IntelItem) {
  const value = item.publishedAt || item.discoveredAt;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+08:00` : value);
}

export function isRecentFrontierItem(item: IntelItem, at: number) {
  const todayStart = Math.floor((at + 8 * 3_600_000) / DAY) * DAY - 8 * 3_600_000;
  const time = frontierEventTime(item);
  return Number.isFinite(time) && time >= todayStart - (FRONTIER_RECENT_DAYS - 1) * DAY && time <= at;
}

export function frontierItems(items: IntelItem[], at: number) {
  // 发布日期只决定优先级；保留往期候选，仍排除未来事件与无效日期。
  return [...new Map(items.map(item => [item.id, item])).values()]
    .filter(item => {
      const time = frontierEventTime(item);
      return frontierTopic(item) !== null && Number.isFinite(time) && time <= at;
    })
    .sort((a, b) => frontierEventTime(b) - frontierEventTime(a) || a.id.localeCompare(b.id));
}

export function recentFrontierItems(items: IntelItem[], at: number) {
  return frontierItems(items, at).filter(item => isRecentFrontierItem(item, at));
}

export function selectFrontierItems(items: IntelItem[], at: number, readIds: ReadonlySet<string>, blockedIds: ReadonlySet<string>, limit = FRONTIER_LIMIT) {
  const candidates = frontierItems(items, at).filter(item => !blockedIds.has(item.id));
  candidates.sort((a, b) => Number(readIds.has(a.id)) - Number(readIds.has(b.id))
    || Number(isRecentFrontierItem(b, at)) - Number(isRecentFrontierItem(a, at))
    || topicOrder[frontierTopic(a)!] - topicOrder[frontierTopic(b)!]
    || frontierEventTime(b) - frontierEventTime(a) || a.id.localeCompare(b.id));
  return { items: candidates.slice(0, limit), remaining: candidates.length };
}

export function fillConfirmedFrontierSlots(
  slots: (IntelItem | null)[], items: IntelItem[], at: number,
  readIds: ReadonlySet<string>, confirmedIds: ReadonlySet<string>, dismissedIds: ReadonlySet<string>,
) {
  const isConfirmed = (item: IntelItem | null) => item !== null && confirmedIds.has(item.id);
  const removedCount = slots.filter(isConfirmed).length;
  if (!removedCount) return slots;
  const reserved = new Set([...confirmedIds, ...dismissedIds, ...slots.flatMap(item => item ? [item.id] : [])]);
  const candidates = selectFrontierItems(items, at, readIds, reserved, removedCount).items;
  return slots.map(item => isConfirmed(item) ? candidates.shift() ?? null : item);
}
