import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { CLEAR_ALL_MESSAGES_SQL } from './chatCore'

describe('clearAllMessagesForUser', () => {
  it("removes messages across the user's papers without changing other users or paper data", () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL);
      CREATE TABLE chatmessage (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
      CREATE TABLE page (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
      CREATE TABLE prompttemplate (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, template TEXT NOT NULL);

      INSERT INTO document VALUES (10, 1, 'First'), (11, 1, 'Second'), (20, 2, 'Other user');
      INSERT INTO chatmessage VALUES (1, 10, 1), (2, 10, 1), (3, 11, 1), (4, 20, 2);
      INSERT INTO page VALUES (100, 10), (110, 11), (200, 20);
      INSERT INTO prompttemplate VALUES (1, 1, 'custom prompt');
    `)

    expect(database.prepare(CLEAR_ALL_MESSAGES_SQL).run(1).changes).toBe(3)
    expect(database.prepare('SELECT id FROM chatmessage ORDER BY id').all().map((row) => row.id)).toEqual([4])
    expect(database.prepare('SELECT id FROM document ORDER BY id').all().map((row) => row.id)).toEqual([10, 11, 20])
    expect(database.prepare('SELECT id FROM page ORDER BY id').all().map((row) => row.id)).toEqual([100, 110, 200])
    expect(database.prepare('SELECT template FROM prompttemplate').get()?.template).toBe('custom prompt')

    database.close()
  })

  it('reports zero when the user has no chat history', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`
      CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
      CREATE TABLE chatmessage (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
    `)

    expect(database.prepare(CLEAR_ALL_MESSAGES_SQL).run(1).changes).toBe(0)
    database.close()
  })
})
