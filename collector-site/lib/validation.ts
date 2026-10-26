import { z } from 'zod';
const text = z.string().trim().min(1).max(8000);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期无效');
const timestamp = z.string().max(40).refine(v => !Number.isNaN(Date.parse(v)), '时间格式无效');
export const httpUrl = z.string().url().max(2000).refine(v => ['http:', 'https:'].includes(new URL(v).protocol), '仅支持 http(s) 来源');
export const itemSchema = z.object({
 id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), kind: z.enum(['product', 'design', 'ai']), aiApplication: z.enum(['agents','knowledge','multimodal','integration','engineering']).optional(), name: text, title: text, subtitle: text,
 summary: text, category: text, tags: z.array(z.string().max(80)).max(30), image: z.string().max(2000).refine(v => /^\/images\/[A-Za-z0-9_.\/-]+$/.test(v) && !v.includes('..') || httpUrl.safeParse(v).success, '图片仅允许 /images/ 路径或 http(s) URL').optional(),
 imageCaption: z.string().trim().min(1).max(300).optional(), scenario: text.optional(),
 accent: z.string().regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/), website: httpUrl, github: httpUrl.optional(), repo: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).optional(),
 stars: z.number().int().nonnegative().nullable().optional(), starsCheckedAt: timestamp.optional(), publishedAt: timestamp.nullable().optional(),
 discoveredAt: timestamp, evidence: z.enum(['官方资料', '产品观察', '官方发布']), featured: z.boolean().optional(), readMinutes: z.number().int().min(1).max(120),
 facts: z.array(text).min(1).max(30), audience: text, pain: text, workflow: text, businessModel: text, differentiation: text, opportunity: text,
 designNotes: z.array(text).max(30), caveats: z.array(text).max(30), sources: z.array(z.object({ label: text, url: httpUrl })).min(1).max(30),
}).strict();
export const catalogSchema = z.object({ items: z.array(itemSchema).min(1).max(50) }).strict().superRefine((value, ctx) => {
 if (new Set(value.items.map(item => item.id)).size !== value.items.length) ctx.addIssue({ code: 'custom', message: '产品库批次不能重复 item id' });
});
export const ingestSchema = z.object({ date: dateSchema, items: z.array(itemSchema).max(20), status: z.enum(['complete', 'partial']).default('complete') }).strict().superRefine((v, ctx) => {
 if(v.date > new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})) ctx.addIssue({code:'custom',message:'不能发布未来日期简报'});
 if (new Set(v.items.map(i => i.id)).size !== v.items.length) ctx.addIssue({ code: 'custom', message: '同一批次不能重复 item id' });
});
export const favoriteSchema = z.object({ itemId: z.string().min(1).max(100), collection: z.string().trim().min(1).max(80), note: z.string().max(4000) }).strict();
export const preferenceSchema = z.object({ email: z.string().trim().email().max(254), deliveryTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), emailEnabled: z.boolean() }).strict();
export const systemSchema = z.object({ schedule_status: z.string().max(400).optional(), schedule_id: z.string().max(200).optional(), schedule_updated_at: timestamp.optional() }).strict();
export function isSameOriginMutation(request: Request) {
 const site = request.headers.get('sec-fetch-site');
 if (site === 'cross-site') return false;
 const origin = request.headers.get('origin');
 if (!origin) return true; // Service callers have no browser Origin; Sites authenticates them at its private gate.
 try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
