import { describe, expect, it } from 'vitest'
import { migrateChatThreads } from './chatMigration'
import { sqliteTestDatabase } from './sqliteTestDatabase'

describe('migrateChatThreads', () => {
  it('is safe on an empty database and on repeated runs', () => {
    const { database, close } = sqliteTestDatabase()
    migrateChatThreads(database)
    migrateChatThreads(database)

    const table = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chatthread'").get()
    expect(table).toBeTruthy()
    close()
  })

  it('preserves each legacy paper history as one titled thread', () => {
    const { database, close } = sqliteTestDatabase()
    database.exec(`
      CREATE TABLE user (id INTEGER PRIMARY KEY);
      CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
      CREATE TABLE chatmessage (
        id INTEGER PRIMARY KEY,
        document_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO user VALUES (1), (2);
      INSERT INTO document VALUES (10, 1), (11, 1), (20, 2);
      INSERT INTO chatmessage VALUES
        (1, 10, 1, 'user', 'How does sparse attention work?', '2026-01-01 10:00:00.000000'),
        (2, 10, 1, 'assistant', 'It limits connections.', '2026-01-01 10:01:00.000000'),
        (3, 11, 1, 'assistant', 'A legacy assistant-only row.', '2026-01-02 10:00:00.000000'),
        (4, 20, 2, 'user', 'Explain the loss function', '2026-01-03 10:00:00.000000');
    `)

    migrateChatThreads(database)
    migrateChatThreads(database)

    const threads = database.prepare('SELECT document_id, user_id, title, created_at, updated_at FROM chatthread ORDER BY document_id').all()
    expect(threads).toEqual([
      { document_id: 10, user_id: 1, title: 'How does sparse attention work', created_at: '2026-01-01 10:00:00.000000', updated_at: '2026-01-01 10:01:00.000000' },
      { document_id: 11, user_id: 1, title: 'Previous chat', created_at: '2026-01-02 10:00:00.000000', updated_at: '2026-01-02 10:00:00.000000' },
      { document_id: 20, user_id: 2, title: 'Explain the loss function', created_at: '2026-01-03 10:00:00.000000', updated_at: '2026-01-03 10:00:00.000000' },
    ])
    const attached = database.prepare('SELECT COUNT(*) AS count FROM chatmessage WHERE thread_id IS NOT NULL').get() as { count: number }
    expect(attached.count).toBe(4)
    expect((database.prepare('SELECT COUNT(*) AS count FROM chatthread').get() as { count: number }).count).toBe(3)
    close()
  })
})
