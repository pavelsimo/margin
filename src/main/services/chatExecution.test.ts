import { describe, expect, it, vi } from 'vitest'
import type { AiChoice, ChatSendRequest } from '@shared/ipc'
import type { ChatMessageRow, ChatThreadRow, DocumentRow } from '@shared/models'
import { createChatExecution, type ChatExecutionDependencies } from './chatExecution'
import { ExecutionCoordinator } from './executionCoordinator'
import { DEFAULT_PROMPTS, assemblePrompt } from './promptCore'
import type { ProviderRequest, ProviderResult } from './providers/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}
const request: ChatSendRequest = { requestId: 'request', threadId: 20, docId: 10, mode: 'ask', scope: 'page',
  pageNumber: 1, question: 'Why?', contextText: '' }
function fixture() {
  const coordinator = new ExecutionCoordinator()
  const messages: ChatMessageRow[] = []
  const thread: ChatThreadRow = { id: 20, document_id: 10, user_id: 1, title: 'New chat', created_at: 'now', updated_at: 'now' }
  const document = { id: 10, user_id: 1, title: 'Paper' } as DocumentRow
  const pending = deferred<ProviderResult>()
  const title = deferred<ProviderResult>()
  const started = deferred<ProviderRequest>()
  const titleStarted = deferred<ProviderRequest>()
  const snapshots: AiChoice[] = []
  const dispose = vi.fn(async () => {})
  let settings: AiChoice = { provider: 'claude', model: 'first', effort: 'low' }
  const deps: ChatExecutionDependencies = {
    coordinator, timeoutSeconds: 180,
    getDocument: () => document,
    pages: () => [{ number: 1, text: 'Page one' }, { number: 2, text: 'Page two' }],
    figure: () => ({ pageNumber: 2, kind: 'table', bounds: [0, 0, 1, 1] }),
    renderRegion: vi.fn(() => Buffer.from('png')),
    requireThread: () => thread,
    addUserTurn(args) {
      const message = { id: messages.length + 1, thread_id: 20, document_id: 10, user_id: 1, role: 'user', content: args.content,
        context_text: args.contextText ?? '', mode: args.mode, scope: args.scope, page_number: args.pageNumber, created_at: 'now' } as ChatMessageRow
      messages.push(message)
      return { thread, message, created: !args.threadId }
    },
    addAssistantMessage: vi.fn((args) => {
      const message = { id: messages.length + 1, thread_id: 20, document_id: 10, user_id: 1, role: 'assistant', content: args.content,
        context_text: '', mode: args.mode, scope: args.scope, page_number: args.pageNumber, created_at: 'now', outcome: args.outcome } as ChatMessageRow
      messages.push(message)
      return message
    }),
    history: (_id, limit) => limit ? messages.slice(-limit) : messages,
    updateThreadTitle: vi.fn((_id, value) => ({ ...thread, title: value })),
    threadSummary: (value) => ({ id: value.id, documentId: value.document_id, title: value.title, createdAt: value.created_at, updatedAt: value.updated_at }),
    choice: () => settings, backgroundChoice: () => ({ ...settings, model: 'background' }),
    template: () => DEFAULT_PROMPTS.ask,
    captureProvider: vi.fn(async (choice) => {
      const profile = { ...choice }
      snapshots.push(profile)
      return { profile, adapter: { capabilities: { streaming: true, images: true, nativeSessions: false, structuredOutput: false, modelOptions: [] },
        dispose,
        execute: (input: ProviderRequest) => {
          if (input.task === 'title') { titleStarted.resolve(input); return title.promise }
          started.resolve(input)
          return pending.promise
        },
      } }
    }),
  }
  const service = createChatExecution(deps)
  return { deps, service, coordinator, messages, thread, pending, title, started, titleStarted, snapshots, dispose,
    changeSettings: (choice: AiChoice) => { settings = choice } }
}

