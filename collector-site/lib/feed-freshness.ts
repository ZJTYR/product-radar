import type { FeedResponse } from './types.ts';

export type EditionRecord = { date: string; payload: string; updated_at: string; status: string };

export function shanghaiDay(value: Date | string | number = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export async function readFeedMetadata(db: Pick<D1Database, 'prepare'>, requestedDate?: string | null, checkedAt = new Date().toISOString()) {
  const latest = await db.prepare('SELECT * FROM editions ORDER BY date DESC LIMIT 1').first<EditionRecord>();
  const edition = requestedDate ? await db.prepare('SELECT * FROM editions WHERE date=?').bind(requestedDate).first<EditionRecord>() : latest;
  const stars = await db.prepare("SELECT status,created_at FROM runs WHERE kind='github_stars' ORDER BY created_at DESC LIMIT 1").first<{ status: string; created_at: string }>();
  return {
    edition,
    // 仓库关注度核对与简报采集分别记录，不能用最新一次 Star 操作冒充内容更新。
    lastRunStatus: ({ complete: '简报更新完成', partial: '简报部分来源更新', curated: '人工精选核验' } as Record<string, string>)[latest?.status || ''] || '尚无简报',
    freshness: {
      today: shanghaiDay(checkedAt), checkedAt, latestEditionDate: latest?.date || '', latestEditionUpdatedAt: latest?.updated_at || '', latestEditionStatus: latest?.status || '',
      lastStarsCheckedAt: stars?.created_at || '', lastStarsStatus: stars?.status || '',
    },
  };
}

export function latestEdition(meta: FeedResponse['meta']) {
  return { date: meta.freshness?.latestEditionDate ?? meta.date, updatedAt: meta.freshness?.latestEditionUpdatedAt ?? meta.updatedAt };
}

// 空字符串是最新资料库，日期字符串是历史快照；只有同一作用域读取失败时才可继续展示原内容。
export function feedScopeMatches(loadedScope: string | null, requestedScope: string) {
  return loadedScope !== null && loadedScope === requestedScope;
}

export function editionAvailability(today: string, latestDate: string) {
  if (!latestDate) return 'missing';
  if (latestDate > today) return 'future';
  return latestDate === today ? 'current' : 'pending';
}

export function briefCheckMessage(previous: FeedResponse | null, current: FeedResponse, today = current.meta.freshness.today, viewingDate = '') {
  const next = latestEdition(current.meta);
  const before = previous ? latestEdition(previous.meta) : null;
  const changed = !before || next.date !== before.date || next.updatedAt !== before.updatedAt;
  const status = editionAvailability(today, next.date);
  if (viewingDate) {
    const latestStatus = status === 'missing' ? '已检查，暂时还没有最新简报'
      : status === 'future' ? '已读取最新简报日期，但日期需要核对'
      : status === 'pending' ? `今日简报尚未产出，最新一期为 ${next.date}`
      : `已核对最新简报日期为 ${next.date}${current.meta.freshness.latestEditionStatus === 'partial' ? '，部分来源仍待补充' : ''}`;
    return `${latestStatus}；仍在查看 ${viewingDate} 期。`;
  }
  if (status === 'missing') return '已检查，暂时还没有简报；采集完成后会显示在这里。';
  if (status === 'future') return '已读取简报，但最新简报日期需要核对。';
  if (status === 'pending') return `今日简报尚未产出，最新一期为 ${next.date}；已重新读取现有资料。`;
  if (current.meta.freshness.latestEditionStatus === 'partial') return changed ? `已读取 ${next.date} 简报，部分来源更新，其余来源仍待补充。` : `已检查，${next.date} 简报暂无新增内容，部分来源仍待补充。`;
  return changed ? `今日简报已更新，已读取 ${next.date} 的最新内容。` : `已检查，${next.date} 简报暂无新增内容。`;
}

export function githubCheckMessage(result: { checked: number; partial: boolean }) {
  return result.partial ? `已核对 ${result.checked} 个 GitHub 仓库，部分来源暂不可用；简报日期不变。` : `已核对 ${result.checked} 个 GitHub 仓库的 Star；简报日期不变。`;
}
