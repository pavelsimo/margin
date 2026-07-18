import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatDelta, ChatSendResult } from '@shared/ipc'
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
