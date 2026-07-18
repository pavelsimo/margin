import Database from 'better-sqlite3'
import { DB_PATH } from './paths'

export const db = new Database(DB_PATH)

// Same pragmas as margin/db.py.
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

/** Naive-UTC timestamp in SQLAlchemy's format: "YYYY-MM-DD HH:MM:SS.ffffff". */
export function utcnowSql(): string {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}` +
    `.${pad(now.getUTCMilliseconds(), 3)}000`
  )
}

/** Format a stored naive-UTC datetime like the library list does ("Jul 17"). */
export function parseDbDate(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z')
}

// The app is single-user: adopt whoever owns the documents in the DB,
// falling back to any user.
function pickUser(): number {
  const byDocs = db
    .prepare('SELECT user_id AS id FROM document GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1')
    .get() as { id: number } | undefined
  if (byDocs) return byDocs.id
  const anyUser = db.prepare('SELECT id FROM "user" ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (anyUser) return anyUser.id
  throw new Error('no users in database')
}

export const USER_ID = pickUser()
