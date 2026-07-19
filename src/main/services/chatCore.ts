import type Database from 'better-sqlite3'
import type { AiChoice, AiProviderInfo } from '@shared/ipc'

export const CLEAR_ALL_MESSAGES_SQL = `DELETE FROM chatmessage
WHERE document_id IN (SELECT id FROM document WHERE user_id = ?)`

export const CLEAR_ALL_THREADS_SQL = `DELETE FROM chatthread
WHERE document_id IN (SELECT id FROM document WHERE user_id = ?)`

export const NEW_CHAT_TITLE = 'New chat'
export const MAX_CHAT_TITLE_CHARS = 60

function cleanTitle(value: string): string {
  return value
    .replace(/[`*_#>"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateTitle(value: string, limit = MAX_CHAT_TITLE_CHARS): string {
  if (value.length <= limit) return value
  const clipped = value.slice(0, limit + 1)
  const wordBoundary = clipped.lastIndexOf(' ')
  return (wordBoundary >= Math.floor(limit * 0.6) ? clipped.slice(0, wordBoundary) : value.slice(0, limit)).trim()
}

function limitTitleWords(value: string): string {
  return value.split(/\s+/).slice(0, 7).join(' ')
}

/** Sanitize the title-only response returned by an AI provider. */
export function sanitizeGeneratedTitle(value: string): string {
  const firstLine = value.split(/\r?\n/).map((line) => cleanTitle(line)).find(Boolean) ?? ''
  const withoutLabel = firstLine.replace(/^(title|chat title)\s*:\s*/i, '').replace(/[?.!,;:]+$/g, '')
  return truncateTitle(limitTitleWords(withoutLabel))
}

/** Deterministic title used for migrations and when title generation fails. */
export function fallbackChatTitle(question: string, empty = NEW_CHAT_TITLE): string {
  const cleaned = cleanTitle(question).replace(/[?.!,;:]+$/g, '')
  return truncateTitle(limitTitleWords(cleaned)) || empty
}

/**
 * Validate a stored background-generation choice against the current provider list.
 * Returns null when the choice can no longer be honored (provider deleted,
 * CLI undetected, or model/effort no longer offered) so callers fall back.
 */
export function resolveBackgroundChoice(
  stored: AiChoice | null,
  providers: AiProviderInfo[],
): AiChoice | null {
  if (!stored) return null
  const provider = providers.find((candidate) => candidate.id === stored.provider)
  if (!provider || !provider.available) return null
  if (provider.kind === 'cli') {
    if (!provider.models.includes(stored.model)) return null
    if (!provider.efforts.includes(stored.effort)) return null
    return stored
  }
  if (!stored.model.trim() || stored.effort !== '') return null
  return stored
}

export function clearAllChatsForUser(
  database: Database.Database,
  userId: number,
): { threadsDeleted: number; messagesDeleted: number } {
  return database.transaction(() => {
    const messagesDeleted = database.prepare(CLEAR_ALL_MESSAGES_SQL).run(userId).changes
    const threadsDeleted = database.prepare(CLEAR_ALL_THREADS_SQL).run(userId).changes
    return { threadsDeleted, messagesDeleted }
  })()
}
