import { ipcMain, type WebContents } from 'electron'
import type { ChatMessageRow, PageRow } from '@shared/models'
import type {
  AiChoice,
  ChatDelta,
  ChatSendRequest,
  ChatSendResult,
  ChatThreadSummary,
  ChatThreadUpdate,
  UiMessage,
} from '@shared/ipc'
import { db } from '../db'
import { resolvePdf } from '../paths'
import { getDocumentRow } from './documents'
import * as ai from '../services/ai'
import * as chat from '../services/chat'
import * as commands from '../services/commands'
import * as prompts from '../services/prompts'
import { backgroundChoice } from '../services/executableSettings'
import { renderPageRegionImage } from '../services/pdf'
import { fallbackChatTitle, sanitizeGeneratedTitle } from '../services/chatCore'

const CHAT_TITLE_TIMEOUT_SECONDS = 20
const CHAT_TITLE_PROMPT = (question: string) =>
  'Write a concise 3-7 word title for a research-paper chat whose first user question is below. ' +
  'Return only the title as plain text: no quotes, markdown, label, or punctuation at the end.\n\n' +
  question

function uiMessage(m: ChatMessageRow): UiMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    contextText: m.context_text,
    mode: m.mode,
    isError: m.mode === 'error',
    createdAt: m.created_at,
  }
}

// Port of ReaderState.generate: resolve context (image crop / selection / page /
// document), assemble the prompt with history, run the CLI, persist both turns.
interface SendChatOptions {
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onThreadUpdate?: (update: ChatThreadUpdate) => void
}

async function titleNewThread(
  threadId: number,
  question: string,
  historyGeneration: number,
  onThreadUpdate?: (update: ChatThreadUpdate) => void,
): Promise<void> {
  const choice = chat.backgroundAiChoice()
  const result = await ai.runPrompt(choice.provider, CHAT_TITLE_PROMPT(question), {
    model: choice.model,
    effort: choice.effort,
    timeout: CHAT_TITLE_TIMEOUT_SECONDS,
  })
  if (chat.currentHistoryGeneration() !== historyGeneration) return
  const generated = result.ok ? sanitizeGeneratedTitle(result.text) : ''
  const row = chat.updateThreadTitle(threadId, generated || fallbackChatTitle(question))
  if (row) onThreadUpdate?.({ thread: chat.threadSummary(row), reason: 'titled' })
}

export async function sendChat(req: ChatSendRequest, opts: SendChatOptions = {}): Promise<ChatSendResult> {
  const document = getDocumentRow(req.docId)
  if (!document) throw new Error('This paper no longer exists.')
  const historyGeneration = chat.currentHistoryGeneration()
  const choice = chat.aiChoice()
  const region = req.imageRegion
  const imageLabel = region
    ? `Region · page ${req.imageRegionPage}`
    : req.imageBlockId
      ? figureLabelFor(req.imageBlockId, req.pageNumber)
      : ''

  const turn = chat.addUserTurn({
    threadId: req.threadId,
    documentId: req.docId,
    content: req.question,
    contextText: req.contextText || (req.imageBlockId || region ? imageLabel : ''),
    mode: req.mode,
    scope: req.scope,
    pageNumber: req.imageRegionPage || req.pageNumber,
  })
  const threadUpdate: ChatThreadUpdate = {
    thread: chat.threadSummary(turn.thread),
    reason: turn.created ? 'created' : 'updated',
    requestId: req.requestId,
  }
  opts.onThreadUpdate?.(threadUpdate)
  if (turn.created) {
    void titleNewThread(turn.thread.id, req.question, historyGeneration, opts.onThreadUpdate)
  }

  let imagePng: Buffer | null = null
  let context: string
  let scopeLabel: string
  let failure = ''
  if (region && req.imageRegionPage) {
    imagePng = renderPageRegionImage(resolvePdf(document.pdf_path), req.imageRegionPage, [
      region.x0,
      region.y0,
      region.x1,
      region.y1,
    ])
    if (!imagePng) failure = "Couldn't extract that selected region from the PDF."
    ;[context, scopeLabel] = chat.regionImageContext(req.imageRegionPage)
  } else if (req.imageBlockId) {
    const block = db
      .prepare('SELECT page_id, x0, y0, x1, y1 FROM block WHERE id = ?')
      .get(req.imageBlockId) as { page_id: number; x0: number; y0: number; x1: number; y1: number } | undefined
    const page = block
      ? (db.prepare('SELECT * FROM page WHERE id = ?').get(block.page_id) as PageRow | undefined)
      : undefined
    if (block && page) {
      imagePng = renderPageRegionImage(resolvePdf(document.pdf_path), page.number, [block.x0, block.y0, block.x1, block.y1])
    }
    if (!imagePng) failure = "Couldn't extract that figure from the PDF."
    ;[context, scopeLabel] = chat.imageContext(page ? page.number : null)
  } else {
    ;[context, scopeLabel] = chat.buildContext(document, {
      scope: req.scope,
      pageNumber: req.pageNumber,
      selectedText: req.contextText,
    })
  }

  let result: ai.AIResult
  if (failure) {
    result = { ok: false, text: '', error: failure }
  } else {
    const template = prompts.effectiveTemplate(req.mode)
    const history = chat.history(turn.thread.id, prompts.MAX_HISTORY_MESSAGES + 1).slice(0, -1) // drop the just-sent turn
    const prompt = prompts.assemblePrompt(template, {
      context: context!,
      question: req.question,
      scopeLabel: scopeLabel!,
      history,
    })
    result = await ai.runPrompt(choice.provider, prompt, {
      model: choice.model,
      effort: choice.effort,
      imagePng,
      signal: opts.signal,
      onDelta: opts.onDelta,
    })
  }

  if (chat.currentHistoryGeneration() !== historyGeneration) {
    throw new Error('Chat history was deleted while this answer was being generated.')
  }

  if (result.cancelled) {
    const partial = result.text.trim()
    if (!partial) return { status: 'stopped', thread: chat.threadSummary(chat.requireThread(turn.thread.id)) }
    const reply = chat.addAssistantMessage({
      threadId: turn.thread.id,
      documentId: req.docId,
      content: partial,
      mode: req.mode,
      scope: req.scope,
      pageNumber: req.imageRegionPage || req.pageNumber,
    })
    return { status: 'stopped', message: uiMessage(reply), thread: chat.threadSummary(chat.requireThread(turn.thread.id)) }
  }

  const reply = chat.addAssistantMessage({
    threadId: turn.thread.id,
    documentId: req.docId,
    content: result.ok ? result.text : result.error,
    mode: result.ok ? req.mode : 'error',
    scope: req.scope,
    pageNumber: req.imageRegionPage || req.pageNumber,
  })
  return {
    status: 'completed',
    message: uiMessage(reply),
    thread: chat.threadSummary(chat.requireThread(turn.thread.id)),
  }
}

