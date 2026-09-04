import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionLease } from './executionCoordinator'

vi.mock('../db', async () => {
  const { sqliteTestDatabase } = await import('./sqliteTestDatabase')
  const { migrateChatThreads } = await import('./chatMigration')
  const { database } = sqliteTestDatabase()
  database.exec(`
    CREATE TABLE user (id INTEGER PRIMARY KEY);
    CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL);
    CREATE TABLE chatmessage (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      role TEXT NOT NULL, content TEXT NOT NULL, context_text TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'page', page_number INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE page (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
    CREATE TABLE block (id INTEGER PRIMARY KEY, page_id INTEGER NOT NULL);
    CREATE TABLE documentopen (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
    CREATE TABLE ingestionerror (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
    INSERT INTO user VALUES (1);
    INSERT INTO document VALUES (10, 1, 'Paper');
  `)
  migrateChatThreads(database)
  return { db: database, USER_ID: 1, utcnowSql: () => '2026-01-01 00:00:00.000000', parseDbDate: () => new Date() }
})
vi.mock('./executableSettings', () => ({}))
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))
vi.mock('../paths', () => ({ documentDir: () => '/unused-fixture-path' }))
vi.mock('../protocol', () => ({ pageImageUrl: () => '' }))
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), rmSync: vi.fn() }))
import { db } from '../db'
import { addUserTurn, addAssistantMessage, clearMessages, clearAllChats, history } from './chat'
import { execute } from './commands'
import { deleteDocument } from '../ipc/library'
import { executions } from './executionCoordinator'
import { uiMessage } from './chatExecution'
import { migrateChatThreads } from './chatMigration'

const leases: ExecutionLease[] = []
afterEach(() => {
  for (const lease of leases) lease.finish()
  leases.length = 0
  db.exec('DELETE FROM chatmessage; DELETE FROM chatthread; INSERT OR IGNORE INTO document VALUES (10, 1, \'Paper\');')
})
function turn() {
  const value = addUserTurn({ documentId: 10, content: 'Question' })
  const lease = executions.begin({ requestId: 'persist', task: 'chat', documentId: 10, threadId: value.thread.id, ownerId: 1 })
  leases.push(lease)
  return { ...value, lease }
}
describe('chat persistence and invalidation', () => {
  it.each(['completed', 'cancelled', 'timed_out', 'failed'] as const)('round-trips %s outcomes through SQLite and UI mapping', (outcome) => {
    const { thread } = turn()
    addAssistantMessage({ threadId: thread.id, documentId: 10, content: 'Answer', mode: outcome === 'failed' ? 'error' : 'ask', outcome })
    migrateChatThreads(db)
    const answer = uiMessage(history(thread.id).at(-1)!)
    expect(answer.outcome).toBe(outcome)
    expect(answer.content).toBe('Answer')
  })
  it.each(['clear', 'command', 'all', 'delete'] as const)('invalidates active work through the %s entry point', (action) => {
    const { thread, lease } = turn()
    if (action === 'clear') clearMessages(thread.id)
    if (action === 'command') execute(thread.id, '/clear')
    if (action === 'all') clearAllChats()
    if (action === 'delete') deleteDocument(10)
    expect(lease.valid).toBe(false)
    expect(lease.signal.aborted).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS n FROM chatmessage').get()).toMatchObject({ n: 0 })
  })
})
