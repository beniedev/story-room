import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  dataJson: text('data_json').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => [index('books_updated_at_idx').on(table.updatedAt)]);
