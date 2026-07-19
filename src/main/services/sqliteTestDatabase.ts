import type Database from 'better-sqlite3'
import { DatabaseSync } from 'node:sqlite'

/** Minimal better-sqlite3-compatible wrapper for Node's built-in test database. */
export function sqliteTestDatabase(): { database: Database.Database; close: () => void } {
  const raw = new DatabaseSync(':memory:')
  const database = {
    exec: raw.exec.bind(raw),
    prepare: raw.prepare.bind(raw),
    transaction: <T>(work: () => T) => () => {
      raw.exec('BEGIN')
      try {
        const result = work()
        raw.exec('COMMIT')
        return result
      } catch (error) {
        raw.exec('ROLLBACK')
        throw error
      }
    },
  } as unknown as Database.Database
  return { database, close: () => raw.close() }
}
