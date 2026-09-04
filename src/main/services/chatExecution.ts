import { randomUUID } from 'node:crypto'
import type { AiChoice, ChatSendRequest, ChatSendResult, ChatThreadSummary, ChatThreadUpdate, UiMessage } from '@shared/ipc'
import type { ChatMessageRow, ChatThreadRow, DocumentRow, PageRow } from '@shared/models'
import type { Mode } from '@shared/constants'
import type * as Chat from './chat'
import { ExecutionCoordinator, type ExecutionLease } from './executionCoordinator'
import { buildChatInput, imageContext, regionImageContext, textContext } from './chatContext'
import { MAX_HISTORY_MESSAGES } from './promptCore'
import { fallbackChatTitle, sanitizeGeneratedTitle } from './chatCore'
import { normalizeError } from './providers/adapter'
import type { ProviderAdapter, ProviderControls, ProviderResult } from './providers/types'

export interface ChatExecutionDependencies {
  coordinator: ExecutionCoordinator
  getDocument(id: number): DocumentRow | undefined
  pages(id: number, pageNumber?: number): Array<Pick<PageRow, 'number' | 'text'>>
  figure(id: number, documentId: number): { pageNumber: number; kind: string; bounds: [number, number, number, number] } | undefined
  renderRegion(document: DocumentRow, page: number, bounds: [number, number, number, number]): Buffer | null
  requireThread: typeof Chat.requireThread
  addUserTurn: typeof Chat.addUserTurn
  addAssistantMessage: typeof Chat.addAssistantMessage
  history: typeof Chat.history
  updateThreadTitle: typeof Chat.updateThreadTitle
  threadSummary(row: ChatThreadRow): ChatThreadSummary
  choice(): AiChoice
  backgroundChoice(): AiChoice
  template(mode: Mode): string
  captureProvider(choice: AiChoice, controls?: ProviderControls): Promise<{ profile: Readonly<AiChoice>; adapter: ProviderAdapter }>
  timeoutSeconds: number
}
export interface SendChatOptions {
  ownerId?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
  onThreadUpdate?: (update: ChatThreadUpdate) => void
}
export function uiMessage(message: ChatMessageRow): UiMessage {
  return { id: message.id, role: message.role, content: message.content, contextText: message.context_text,
    mode: message.mode, isError: message.mode === 'error', createdAt: message.created_at, outcome: message.outcome }
}

