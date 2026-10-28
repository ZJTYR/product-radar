import type { IntelItem } from './types.ts';

export const FRONTIER_LIMIT = 6;
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

export function recentFrontierItems(items: IntelItem[], at: number) {
  // 最近七个北京时间自然日；不能把未来发布或刚收录的旧新闻当作近期变化。
  const todayStart = Math.floor((at + 8 * 3_600_000) / DAY) * DAY - 8 * 3_600_000;
  return [...new Map(items.map(item => [item.id, item])).values()]
    .filter(item => {
      const time = frontierEventTime(item);
      return frontierTopic(item) !== null && Number.isFinite(time) && time >= todayStart - 6 * DAY && time <= at;
    })
    .sort((a, b) => frontierEventTime(b) - frontierEventTime(a) || a.id.localeCompare(b.id));
}

export function selectFrontierItems(items: IntelItem[], at: number, readIds: Set<string>, blockedIds: Set<string>, limit = FRONTIER_LIMIT) {
  const candidates = recentFrontierItems(items, at).filter(item => !blockedIds.has(item.id));
  candidates.sort((a, b) => Number(readIds.has(a.id)) - Number(readIds.has(b.id))
    || topicOrder[frontierTopic(a)!] - topicOrder[frontierTopic(b)!]
    || frontierEventTime(b) - frontierEventTime(a) || a.id.localeCompare(b.id));
  return { items: candidates.slice(0, limit), remaining: candidates.length };
}
