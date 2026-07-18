import type Database from 'better-sqlite3'

export const CLEAR_ALL_MESSAGES_SQL = `DELETE FROM chatmessage
WHERE document_id IN (SELECT id FROM document WHERE user_id = ?)`

/** Delete every message attached to a document owned by one user. */
export function clearAllMessagesForUser(database: Database.Database, userId: number): number {
  return database.prepare(CLEAR_ALL_MESSAGES_SQL).run(userId).changes
}
