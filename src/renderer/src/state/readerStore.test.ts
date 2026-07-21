import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockRow } from '@shared/models'
import type { AiProviderInfo, ChatDelta, ChatSendResult, ChatThreadSummary, DocumentInfo } from '@shared/ipc'
import { ZOOM_LEVELS } from '@shared/constants'
import { useReaderStore } from './readerStore'

const readyDocument: DocumentInfo = {
  id: 42,
  title: 'Test paper',
  authors: '',
  pageCount: 5,
  ready: true,
  failed: false,
  failMessage: '',
  scanned: false,
}

const thread: ChatThreadSummary = {
  id: 99,
  documentId: 42,
  title: 'Test chat',
  createdAt: '2026-01-01 00:00:00.000000',
  updatedAt: '2026-01-01 00:00:00.000000',
}

describe('reader navigation and zoom boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not move before the first or after the last page', () => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ doc: readyDocument, currentPage: 1 })

    useReaderStore.getState().prevPage()
    expect(useReaderStore.getState().currentPage).toBe(1)

    useReaderStore.setState({ currentPage: readyDocument.pageCount })
    useReaderStore.getState().nextPage()
    expect(useReaderStore.getState().currentPage).toBe(readyDocument.pageCount)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not zoom outside the supported PDF zoom levels', () => {
    useReaderStore.setState({ zoom: ZOOM_LEVELS[0] })
    useReaderStore.getState().zoomOut()
    expect(useReaderStore.getState().zoom).toBe(ZOOM_LEVELS[0])

    useReaderStore.setState({ zoom: ZOOM_LEVELS[ZOOM_LEVELS.length - 1] })
    useReaderStore.getState().zoomIn()
    expect(useReaderStore.getState().zoom).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1])
  })
})

