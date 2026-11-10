/**
 * Tables that exist on both the server (Turso) and the phone (expo-sqlite)
 * and are exchanged by mobile sync. Keep to features both libSQL and
 * expo-sqlite support.
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { id, syncColumns } from './columns';

export const bookmarks = sqliteTable(
  'bookmarks',
  {
    id: id(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    notes: text('notes').notNull().default(''),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    readLater: integer('read_later', { mode: 'boolean' }).notNull().default(false),
    /** Pinboard's `hash`, so re-running the import updates rows instead of duplicating them. */
    pinboardHash: text('pinboard_hash').unique(),
    ...syncColumns(),
  },
  (t) => [index('bookmarks_updated_at_idx').on(t.updatedAt)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: id(),
    // Not unique: two offline devices can create the same tag name with
    // different ids. Merging duplicates is the sync layer's job.
    name: text('name').notNull(),
    ...syncColumns(),
  },
  (t) => [index('tags_name_idx').on(t.name), index('tags_updated_at_idx').on(t.updatedAt)],
);

export const bookmarkTags = sqliteTable(
  'bookmark_tags',
  {
    bookmarkId: text('bookmark_id')
      .notNull()
      .references(() => bookmarks.id),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    ...syncColumns(),
  },
  (t) => [
    primaryKey({ columns: [t.bookmarkId, t.tagId] }),
    index('bookmark_tags_updated_at_idx').on(t.updatedAt),
  ],
);
