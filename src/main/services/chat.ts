// Chat domain logic. Port of margin/chat.py (normalize_math lives in the renderer).

import type { ChatMessageRow, ChatThreadRow, DocumentRow } from '@shared/models'
import {
  PROVIDER_EFFORTS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  PROVIDERS,
  isBuiltInProvider,
  isOpenAiCompatibleProvider,
  type AiProviderId,
} from '@shared/constants'
import type { AiChoice, AiProviderInfo, ChatThreadSummary, ClearAllChatsResult } from '@shared/ipc'
import { db, utcnowSql, USER_ID } from '../db'
import { clearAllChatsForUser, NEW_CHAT_TITLE, resolveBackgroundChoice } from './chatCore'
import {
  backgroundChoice,
  executableSettings,
  openAiProfile,
  openAiProfiles,
  setBackgroundChoice,
} from './executableSettings'

const DEFAULT_AI_PROVIDER = process.env.DEFAULT_AI_PROVIDER || 'claude'
let historyGeneration = 0

export function threadSummary(row: ChatThreadRow): ChatThreadSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listThreads(): ChatThreadSummary[] {
  return (db.prepare(`
    SELECT chatthread.* FROM chatthread
    INNER JOIN document ON document.id = chatthread.document_id
    WHERE chatthread.user_id = ? AND document.user_id = ?
    ORDER BY chatthread.updated_at DESC, chatthread.id DESC
  `).all(USER_ID, USER_ID) as ChatThreadRow[]).map(threadSummary)
}

export function getThread(threadId: number): ChatThreadRow | undefined {
  return db.prepare(`
    SELECT chatthread.* FROM chatthread
    INNER JOIN document ON document.id = chatthread.document_id
    WHERE chatthread.id = ? AND chatthread.user_id = ? AND document.user_id = ?
  `).get(threadId, USER_ID, USER_ID) as ChatThreadRow | undefined
}

export function requireThread(threadId: number, documentId?: number): ChatThreadRow {
  const thread = getThread(threadId)
  if (!thread || (documentId !== undefined && thread.document_id !== documentId)) {
    throw new Error('This chat no longer exists.')
  }
  return thread
}

function insertMessage(args: {
  threadId: number
  documentId: number
  role: 'user' | 'assistant'
  content: string
  contextText?: string
  mode?: string
  scope?: string
  pageNumber?: number | null
}): ChatMessageRow {
  const now = utcnowSql()
  const info = db
    .prepare(
      `INSERT INTO chatmessage (thread_id, document_id, user_id, role, content, context_text, mode, scope, page_number, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.threadId,
      args.documentId,
      USER_ID,
      args.role,
      args.content,
      args.contextText ?? '',
      args.mode ?? '',
      args.scope ?? 'page',
      args.pageNumber ?? null,
      now,
    )
  db.prepare('UPDATE chatthread SET updated_at = ? WHERE id = ?').run(now, args.threadId)
  return db.prepare('SELECT * FROM chatmessage WHERE id = ?').get(info.lastInsertRowid) as ChatMessageRow
}

export function addUserTurn(args: {
  threadId?: number
  documentId: number
  content: string
  contextText?: string
  mode?: string
  scope?: string
  pageNumber?: number | null
}): { thread: ChatThreadRow; message: ChatMessageRow; created: boolean } {
  return db.transaction(() => {
    let thread: ChatThreadRow
    let created = false
    if (args.threadId) {
      thread = requireThread(args.threadId, args.documentId)
    } else {
      const document = db.prepare('SELECT id FROM document WHERE id = ? AND user_id = ?').get(args.documentId, USER_ID)
      if (!document) throw new Error('This paper no longer exists.')
      const now = utcnowSql()
      const info = db.prepare(`
        INSERT INTO chatthread (document_id, user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(args.documentId, USER_ID, NEW_CHAT_TITLE, now, now)
      thread = db.prepare('SELECT * FROM chatthread WHERE id = ?').get(info.lastInsertRowid) as ChatThreadRow
      created = true
    }
    const message = insertMessage({
      threadId: thread.id,
      documentId: args.documentId,
      role: 'user',
      content: args.content,
      contextText: args.contextText,
      mode: args.mode,
      scope: args.scope,
      pageNumber: args.pageNumber,
    })
    thread = requireThread(thread.id, args.documentId)
    return { thread, message, created }
  })()
}

export function addAssistantMessage(args: {
  threadId: number
  documentId: number
  content: string
  mode?: string
  scope?: string
  pageNumber?: number | null
}): ChatMessageRow {
  requireThread(args.threadId, args.documentId)
  return insertMessage({ ...args, role: 'assistant' })
}

export function history(threadId: number, limit?: number): ChatMessageRow[] {
  requireThread(threadId)
  const messages = db
    .prepare('SELECT * FROM chatmessage WHERE thread_id = ? ORDER BY created_at ASC, id ASC')
    .all(threadId) as ChatMessageRow[]
  return limit ? messages.slice(-limit) : messages
}