describe('reader chat history invalidation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not redisplay a response that finishes after all history is cleared', async () => {
    let resolveReply!: (reply: ChatSendResult) => void
    const invoke = vi.fn().mockReturnValue(
      new Promise<ChatSendResult>((resolve) => {
        resolveReply = resolve
      }),
    )
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({
      documentId: 42,
      currentPage: 1,
      messages: [],
      historyGeneration: 0,
      inputText: 'What does this mean?',
      typing: false,
      activeRequestId: '',
    })

    useReaderStore.getState().send()
    expect(useReaderStore.getState().messages).toHaveLength(2)
    expect(useReaderStore.getState().typing).toBe(true)

    useReaderStore.getState().clearAllChatHistory()
    resolveReply({
      status: 'completed',
      thread,
      message: {
        id: 10,
        role: 'assistant',
        content: 'A late answer',
        contextText: '',
        mode: 'ask',
        isError: false,
        createdAt: '2026-01-01 00:01:00.000000',
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useReaderStore.getState().messages).toEqual([])
    expect(useReaderStore.getState().typing).toBe(false)
    expect(useReaderStore.getState().historyGeneration).toBe(1)
  })

  it('updates one assistant draft from deltas and settles it with the persisted response', async () => {
    let resolveReply!: (reply: ChatSendResult) => void
    let onDelta!: (delta: ChatDelta) => void
    const invoke = vi.fn().mockReturnValue(
      new Promise<ChatSendResult>((resolve) => {
        resolveReply = resolve
      }),
    )
    vi.stubGlobal('window', {
      margin: {
        invoke,
        onChatDelta: (listener: (delta: ChatDelta) => void) => {
          onDelta = listener
          return vi.fn()
        },
      },
    })
    useReaderStore.setState({
      documentId: 7,
      currentPage: 1,
      messages: [],
      historyGeneration: 0,
      inputText: 'Stream this',
      typing: false,
      activeRequestId: '',
    })

    useReaderStore.getState().send()
    const requestId = useReaderStore.getState().activeRequestId
    onDelta({ requestId, text: 'hello ' })
    onDelta({ requestId, text: '\\(x\\)' })
    expect(useReaderStore.getState().messages.at(-1)?.content).toBe('hello $x$')

    resolveReply({
      status: 'completed',
      thread: { ...thread, documentId: 7 },
      message: {
        id: 3,
        role: 'assistant',
        content: 'hello world',
        contextText: '',
        mode: 'ask',
        isError: false,
        createdAt: '2026-01-01 00:01:00.000000',
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useReaderStore.getState().typing).toBe(false)
    expect(useReaderStore.getState().activeRequestId).toBe('')
    expect(useReaderStore.getState().messages).toHaveLength(2)
    expect(useReaderStore.getState().messages.at(-1)?.content).toBe('hello world')
    expect(useReaderStore.getState().messages.at(-1)?.rawContent).toBe('hello world')
    expect(useReaderStore.getState().messages.at(-1)?.createdAt).toBe('2026-01-01 00:01:00.000000')
  })

  it('removes an empty assistant draft when a request is stopped before any text arrives', async () => {
    let resolveReply!: (reply: ChatSendResult) => void
    const invoke = vi.fn().mockReturnValue(
      new Promise<ChatSendResult>((resolve) => {
        resolveReply = resolve
      }),
    )
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({
      documentId: 8,
      currentPage: 1,
      messages: [],
      historyGeneration: 0,
      inputText: 'Stop this',
      typing: false,
      activeRequestId: '',
    })

    useReaderStore.getState().send()
    resolveReply({ status: 'stopped', thread: { ...thread, documentId: 8 } })
    await Promise.resolve()
    await Promise.resolve()

    expect(useReaderStore.getState().messages).toHaveLength(1)
    expect(useReaderStore.getState().messages[0].role).toBe('user')
    expect(useReaderStore.getState().typing).toBe(false)
  })

  it('stops the active request by its request ID', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ activeRequestId: 'request-123', typing: true })

    useReaderStore.getState().stop()

    expect(invoke).toHaveBeenCalledWith('chat:stop', 'request-123')
  })

  it('clears the active thread synchronously before opening a new chat', () => {
    const invoke = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({
      documentId: 42,
      doc: readyDocument,
      activeThreadId: thread.id,
      activeThread: thread,
      activeRequestId: 'request-456',
      typing: true,
      messages: [{ key: 1, role: 'user', content: 'Old chat', ctx: '', isError: false }],
      inputText: 'Old draft',
    })

    useReaderStore.getState().startNewChat(42)

    expect(invoke).toHaveBeenCalledWith('chat:stop', 'request-456')
    expect(useReaderStore.getState().activeThreadId).toBe(0)
    expect(useReaderStore.getState().activeThread).toBeNull()
    expect(useReaderStore.getState().messages).toEqual([])
    expect(useReaderStore.getState().inputText).toBe('')
    expect(useReaderStore.getState().typing).toBe(false)
  })

  it('activates a lazily created thread only for the matching request', () => {
    useReaderStore.setState({ documentId: 42, activeThreadId: 0, activeThread: null, activeRequestId: 'request-1' })

    useReaderStore.getState().applyThreadUpdate({
      thread,
      reason: 'created',
      requestId: 'other-request',
    })
    expect(useReaderStore.getState().activeThreadId).toBe(0)

    useReaderStore.getState().applyThreadUpdate({ thread, reason: 'created', requestId: 'request-1' })
    expect(useReaderStore.getState().activeThreadId).toBe(thread.id)

    const titled = { ...thread, title: 'Generated title' }
    useReaderStore.getState().applyThreadUpdate({ thread: titled, reason: 'titled' })
    expect(useReaderStore.getState().activeThread?.title).toBe('Generated title')
  })
})

