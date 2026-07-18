// Chat domain logic. Port of margin/chat.py (normalize_math lives in the renderer).

import type { ChatMessageRow, DocumentRow } from '@shared/models'
import { PROVIDER_EFFORTS, PROVIDER_MODELS, PROVIDERS, type Provider } from '@shared/constants'
import type { AiChoice } from '@shared/ipc'
import { db, utcnowSql, USER_ID } from '../db'
import { clearAllMessagesForUser } from './chatCore'

const DEFAULT_AI_PROVIDER = (process.env.DEFAULT_AI_PROVIDER || 'claude') as Provider
let historyGeneration = 0

export function addMessage(args: {
  documentId: number
  role: 'user' | 'assistant'
  content: string
  contextText?: string
  mode?: string
  scope?: string
  pageNumber?: number | null
}): ChatMessageRow {
  const info = db
    .prepare(
      `INSERT INTO chatmessage (document_id, user_id, role, content, context_text, mode, scope, page_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.documentId,
      USER_ID,
      args.role,
      args.content,
      args.contextText ?? '',
      args.mode ?? '',
      args.scope ?? 'page',
      args.pageNumber ?? null,
      utcnowSql(),
    )
  return db.prepare('SELECT * FROM chatmessage WHERE id = ?').get(info.lastInsertRowid) as ChatMessageRow
}

export function history(documentId: number, limit?: number): ChatMessageRow[] {
  const messages = db
    .prepare('SELECT * FROM chatmessage WHERE document_id = ? ORDER BY created_at ASC, id ASC')
    .all(documentId) as ChatMessageRow[]
  return limit ? messages.slice(-limit) : messages
}

/** Hard-delete every chat message for a document. Returns the number removed. */
export function clearMessages(documentId: number): number {
  return db.prepare('DELETE FROM chatmessage WHERE document_id = ?').run(documentId).changes
}

/** A process-local revision used to prevent requests started before a bulk clear from restoring history. */
export function currentHistoryGeneration(): number {
  return historyGeneration
}

/** Hard-delete chat messages for every document owned by the active user. */
export function clearAllMessages(): number {
  const changes = clearAllMessagesForUser(db, USER_ID)
  historyGeneration += 1
  return changes
}

/** (context, scope_label) — the selection wins over page text, which wins over the whole paper. */
export function buildContext(
  document: DocumentRow,
  args: { scope: string; pageNumber: number | null; selectedText?: string },
): [string, string] {
  const selected = (args.selectedText ?? '').trim()
  if (selected) return [selected, "the reader's highlighted selection"]
  if (args.scope === 'page' && args.pageNumber !== null) {
    const page = db
      .prepare('SELECT text FROM page WHERE document_id = ? AND number = ?')
      .get(document.id, args.pageNumber) as { text: string } | undefined
    if (page?.text) return [page.text, `page ${args.pageNumber} of the paper`]
  }
  const pages = db
    .prepare('SELECT text FROM page WHERE document_id = ? ORDER BY number ASC')
    .all(document.id) as { text: string }[]
  const fullText = pages.filter((p) => p.text).map((p) => p.text).join('\n\n')
  return [fullText, `the paper "${document.title}"`]
}

/** (context, scope_label) when the selected block is a figure sent as an image attachment. */
export function imageContext(pageNumber: number | null): [string, string] {
  const where = pageNumber !== null ? ` on page ${pageNumber} of the paper` : ' in the paper'
  const context =
    `[The reader selected a figure${where}. It is attached as an image ` +
    'rather than text — study the image to answer.]'
  return [context, `a figure${where}`]
}

/** (context, scope_label) for an exact page region sent as an image attachment. */
export function regionImageContext(pageNumber: number): [string, string] {
  const where = ` on page ${pageNumber} of the paper`
  const context =
    `[The reader selected an exact visual region${where}. It is attached as an image ` +
    'rather than extracted text — study everything visible in that region to answer.]'
  return [context, `the reader's selected visual region${where}`]
}

export function aiChoice(): AiChoice {
  const row = db
    .prepare('SELECT provider, model, effort FROM providerchoice WHERE user_id = ?')
    .get(USER_ID) as AiChoice | undefined
  if (!row) return { provider: DEFAULT_AI_PROVIDER, model: '', effort: '' }
  return row
}

export function setAiChoice(choice: AiChoice): AiChoice {
  const { provider, model, effort } = choice
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider: ${provider}`)
  if (!PROVIDER_MODELS[provider].includes(model)) throw new Error(`unknown ${provider} model: ${model}`)
  if (!PROVIDER_EFFORTS[provider].includes(effort)) throw new Error(`unknown ${provider} effort: ${effort}`)
  const existing = db.prepare('SELECT id FROM providerchoice WHERE user_id = ?').get(USER_ID) as
    | { id: number }
    | undefined
  if (existing) {
    db.prepare('UPDATE providerchoice SET provider = ?, model = ?, effort = ? WHERE id = ?').run(
      provider,
      model,
      effort,
      existing.id,
    )
  } else {
    db.prepare('INSERT INTO providerchoice (user_id, provider, model, effort) VALUES (?, ?, ?, ?)').run(
      USER_ID,
      provider,
      model,
      effort,
    )
  }
  return { provider, model, effort }
}
