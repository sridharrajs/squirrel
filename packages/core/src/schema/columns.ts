import { integer, text } from 'drizzle-orm/sqlite-core';

/** Client-generated UUID, so rows created offline on the phone can't collide. */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/** Timestamps every synced row needs. `deletedAt` is a soft delete: synced rows are never hard-deleted. */
export const syncColumns = () => ({
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
});
