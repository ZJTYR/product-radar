import type { RadarDatabase } from './database.ts';
import { shanghaiDay } from './home-feed.ts';

export type EditionRecord = { date: string; payload: string; updated_at: string; status: string };

export async function readFeedMetadata(db: RadarDatabase, requestedDate?: string | null, checkedAt = new Date().toISOString()) {
  const latest = await db.prepare('SELECT * FROM editions ORDER BY date DESC LIMIT 1').first<EditionRecord>();
  const edition = requestedDate ? await db.prepare('SELECT * FROM editions WHERE date=?').bind(requestedDate).first<EditionRecord>() : latest;
  const stars = await db.prepare("SELECT status,created_at FROM runs WHERE kind='github_stars' ORDER BY created_at DESC LIMIT 1").first<{ status: string; created_at: string }>();
  return {
    edition,
    // 内容状态来自简报本身，Star 核对不代表当日研究已经完成。
    lastRunStatus: ({ complete: '简报更新完成', partial: '简报部分来源更新', curated: '人工精选核验' } as Record<string, string>)[latest?.status || ''] || '尚无简报',
    freshness: {
      today: shanghaiDay(checkedAt), checkedAt, latestEditionDate: latest?.date || '', latestEditionUpdatedAt: latest?.updated_at || '', latestEditionStatus: latest?.status || '',
      lastStarsCheckedAt: stars?.created_at || '', lastStarsStatus: stars?.status || '',
    },
  };
}