describe('reader thread loading', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores an older paper load that resolves after a newer one', async () => {
    let resolveFirst!: (doc: DocumentInfo) => void
    let resolveSecond!: (doc: DocumentInfo) => void
    const first = new Promise<DocumentInfo>((resolve) => { resolveFirst = resolve })
    const second = new Promise<DocumentInfo>((resolve) => { resolveSecond = resolve })
    const invoke = vi.fn((channel: string, arg?: unknown) => {
      if (channel === 'document:get') return arg === 1 ? first : second
      if (channel === 'chat:list') return Promise.resolve([])
      if (channel === 'ai:getChoice') return Promise.resolve({ provider: 'claude', model: '', effort: '' })
      if (channel === 'ai:getProviders') return Promise.resolve([])
      if (channel === 'page:get') return Promise.resolve({ imageUrl: '', width: 0, height: 0, blocks: [] })
      return Promise.resolve(undefined)
    })
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ activeRequestId: '', documentId: 0, doc: null })

    const firstLoad = useReaderStore.getState().loadReader(1, null)
    const secondLoad = useReaderStore.getState().loadReader(2, null)
    resolveSecond({ ...readyDocument, id: 2, title: 'Second paper' })
    await secondLoad
    resolveFirst({ ...readyDocument, id: 1, title: 'First paper' })
    await firstLoad

    expect(useReaderStore.getState().documentId).toBe(2)
    expect(useReaderStore.getState().doc?.title).toBe('Second paper')
  })

  it('preserves source content and timestamps when loading persisted history', async () => {
    const historyMessage = {
      id: 11,
      role: 'assistant' as const,
      content: 'Use \\(x\\) in **Markdown**.',
      contextText: '',
      mode: 'ask',
      isError: false,
      createdAt: '2026-01-01 12:34:00.000000',
    }
    const invoke = vi.fn((channel: string) => {
      if (channel === 'document:get') return Promise.resolve(readyDocument)
      if (channel === 'chat:list') return Promise.resolve([thread])
      if (channel === 'chat:history') return Promise.resolve([historyMessage])
      if (channel === 'ai:getChoice') return Promise.resolve({ provider: 'claude', model: '', effort: '' })
      if (channel === 'ai:getProviders') return Promise.resolve([])
      if (channel === 'page:get') return Promise.resolve({ imageUrl: '', width: 0, height: 0, blocks: [] })
      return Promise.resolve(undefined)
    })
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ activeRequestId: '', documentId: 0, doc: null, messages: [] })

    await useReaderStore.getState().loadReader(readyDocument.id, thread.id)

    expect(useReaderStore.getState().messages).toMatchObject([{
      role: 'assistant',
      content: 'Use $x$ in **Markdown**.',
      rawContent: historyMessage.content,
      createdAt: historyMessage.createdAt,
    }])
  })
})

describe('selection thumbnail preview', () => {
  const figureBlock: BlockRow = {
    id: 1,
    page_id: 1,
    kind: 'image',
    text: '',
    order_index: 0,
    x0: 0.1,
    y0: 0.2,
    x1: 0.6,
    y1: 0.5,
  }

  function seedStore(): void {
    useReaderStore.setState({
      documentId: 42,
      currentPage: 3,
      pageBlocks: [figureBlock],
      selectedBlockIds: [],
      selectionAnchorId: 0,
      selectedRegion: [],
      selectedRegionPage: 0,
      selectedText: '',
      selectedKind: '',
      selectionThumb: '',
      chipText: '',
      chipBlockId: 0,
      chipRegion: [],
      chipRegionPage: 0,
      chipLabel: '',
      chipBlockCount: 0,
      chipThumb: '',
    })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads a thumbnail when a figure block is selected and carries it into the chip on Ask', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    vi.stubGlobal('window', { margin: { invoke } })
    seedStore()

    useReaderStore.getState().selectBlock(1, {})
    expect(invoke).toHaveBeenCalledWith('page:renderRegion', {
      docId: 42,
      pageNumber: 3,
      bbox: [0.1, 0.2, 0.6, 0.5],
    })
    await Promise.resolve()
    expect(useReaderStore.getState().selectionThumb).toBe('data:image/png;base64,abc')

    useReaderStore.getState().askSelection()
    expect(useReaderStore.getState().chipThumb).toBe('data:image/png;base64,abc')
    expect(useReaderStore.getState().selectionThumb).toBe('')
  })

  it('attaches a thumbnail that resolves after pinning to the chip instead', async () => {
    let resolveThumb!: (thumb: string) => void
    const invoke = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveThumb = resolve
      }),
    )
    vi.stubGlobal('window', { margin: { invoke } })
    seedStore()

    useReaderStore.getState().selectBlock(1, {})
    useReaderStore.getState().askSelection()
    expect(useReaderStore.getState().chipThumb).toBe('')

    resolveThumb('data:image/png;base64,late')
    await Promise.resolve()
    expect(useReaderStore.getState().chipThumb).toBe('data:image/png;base64,late')
  })

  it('loads a thumbnail for an exact region selection', async () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,region')
    vi.stubGlobal('window', { margin: { invoke } })
    seedStore()

    useReaderStore.getState().selectRegion({ kind: 'region', x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.8 })
    expect(invoke).toHaveBeenCalledWith('page:renderRegion', {
      docId: 42,
      pageNumber: 3,
      bbox: [0.2, 0.3, 0.7, 0.8],
    })
    await Promise.resolve()
    expect(useReaderStore.getState().selectionThumb).toBe('data:image/png;base64,region')
  })

  it('discards a thumbnail that resolves after the selection or chip is cleared', async () => {
    let resolveThumb!: (thumb: string) => void
    const invoke = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveThumb = resolve
      }),
    )
    vi.stubGlobal('window', { margin: { invoke } })
    seedStore()

    useReaderStore.getState().selectBlock(1, {})
    useReaderStore.getState().askSelection()
    useReaderStore.getState().clearChip()

    resolveThumb('data:image/png;base64,stale')
    await Promise.resolve()
    expect(useReaderStore.getState().selectionThumb).toBe('')
    expect(useReaderStore.getState().chipThumb).toBe('')
  })

  it('does not request a thumbnail for text selections', () => {
    const invoke = vi.fn().mockResolvedValue('data:image/png;base64,abc')
    vi.stubGlobal('window', { margin: { invoke } })
    seedStore()
    useReaderStore.setState({ pageBlocks: [{ ...figureBlock, kind: 'text', text: 'Some paragraph.' }] })

    useReaderStore.getState().selectBlock(1, {})
    expect(invoke).not.toHaveBeenCalledWith('page:renderRegion', expect.anything())
    expect(useReaderStore.getState().selectionThumb).toBe('')
  })
})

