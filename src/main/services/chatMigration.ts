import type Database from 'better-sqlite3'
import { fallbackChatTitle } from './chatCore'

function hasTable(database: Database.Database, name: string): boolean {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((row) => row.name === column)
}

/**
 * Extend databases created by the original web app with desktop chat threads.
 * The migration is intentionally introspection-based because the inherited
 * Alembic revision is owned by the old application.
 */
export function migrateChatThreads(database: Database.Database): void {
  database.transaction(() => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS chatthread (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        title VARCHAR NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        FOREIGN KEY(document_id) REFERENCES document(id),
        FOREIGN KEY(user_id) REFERENCES user(id)
      );
      CREATE INDEX IF NOT EXISTS ix_chatthread_document_id ON chatthread(document_id);
      CREATE INDEX IF NOT EXISTS ix_chatthread_user_id ON chatthread(user_id);
      CREATE INDEX IF NOT EXISTS ix_chatthread_document_updated ON chatthread(document_id, updated_at DESC, id DESC);
    `)

    if (!hasTable(database, 'chatmessage')) return
    if (!hasColumn(database, 'chatmessage', 'thread_id')) {
      database.exec('ALTER TABLE chatmessage ADD COLUMN thread_id INTEGER REFERENCES chatthread(id)')
    }
    database.exec('CREATE INDEX IF NOT EXISTS ix_chatmessage_thread_id ON chatmessage(thread_id)')

    const legacyGroups = database.prepare(`
      SELECT document_id, user_id, MIN(created_at) AS created_at, MAX(created_at) AS updated_at
      FROM chatmessage
      WHERE thread_id IS NULL
      GROUP BY document_id, user_id
      ORDER BY document_id, user_id
    `).all() as Array<{ document_id: number; user_id: number; created_at: string; updated_at: string }>

    const firstQuestion = database.prepare(`
      SELECT content FROM chatmessage
      WHERE document_id = ? AND user_id = ? AND thread_id IS NULL AND role = 'user'
      ORDER BY created_at ASC, id ASC LIMIT 1
    `)
    const insertThread = database.prepare(`
      INSERT INTO chatthread (document_id, user_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const attachMessages = database.prepare(`
      UPDATE chatmessage SET thread_id = ?
      WHERE document_id = ? AND user_id = ? AND thread_id IS NULL
    `)

    for (const group of legacyGroups) {
      const question = firstQuestion.get(group.document_id, group.user_id) as { content: string } | undefined
      const inserted = insertThread.run(
        group.document_id,
        group.user_id,
        fallbackChatTitle(question?.content ?? '', 'Previous chat'),
        group.created_at,
        group.updated_at,
      )
      attachMessages.run(inserted.lastInsertRowid, group.document_id, group.user_id)
    }
  })()
}