function figureLabelFor(blockId: number, pageNumber: number): string {
  const block = db.prepare('SELECT kind FROM block WHERE id = ?').get(blockId) as { kind: string } | undefined
  return `${block?.kind === 'table' ? 'Table' : 'Figure'} · page ${pageNumber}`
}

export function registerChatIpc(): void {
  const activeJobs = new Map<string, { controller: AbortController; sender: WebContents }>()

  const stopJob = (requestId: string, sender?: WebContents): boolean => {
    const job = activeJobs.get(requestId)
    if (!job || (sender && job.sender.id !== sender.id)) return false
    job.controller.abort()
    return true
  }
  const stopSenderJobs = (sender: WebContents) => {
    for (const [requestId, job] of activeJobs) {
      if (job.sender.id === sender.id) stopJob(requestId, sender)
    }
  }

  ipcMain.handle('chat:list', () => chat.listThreads())
  ipcMain.handle('chat:history', (_e, req: { docId: number; threadId: number }) => {
    chat.requireThread(req.threadId, req.docId)
    return chat.history(req.threadId).map(uiMessage)
  })
  ipcMain.handle('chat:send', async (event, req: ChatSendRequest) => {
    if (!req.requestId.trim()) throw new Error('A chat request ID is required.')
    if (activeJobs.has(req.requestId)) throw new Error('That chat request is already running.')
    if ([...activeJobs.values()].some((job) => job.sender.id === event.sender.id)) {
      throw new Error('Another chat request is already running.')
    }
    const controller = new AbortController()
    const sender = event.sender
    activeJobs.set(req.requestId, { controller, sender })
    const onDestroyed = () => stopJob(req.requestId)
    sender.once('destroyed', onDestroyed)
    try {
      return await sendChat(req, {
        signal: controller.signal,
        onDelta: (text) => {
          if (!text || sender.isDestroyed() || activeJobs.get(req.requestId)?.sender !== sender) return
          const delta: ChatDelta = { requestId: req.requestId, text }
          sender.send('chat:delta', delta)
        },
        onThreadUpdate: (update) => {
          if (!sender.isDestroyed()) sender.send('chat:thread-update', update)
        },
      })
    } finally {
      sender.removeListener('destroyed', onDestroyed)
      if (activeJobs.get(req.requestId)?.controller === controller) activeJobs.delete(req.requestId)
    }
  })
  ipcMain.handle('chat:stop', (event, requestId: string) => stopJob(requestId, event.sender))
  ipcMain.handle('chat:command', (_e, req: { threadId?: number; text: string }) =>
    commands.execute(req.threadId, req.text),
  )
  ipcMain.handle('chat:clear', (_e, threadId: number) => void chat.clearMessages(threadId))
  ipcMain.handle('chat:clearAll', (event) => {
    stopSenderJobs(event.sender)
    return chat.clearAllChats()
  })
  ipcMain.handle('ai:getChoice', () => chat.aiChoice())
  ipcMain.handle('ai:setChoice', (_e, choice: AiChoice) => chat.setAiChoice(choice))
  // The raw stored value: the UI shows what is configured; fallback happens at task time.
  ipcMain.handle('ai:getBackgroundChoice', () => backgroundChoice())
  ipcMain.handle('ai:setBackgroundChoice', (_e, choice: AiChoice | null) => chat.setBackgroundAiChoice(choice))
  ipcMain.handle('ai:getProviders', () => chat.aiProviders())
}
