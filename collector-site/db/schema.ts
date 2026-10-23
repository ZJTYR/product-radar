import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const intelItems = sqliteTable('intel_items', { id: text('id').primaryKey(), payload: text('payload').notNull(), updatedAt: text('updated_at').notNull() });
export const editions = sqliteTable('editions', { date: text('date').primaryKey(), payload: text('payload').notNull(), updatedAt: text('updated_at').notNull(), status: text('status').notNull() });
export const favorites = sqliteTable('favorites', { userId: text('user_id').notNull(), itemId: text('item_id').notNull(), collection: text('collection').notNull(), note: text('note').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull() }, table => [primaryKey({ columns: [table.userId, table.itemId] })]);
export const preferences = sqliteTable('preferences', { userId: text('user_id').primaryKey(), email: text('email').notNull(), deliveryTime: text('delivery_time').notNull(), emailEnabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(false) });
export const runs = sqliteTable('runs', { id: text('id').primaryKey(), kind: text('kind').notNull(), status: text('status').notNull(), detail: text('detail').notNull(), createdAt: text('created_at').notNull() });
export const settings = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull() });
