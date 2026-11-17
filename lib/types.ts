export type ItemKind = 'product' | 'design' | 'ai' | 'news';
export type NewsTopic = 'technology' | 'product';
export type AIApplication = 'agents' | 'knowledge' | 'multimodal' | 'integration' | 'engineering';
export interface SourceLink { label: string; url: string }
export interface IntelImage { url: string; caption: string; sourceUrl: string }
export interface MissingImageReview {
  reason: 'no_public_image' | 'no_product_ui' | 'unsuitable_image' | 'source_unavailable';
  detail: string;
  checkedAt: string;
  sources: string[];
}
export interface IntelItem {
  id: string; kind: ItemKind; name: string; title: string; subtitle: string;
  summary: string; category: string; tags: string[]; image?: string; imageCaption?: string; images?: IntelImage[]; missingImageReview?: MissingImageReview;
  accent: string; website: string; github?: string; repo?: string;
  stars?: number | null; starsCheckedAt?: string; publishedAt?: string | null;
  discoveredAt: string; evidence: '官方资料' | '产品观察' | '官方发布';
  featured?: boolean; readMinutes: number;
  aiApplication?: AIApplication;
  newsTopic?: NewsTopic;
  facts: string[]; audience: string; pain: string; workflow: string; scenario?: string;
  businessModel: string; differentiation: string; opportunity: string;
  designNotes: string[]; caveats: string[]; sources: SourceLink[];
}
export interface SavedItem { itemId: string; collection: string; note: string; createdAt: string; updatedAt: string }
export interface Preferences { email: string; deliveryTime: string; emailEnabled: boolean }
export type InterestAction = 'interested' | 'not_interested';
export interface ItemFeedback { itemId: string; action: InterestAction; updatedAt: string }
export interface ItemRead { itemId: string; readAt: string }
export interface HistoryDay { date: string; count: number; updatedAt: string; status: string; readAt: string | null; hasUpdates: boolean }
export interface FeedFreshness {
 today: string; checkedAt: string; latestEditionDate: string; latestEditionUpdatedAt: string; latestEditionStatus: string;
 lastStarsCheckedAt: string; lastStarsStatus: string;
}
export interface FeedResponse {
 items: IntelItem[];
 meta: { updatedAt: string; date: string; total: number; scheduleStatus: string; emailStatus: string; sourceCount: number; lastRunStatus: string; freshness: FeedFreshness; lastError?: string; editionItemIds?: string[]; emailConfigured?: boolean; };
 user: { name: string; signedIn: boolean };
}
