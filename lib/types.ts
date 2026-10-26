export type ItemKind = 'product' | 'design' | 'ai';
export interface SourceLink { label: string; url: string }
export interface IntelItem {
  id: string; kind: ItemKind; name: string; title: string; subtitle: string;
  summary: string; category: string; tags: string[]; image?: string; imageCaption?: string;
  accent: string; website: string; github?: string; repo?: string;
  stars?: number | null; starsCheckedAt?: string; publishedAt?: string | null;
  discoveredAt: string; evidence: '官方资料' | '产品观察' | '官方发布';
  featured?: boolean; readMinutes: number;
  facts: string[]; audience: string; pain: string; workflow: string; scenario?: string;
  businessModel: string; differentiation: string; opportunity: string;
  designNotes: string[]; caveats: string[]; sources: SourceLink[];
}
export interface SavedItem { itemId: string; collection: string; note: string; createdAt: string; updatedAt: string }
export interface Preferences { email: string; deliveryTime: string; emailEnabled: boolean }
export type InterestAction = 'interested' | 'not_interested';
export interface ItemFeedback { itemId: string; action: InterestAction; updatedAt: string }
export interface FeedResponse {
 items: IntelItem[];
 meta: { updatedAt: string; date: string; total: number; scheduleStatus: string; emailStatus: string; sourceCount: number; lastRunStatus: string; lastError?: string; editionItemIds?: string[]; emailConfigured?: boolean; };
 user: { name: string; signedIn: boolean };
}
