import { z } from 'zod';
import { dateSchema, feedbackItemIdSchema } from './validation.ts';

export const annotationAnchorSchema = z.object({
  blockId: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/),
  start: z.number().int().min(0).max(8000),
  end: z.number().int().min(1).max(8000),
  quote: z.string().min(1).max(8000),
  prefix: z.string().max(160),
  suffix: z.string().max(160),
}).strict().refine(anchor => anchor.end > anchor.start, '摘录位置无效');

export const annotationCreateSchema = z.object({
  id: z.string().uuid(),
  itemId: feedbackItemIdSchema,
  sourceDate: dateSchema.nullish(),
  anchors: z.array(annotationAnchorSchema).max(40),
  body: z.string().max(10000),
}).strict().superRefine((value, context) => {
  if (!value.anchors.length && !value.body.trim()) context.addIssue({ code: 'custom', path: ['body'], message: '请写下想法或选择一段原文' });
  if (value.anchors.map(anchor => anchor.quote).join('\n\n').length > 8000) context.addIssue({ code: 'custom', path: ['anchors'], message: '一次摘录最多8000字，请分段记录' });
  const blocks = value.anchors.map(anchor => anchor.blockId);
  if (new Set(blocks).size !== blocks.length) context.addIssue({ code: 'custom', path: ['anchors'], message: '同一段原文不能重复摘录' });
});

export const annotationUpdateSchema = z.object({
  id: z.string().uuid(),
  version: z.string().uuid(),
  body: z.string().max(10000).optional(),
  deleted: z.boolean().optional(),
}).strict().refine(value => value.body !== undefined || value.deleted !== undefined, '没有可保存的更改');

export type AnnotationCreateInput = z.infer<typeof annotationCreateSchema>;
export type AnnotationUpdateInput = z.infer<typeof annotationUpdateSchema>;