/** Hard-delete every message in one owned thread while retaining the thread itself. */
export function clearMessages(threadId: number): number {
  requireThread(threadId)
  return db.prepare('DELETE FROM chatmessage WHERE thread_id = ?').run(threadId).changes
}

/** A process-local revision used to prevent requests started before a bulk clear from restoring history. */
export function currentHistoryGeneration(): number {
  return historyGeneration
}

/** Hard-delete every chat and its messages for the active user. */
export function clearAllChats(): ClearAllChatsResult {
  const changes = clearAllChatsForUser(db, USER_ID)
  historyGeneration += 1
  return changes
}

export function updateThreadTitle(threadId: number, title: string): ChatThreadRow | undefined {
  const result = db.prepare(`
    UPDATE chatthread SET title = ?
    WHERE id = ? AND user_id = ? AND title = ?
  `).run(title, threadId, USER_ID, NEW_CHAT_TITLE)
  return result.changes ? getThread(threadId) : undefined
}

/** (context, scope_label): the selection wins over page text, which wins over the whole paper. */
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
    'rather than text, so study the image to answer.]'
  return [context, `a figure${where}`]
}

/** (context, scope_label) for an exact page region sent as an image attachment. */
export function regionImageContext(pageNumber: number): [string, string] {
  const where = ` on page ${pageNumber} of the paper`
  const context =
    `[The reader selected an exact visual region${where}. It is attached as an image ` +
    'rather than extracted text, so study everything visible in that region to answer.]'
  return [context, `the reader's selected visual region${where}`]
}

export function aiChoice(): AiChoice {
  const row = db
    .prepare('SELECT provider, model, effort FROM providerchoice WHERE user_id = ?')
    .get(USER_ID) as { provider: string; model: string; effort: string } | undefined
  if (!row || !isValidChoice(row)) return fallbackAiChoice()
  return row as AiChoice
}

export function setAiChoice(choice: AiChoice): AiChoice {
  const { provider, model, effort } = choice
  assertAiChoice(choice)
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

/** Choice used for background generation (chat titles, paper topics). Falls back to the chat selection. */
export function backgroundAiChoice(): AiChoice {
  const resolved = resolveBackgroundChoice(backgroundChoice(), aiProviders())
  return resolved ?? aiChoice()
}

export function setBackgroundAiChoice(choice: AiChoice | null): AiChoice | null {
  if (choice) assertAiChoice(choice)
  setBackgroundChoice(choice)
  return choice
}

export function aiProviders(): AiProviderInfo[] {
  const executables = executableSettings()
  const builtIns: AiProviderInfo[] = PROVIDERS.map((provider) => ({
    id: provider,
    label: PROVIDER_LABELS[provider],
    kind: 'cli',
    models: PROVIDER_MODELS[provider],
    defaultModel: '',
    efforts: PROVIDER_EFFORTS[provider],
    available: executables[provider].detected,
  }))
  const compatible: AiProviderInfo[] = openAiProfiles().map((profile) => ({
    id: profile.id,
    label: profile.name,
    kind: 'openai-compatible',
    models: profile.models,
    defaultModel: profile.defaultModel,
    efforts: [''],
    available: true,
  }))
  return [...builtIns, ...compatible]
}

export function fallbackAiChoice(exclude?: AiProviderId): AiChoice {
  const providers = aiProviders()
  const detectedCli = providers.find((provider) => provider.kind === 'cli' && provider.available && provider.id !== exclude)
  if (detectedCli) return { provider: detectedCli.id, model: detectedCli.defaultModel, effort: '' }
  const compatible = providers.find(
    (provider) => provider.kind === 'openai-compatible' && provider.available && provider.id !== exclude,
  )
  if (compatible) return { provider: compatible.id, model: compatible.defaultModel, effort: '' }
  const configuredDefault = isBuiltInProvider(DEFAULT_AI_PROVIDER) ? DEFAULT_AI_PROVIDER : 'claude'
  return { provider: configuredDefault, model: '', effort: '' }
}

function isValidChoice(choice: { provider: string; model: string; effort: string }): boolean {
  try {
    assertAiChoice(choice as AiChoice)
    return true
  } catch {
    return false
  }
}

function assertAiChoice(choice: AiChoice): void {
  const { provider, model, effort } = choice
  if (isBuiltInProvider(provider)) {
    if (!PROVIDER_MODELS[provider].includes(model)) throw new Error(`unknown ${provider} model: ${model}`)
    if (!PROVIDER_EFFORTS[provider].includes(effort)) throw new Error(`unknown ${provider} effort: ${effort}`)
    return
  }
  if (!isOpenAiCompatibleProvider(provider) || !openAiProfile(provider)) {
    throw new Error(`unknown provider: ${provider}`)
  }
  if (!model.trim()) throw new Error('Choose a model for this OpenAI-compatible API.')
  if (effort) throw new Error('Reasoning effort is not configurable for OpenAI-compatible APIs.')
}