export function createChatExecution(deps: ChatExecutionDependencies) {
  async function titleThread(threadId: number, documentId: number, question: string, opts: SendChatOptions): Promise<void> {
    const lease = deps.coordinator.begin({ requestId: randomUUID(), task: 'title', threadId, documentId, ownerId: opts.ownerId })
    const deadline = Date.now() + 20_000
    let captured: Awaited<ReturnType<typeof deps.captureProvider>> | undefined
    try {
      const choice = deps.backgroundChoice()
      lease.captureProfile(choice)
      captured = await deps.captureProvider(choice, { signal: lease.signal, deadline })
      if (!lease.valid || lease.signal.aborted) return
      const prompt = 'Write a concise 3-7 word title for a research-paper chat whose first user question is below. ' +
        'Return only the title as plain text: no quotes, markdown, label, or punctuation at the end.\n\n' + question
      const result = await captured.adapter.execute({ requestId: lease.scope.requestId, task: 'title', profile: captured.profile,
        prompt, instructions: prompt, messages: [], attachments: [], deadline, signal: lease.signal })
      if (!lease.valid || lease.signal.aborted) return
      const generated = result.status === 'completed' ? sanitizeGeneratedTitle(result.text) : ''
      const row = deps.updateThreadTitle(threadId, generated || fallbackChatTitle(question))
      if (row) opts.onThreadUpdate?.({ thread: deps.threadSummary(row), reason: 'titled' })
    } catch {
      if (lease.valid && !lease.signal.aborted) {
        const row = deps.updateThreadTitle(threadId, fallbackChatTitle(question))
        if (row) opts.onThreadUpdate?.({ thread: deps.threadSummary(row), reason: 'titled' })
      }
    } finally {
      try { await captured?.adapter.dispose() } finally { lease.finish() }
    }
  }

  async function send(req: ChatSendRequest, opts: SendChatOptions = {}): Promise<ChatSendResult> {
    const lease = deps.coordinator.begin({ requestId: req.requestId, task: 'chat', ownerId: opts.ownerId,
      documentId: req.docId, threadId: req.threadId })
    const signal = opts.signal ? AbortSignal.any([opts.signal, lease.signal]) : lease.signal
    const deadline = Date.now() + deps.timeoutSeconds * 1_000
    let captured: Awaited<ReturnType<typeof deps.captureProvider>> | undefined
    try {
      const document = deps.getDocument(req.docId)
      if (!document) throw new Error('This paper no longer exists.')
      if (req.threadId) deps.requireThread(req.threadId, req.docId)
      let pages = req.imageRegion ? deps.pages(req.docId, req.imageRegionPage)
        : !req.imageBlockId && !req.contextText.trim()
          ? deps.pages(req.docId, req.scope === 'page' ? req.pageNumber : undefined) : []
      if (!req.imageRegion && !req.imageBlockId && !req.contextText.trim() && req.scope === 'page'
        && !pages.some((page) => page.number === req.pageNumber && page.text)) pages = deps.pages(req.docId)
      const figure = req.imageBlockId ? deps.figure(req.imageBlockId, req.docId) : undefined
      if (req.imageBlockId && !figure) throw new Error('This figure does not belong to the selected paper.')
      if (req.imageRegion && !pages.some((page) => page.number === req.imageRegionPage)) {
        throw new Error('This image region does not belong to a page in the selected paper.')
      }
      if (signal.aborted) throw new Error('This request was stopped before it started.')
      const choice = { ...deps.choice() }
      lease.captureProfile(choice)
      const imageLabel = req.imageRegion ? `Region · page ${req.imageRegionPage}`
        : figure ? `${figure.kind === 'table' ? 'Table' : 'Figure'} · page ${req.pageNumber}` : ''
      const turn = deps.addUserTurn({ threadId: req.threadId, documentId: req.docId, content: req.question,
        contextText: req.contextText || imageLabel, mode: req.mode, scope: req.scope, pageNumber: req.imageRegionPage || req.pageNumber })
      lease.bindThread(turn.thread.id)
      opts.onThreadUpdate?.({ thread: deps.threadSummary(turn.thread), reason: turn.created ? 'created' : 'updated', requestId: req.requestId })
      if (turn.created && lease.valid) void titleThread(turn.thread.id, req.docId, req.question, opts).catch(() => {})

      let result: ProviderResult
      let contextFailure = ''
      try {
        let context: [string, string]
        let imagePng: Buffer | null = null
        if (req.imageRegion) {
          const region = req.imageRegion
          imagePng = deps.renderRegion(document, req.imageRegionPage!, [region.x0, region.y0, region.x1, region.y1])
          context = regionImageContext(req.imageRegionPage!)
          if (!imagePng) {
            contextFailure = "Couldn't extract that selected region from the PDF."
            throw new Error(contextFailure)
          }
        } else if (figure) {
          imagePng = deps.renderRegion(document, figure.pageNumber, figure.bounds)
          context = imageContext(figure.pageNumber)
          if (!imagePng) {
            contextFailure = "Couldn't extract that figure from the PDF."
            throw new Error(contextFailure)
          }
        } else context = textContext(document, pages, { scope: req.scope, pageNumber: req.pageNumber, selectedText: req.contextText })
        const input = buildChatInput({ request: req, template: deps.template(req.mode), context, imagePng, contextPageNumber: figure?.pageNumber,
          history: deps.history(turn.thread.id, MAX_HISTORY_MESSAGES + 1).slice(0, -1) })
        captured = await deps.captureProvider(choice, { signal, deadline })
        if (!lease.valid) throw new Error('This request is no longer active.')
        result = await captured.adapter.execute({ ...input, requestId: req.requestId, task: 'chat', profile: captured.profile,
          deadline, signal, onEvent: (event) => {
            if (lease.valid && !signal.aborted) opts.onDelta?.(event.text)
          } })
      } catch (error) {
        result = signal.aborted ? { status: 'cancelled', text: '' } : { status: 'failed', text: '', error: contextFailure
          ? { code: 'configuration', message: contextFailure } : normalizeError(String(error)) }
      }
      assertCurrent(lease)
      const stopped = result.status === 'cancelled'
      const timedOut = result.status === 'failed' && result.error.code === 'timeout'
      const partial = (stopped || timedOut) && result.text.trim()
      if (stopped && !partial) return { status: 'stopped', thread: deps.threadSummary(deps.requireThread(turn.thread.id)) }
      const isError = result.status === 'failed' && !partial
      const reply = deps.addAssistantMessage({ threadId: turn.thread.id, documentId: req.docId,
        content: result.status === 'failed' && !partial ? result.error.message : result.text.trim(),
        mode: isError ? 'error' : req.mode, scope: req.scope, pageNumber: req.imageRegionPage || req.pageNumber,
        outcome: stopped ? 'cancelled' : timedOut ? 'timed_out' : result.status === 'failed' ? 'failed' : 'completed' })
      return { status: stopped ? 'stopped' : 'completed', message: uiMessage(reply), thread: deps.threadSummary(deps.requireThread(turn.thread.id)) }
    } finally {
      try { await captured?.adapter.dispose() } finally { lease.finish() }
    }
  }
  return { send }
}
function assertCurrent(lease: ExecutionLease): void {
  if (!lease.valid) throw new Error('This chat changed while the answer was being generated.')
}
