import { z } from 'zod';
const text = z.string().trim().min(1).max(8000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期无效');
const timestamp = z.string().max(40).refine(v => !Number.isNaN(Date.parse(v)), '时间格式无效');
export const httpUrl = z.string().url().max(2000).refine(v => { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } }, '仅支持 http(s) 来源');
const imageUrl = z.string().max(2000).refine(v => /^\/images\/[A-Za-z0-9_.\/-]+$/.test(v) && !v.includes('..') || httpUrl.safeParse(v).success, '图片仅允许 /images/ 路径或 http(s) URL');
export const imageSchema = z.object({ url: imageUrl, caption: z.string().trim().min(1).max(300), sourceUrl: httpUrl }).strict();
const imageGallerySchema = z.array(imageSchema).max(50).refine(images => new Set(images.map(image => image.url)).size === images.length, '图集不能重复图片 URL');
export const itemSchema = z.object({
 id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), kind: z.enum(['product', 'design', 'ai', 'news']), newsTopic: z.enum(['technology', 'product']).optional(), name: text, title: text, subtitle: text,
 summary: text, category: text, tags: z.array(z.string().max(80)).max(30), image: imageUrl.optional(), images: imageGallerySchema.optional(),
 imageCaption: z.string().trim().min(1).max(300).optional(), scenario: text.optional(),
 accent: z.string().regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/), website: httpUrl, github: httpUrl.optional(), repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
 stars: z.number().int().nonnegative().nullable().optional(), starsCheckedAt: timestamp.optional(), publishedAt: timestamp.nullable().optional(),
 discoveredAt: timestamp, evidence: z.enum(['官方资料', '产品观察', '官方发布']), featured: z.boolean().optional(), readMinutes: z.number().int().min(1).max(120),
 aiApplication: z.enum(['agents', 'knowledge', 'multimodal', 'integration', 'engineering']).optional(),
 facts: z.array(text).min(1).max(30), audience: text, pain: text, workflow: text, businessModel: text, differentiation: text, opportunity: text,
 designNotes: z.array(text).max(30), caveats: z.array(text).max(30), sources: z.array(z.object({ label: text, url: httpUrl })).min(1).max(30),
}).strict().superRefine((item, ctx) => {
 if (item.kind === 'news' && !item.newsTopic) ctx.addIssue({code:'custom',path:['newsTopic'],message:'科技或产品新闻须填写新闻分类'});
 if (item.kind === 'news' && !item.publishedAt) ctx.addIssue({code:'custom',path:['publishedAt'],message:'新闻须保留核验后的实际发布日期'});
});
export const catalogSchema = z.object({ items: z.array(itemSchema).min(1).max(50) }).strict().superRefine((value, ctx) => {
 if (new Set(value.items.map(item => item.id)).size !== value.items.length) ctx.addIssue({ code: 'custom', message: '产品库批次不能重复 item id' });
});
export const ingestSchema = z.object({ date: dateSchema, items: z.array(itemSchema).max(20), status: z.enum(['complete', 'partial']).default('complete') }).strict().superRefine((v, ctx) => {
 if(v.date > new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})) ctx.addIssue({code:'custom',message:'不能发布未来日期简报'});
 if (new Set(v.items.map(i => i.id)).size !== v.items.length) ctx.addIssue({ code: 'custom', message: '同一批次不能重复 item id' });
});
export const favoriteSchema = z.object({ itemId: z.string().min(1).max(100), collection: z.string().trim().min(1).max(80), note: z.string().max(4000) }).strict();
export const favoriteCollectionSchema = z.object({ itemId: z.string().min(1).max(100), collection: z.string().trim().min(1).max(80), expectedCollection: z.string().min(1).max(80) }).strict();
export const preferenceSchema = z.object({ email: z.string().trim().email().max(254), deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), emailEnabled: z.boolean() }).strict();
export const feedbackItemIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const feedbackSchema = z.object({ itemId: feedbackItemIdSchema, action: z.enum(['interested', 'not_interested']) }).strict();
export const undoSchema = z.object({ undoToken: z.string().uuid() }).strict();
export const recommendationLimitSchema = z.coerce.number().int().min(1).max(30).default(12);
export const recommendationScopeSchema = z.enum(['all', 'products', 'github', 'ai', 'frontier']).default('all');
export const recommendationExcludeSchema = z.string().max(5049).default('').transform(value => value ? value.split(',') : []).pipe(z.array(feedbackItemIdSchema).max(50)).transform(value => [...new Set(value)]);
export const itemReadSchema = z.object({ itemId: feedbackItemIdSchema }).strict();
export const editionReadSchema = z.object({ date: dateSchema, read: z.boolean(), version: timestamp.optional() }).strict().superRefine((value, ctx) => {
 if (value.read && !value.version) ctx.addIssue({ code: 'custom', path: ['version'], message: '标记已读须提供实际打开的简报版本' });
});
export const systemSchema = z.object({ schedule_status: z.string().max(400).optional(), schedule_id: z.string().max(200).optional(), schedule_updated_at: timestamp.optional() }).strict();
export function isSameOriginMutation(request: Request) {
 const site = request.headers.get('sec-fetch-site');
 if (site === 'cross-site') return false;
 const origin = request.headers.get('origin');
 if (!origin) return true; // Service callers are authenticated by Vercel's private deployment gate.
 try {
  const supplied = new URL(origin);
  const expected = new URL(request.url);
  // Next may normalize the server URL to localhost. Host retains the actual browser destination.
  const host = request.headers.get('host');
  return supplied.origin === expected.origin || Boolean(host && supplied.host === host && supplied.protocol === expected.protocol);
 } catch { return false; }
}
