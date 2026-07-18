import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockRow } from '@shared/models'
import type { ChatDelta, ChatSendResult, CliExecutableSettings } from '@shared/ipc'
import type { Provider } from '@shared/constants'
import { useReaderStore } from './readerStore'

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
      message: {
        id: 10,
        role: 'assistant',
        content: 'A late answer',
        contextText: '',
        mode: 'ask',
        isError: false,
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
      message: { id: 3, role: 'assistant', content: 'hello world', contextText: '', mode: 'ask', isError: false },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useReaderStore.getState().typing).toBe(false)
    expect(useReaderStore.getState().activeRequestId).toBe('')
    expect(useReaderStore.getState().messages).toHaveLength(2)
    expect(useReaderStore.getState().messages.at(-1)?.content).toBe('hello world')
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
    resolveReply({ status: 'stopped' })
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

describe('detected CLI providers', () => {
  function executableSettings(detected: Provider[]): CliExecutableSettings {
    return Object.fromEntries(
      (['claude', 'codex', 'antigravity'] as const).map((provider) => [provider, {
        customPath: '',
        effectiveCommand: provider,
        source: 'path',
        detected: detected.includes(provider),
        resolvedPath: detected.includes(provider) ? `/usr/bin/${provider}` : '',
      }]),
    ) as CliExecutableSettings
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only detected providers and leaves a detected selection alone', async () => {
    const invoke = vi.fn().mockResolvedValue(executableSettings(['claude', 'codex']))
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, detectedProviders: null })

    await useReaderStore.getState().refreshDetectedProviders()

    expect(useReaderStore.getState().detectedProviders).toEqual(['claude', 'codex'])
    expect(invoke).not.toHaveBeenCalledWith('ai:setChoice', expect.anything())
  })

  it('auto-switches to the first detected provider when the selection is missing', async () => {
    const invoke = vi.fn().mockImplementation((channel: string) => {
      if (channel === 'settings:getExecutables') return Promise.resolve(executableSettings(['codex']))
      return Promise.resolve({ provider: 'codex', model: '', effort: '' })
    })
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, detectedProviders: null })

    await useReaderStore.getState().refreshDetectedProviders()

    expect(invoke).toHaveBeenCalledWith('ai:setChoice', { provider: 'codex', model: '', effort: '' })
    expect(useReaderStore.getState().ai.provider).toBe('codex')
  })

  it('does not switch away when no provider is detected', async () => {
    const invoke = vi.fn().mockResolvedValue(executableSettings([]))
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, detectedProviders: null })

    await useReaderStore.getState().refreshDetectedProviders()

    expect(useReaderStore.getState().detectedProviders).toEqual([])
    expect(invoke).not.toHaveBeenCalledWith('ai:setChoice', expect.anything())
    expect(useReaderStore.getState().ai.provider).toBe('claude')
  })

  it('leaves prior detection state intact when the lookup fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('ipc failure'))
    vi.stubGlobal('window', { margin: { invoke } })
    useReaderStore.setState({ ai: { provider: 'claude', model: '', effort: '' }, detectedProviders: ['claude'] })

    await useReaderStore.getState().refreshDetectedProviders()

    expect(useReaderStore.getState().detectedProviders).toEqual(['claude'])
  })
})