describe('chat orchestration', () => {
  it('preserves prompts, captures settings once, and persists exactly one answer', async () => {
    const f = fixture()
    const response = f.service.send(request, { ownerId: 1 })
    const input = await f.started.promise
    f.changeSettings({ provider: 'codex', model: 'next', effort: 'high' })
    expect(input.profile).toEqual({ provider: 'claude', model: 'first', effort: 'low' })
    expect(input.prompt).toBe(assemblePrompt(DEFAULT_PROMPTS.ask, { context: 'Page one', question: 'Why?', scopeLabel: 'page 1 of the paper' }))
    f.pending.resolve({ status: 'completed', text: 'answer' })
    const result = await response
    input.onEvent?.({ type: 'text', text: 'late' })
    expect(result.message).toMatchObject({ content: 'answer', outcome: 'completed' })
    expect(f.deps.addAssistantMessage).toHaveBeenCalledTimes(1)
    expect(f.dispose).toHaveBeenCalledOnce()
    expect(f.messages.map((m) => m.content)).toEqual(['Why?', 'answer'])
  })

  it.each(['thread', 'document', 'owner', 'all'] as const)('rejects delayed completion and text after clearing %s', async (kind) => {
    const f = fixture()
    const onDelta = vi.fn()
    const response = f.service.send(request, { ownerId: 1, onDelta })
    const rejected = expect(response).rejects.toThrow('changed')
    const input = await f.started.promise
    if (kind === 'thread') f.coordinator.invalidateThread(20)
    if (kind === 'document') f.coordinator.invalidateDocument(10)
    if (kind === 'owner') f.coordinator.invalidateOwner(1)
    if (kind === 'all') f.coordinator.invalidateChats()
    f.messages.length = 0
    input.onEvent?.({ type: 'text', text: 'late' })
    f.pending.resolve({ status: 'completed', text: 'late answer' })
    await rejected
    expect(input.signal.aborted).toBe(true)
    expect(f.messages).toEqual([])
    expect(onDelta).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it.each(['cancelled', 'timed_out', 'failed'] as const)('persists %s with the correct answer outcome', async (outcome) => {
    const f = fixture()
    const response = f.service.send(request)
    await f.started.promise
    f.pending.resolve(outcome === 'cancelled' ? { status: 'cancelled', text: 'partial' }
      : { status: 'failed', text: outcome === 'timed_out' ? 'partial' : '', error: {
        code: outcome === 'timed_out' ? 'timeout' : 'transport', message: 'Failure',
      } })
    const result = await response
    expect(result.status).toBe(outcome === 'cancelled' ? 'stopped' : 'completed')
    expect(result.message).toMatchObject({ outcome, content: outcome === 'failed' ? 'Failure' : 'partial', isError: outcome === 'failed' })
    expect(f.deps.addAssistantMessage).toHaveBeenCalledOnce()
  })

  it('does not persist an empty stopped answer', async () => {
    const f = fixture()
    const response = f.service.send(request)
    await f.started.promise
    f.pending.resolve({ status: 'cancelled', text: ' ' })
    expect(await response).toMatchObject({ status: 'stopped' })
    expect(f.deps.addAssistantMessage).not.toHaveBeenCalled()
  })

  it('isolates titles from chat and discards a title that finishes after clear', async () => {
    const f = fixture()
    const onThreadUpdate = vi.fn()
    const response = f.service.send({ ...request, threadId: undefined }, { ownerId: 1, onThreadUpdate })
    const input = await f.started.promise
    const titleInput = await f.titleStarted.promise
    expect(titleInput.profile.model).toBe('background')
    expect(titleInput.messages).toEqual([])
    expect(input.messages).toEqual([])
    f.pending.resolve({ status: 'completed', text: 'answer' })
    await response
    f.coordinator.invalidateThread(20)
    f.title.resolve({ status: 'completed', text: 'Late title' })
    await f.coordinator.shutdown()
    expect(f.deps.updateThreadTitle).not.toHaveBeenCalled()
    expect(onThreadUpdate).toHaveBeenCalledOnce()
  })

  it.each(['figure', 'region'] as const)('prepares %s context and attachments', async (kind) => {
    const f = fixture()
    const response = f.service.send({ ...request, ...(kind === 'figure' ? { imageBlockId: 50 }
      : { imageRegion: { x0: 0, y0: 0, x1: 1, y1: 1 }, imageRegionPage: 2 }) })
    const input = await f.started.promise
    expect(input.attachments[0].data.toString()).toBe('png')
    expect(input.prompt).toContain('page 2')
    expect(f.deps.renderRegion).toHaveBeenCalledWith(expect.anything(), 2, [0, 0, 1, 1])
    f.pending.resolve({ status: 'completed', text: 'answer' })
    await response
  })

  it('rejects image blocks from other papers before persisting or launching', async () => {
    const f = fixture()
    f.deps.figure = () => undefined
    await expect(f.service.send({ ...request, imageBlockId: 50 })).rejects.toThrow('does not belong')
    expect(f.messages).toEqual([])
    expect(f.deps.captureProvider).not.toHaveBeenCalled()
  })

  it('does not launch after invalidation while credentials are being resolved', async () => {
    const f = fixture()
    const capture = deferred<Awaited<ReturnType<ChatExecutionDependencies['captureProvider']>>>()
    const original = f.deps.captureProvider
    f.deps.captureProvider = () => capture.promise
    const response = f.service.send(request)
    const rejected = expect(response).rejects.toThrow('changed')
    f.coordinator.invalidateThread(20)
    const provider = await original({ provider: 'claude', model: 'first', effort: '' })
    const execute = vi.spyOn(provider.adapter, 'execute')
    capture.resolve(provider)
    await rejected
    expect(execute).not.toHaveBeenCalled()
    expect(f.dispose).toHaveBeenCalledOnce()
  })
})