describe('AI provider registry', () => {
  function providers(available: string[], includeOllama = false): AiProviderInfo[] {
    const result: AiProviderInfo[] = (['claude', 'codex', 'antigravity'] as const).map((provider) => ({
      id: provider,
      label: provider,
      kind: 'cli',
      models: [''],
      defaultModel: '',
      efforts: [''],
      available: available.includes(provider),
    }))
    if (includeOllama) result.push({
      id: 'openai-compatible:test',
      label: 'Ollama',
      kind: 'openai-compatible',
      models: ['llama3.2'],
      defaultModel: 'llama3.2',
      efforts: [''],
      available: true,
    })
    return result
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only detected providers and leaves a detected selection alone', async () => {
    const registry = providers(['claude', 'codex'])
    const invoke = vi.fn().mockResolvedValue(registry)
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, aiProviders: null })

    await useReaderStore.getState().refreshAiProviders()

    expect(useReaderStore.getState().aiProviders).toEqual(registry)
    expect(invoke).not.toHaveBeenCalledWith('ai:setChoice', expect.anything())
  })

  it('auto-switches to the first detected provider when the selection is missing', async () => {
    const invoke = vi.fn().mockImplementation((channel: string) => {
      if (channel === 'ai:getProviders') return Promise.resolve(providers(['codex']))
      return Promise.resolve({ provider: 'codex', model: '', effort: '' })
    })
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, aiProviders: null })

    await useReaderStore.getState().refreshAiProviders()

    expect(invoke).toHaveBeenCalledWith('ai:setChoice', { provider: 'codex', model: '', effort: '' })
    expect(useReaderStore.getState().ai.provider).toBe('codex')
  })

  it('does not switch away when no provider is detected', async () => {
    const registry = providers([])
    const invoke = vi.fn().mockResolvedValue(registry)
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, aiProviders: null })

    await useReaderStore.getState().refreshAiProviders()

    expect(useReaderStore.getState().aiProviders).toEqual(registry)
    expect(invoke).not.toHaveBeenCalledWith('ai:setChoice', expect.anything())
    expect(useReaderStore.getState().ai.provider).toBe('claude')
  })

  it('selects a configured compatible API with its default model', async () => {
    const registry = providers([], true)
    const invoke = vi.fn().mockImplementation((channel: string, choice?: unknown) => {
      if (channel === 'ai:getProviders') return Promise.resolve(registry)
      return Promise.resolve(choice)
    })
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, aiProviders: null })

    await useReaderStore.getState().refreshAiProviders()

    expect(invoke).toHaveBeenCalledWith('ai:setChoice', {
      provider: 'openai-compatible:test',
      model: 'llama3.2',
      effort: '',
    })
    expect(useReaderStore.getState().ai.model).toBe('llama3.2')
  })

  it('leaves prior detection state intact when the lookup fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('ipc failure'))
    vi.stubGlobal('window', { margin: { invoke } })
    const registry = providers(['claude'])
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, aiProviders: registry })

    await useReaderStore.getState().refreshAiProviders()

    expect(useReaderStore.getState().aiProviders).toEqual(registry)
  })
})
