import { describe, expect, it, vi } from 'vitest'
import {
  buildOpenAiChatBody,
  fetchOpenAiModels,
  openAiEndpoint,
  openAiHeaders,
  parseOpenAiModelList,
  parseOpenAiSseEvent,
  runOpenAiChat,
  type FetchLike,
} from './openAiCompatibleCore'

const profile = { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '' }

function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }), { headers: { 'content-type': 'text/event-stream' } })
}

describe('OpenAI-compatible protocol helpers', () => {
  it('builds endpoints and optional bearer headers', () => {
    expect(openAiEndpoint('http://localhost:11434/v1/', 'models')).toBe('http://localhost:11434/v1/models')
    expect(openAiHeaders('')).toEqual({ Accept: 'application/json' })
    expect(openAiHeaders('secret', true)).toMatchObject({
      Accept: 'text/event-stream, application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret',
    })
  })

  it('parses, trims, and de-duplicates model identifiers', () => {
    expect(parseOpenAiModelList({ data: [{ id: 'llama3.2' }, { id: ' qwen3 ' }, { id: 'llama3.2' }] }))
      .toEqual(['llama3.2', 'qwen3'])
    expect(() => parseOpenAiModelList({ models: [] })).toThrow('invalid model list')
  })

  it('builds text and base64 image chat messages', () => {
    expect(buildOpenAiChatBody('hello', 'model-a')).toEqual({
      model: 'model-a',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    })
    const body = buildOpenAiChatBody('inspect', 'vision', Buffer.from('png'))
    expect(body).toMatchObject({
      messages: [{ content: [
        { type: 'text', text: 'inspect' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,cG5n' } },
      ] }],
    })
  })

  it('parses answer events, done markers, and structured errors', () => {
    expect(parseOpenAiSseEvent('data: {"choices":[{"delta":{"content":"hello"}}]}'))
      .toEqual({ done: false, text: 'hello', error: '' })
    expect(parseOpenAiSseEvent('data: [DONE]')).toEqual({ done: true, text: '', error: '' })
    expect(parseOpenAiSseEvent('data: {"error":{"message":"bad model"}}').error).toBe('bad model')
  })
})

describe('OpenAI-compatible requests', () => {
  it('lists models with authentication without leaking it into the result', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer key' })
      return Response.json({ data: [{ id: 'one' }, { id: 'two' }] })
    }) as FetchLike

    await expect(fetchOpenAiModels({ ...profile, apiKey: 'key' }, fetcher)).resolves.toEqual(['one', 'two'])
    expect(fetcher).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.objectContaining({ method: 'GET' }))
  })

  it('streams deltas across arbitrary UTF-8 and SSE chunk boundaries', async () => {
    const deltas: string[] = []
    const fetcher = vi.fn(async () => streamingResponse([
      'data: {"choices":[{"delta":{"content":"hé',
      'llo "}}]}\r\n\r',
      '\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n',
    ])) as FetchLike

    const result = await runOpenAiChat(profile, 'hello', {
      model: 'llama3.2',
      timeout: 1,
      onDelta: (text) => deltas.push(text),
    }, fetcher)

    expect(result).toEqual({ ok: true, text: 'héllo world', error: '' })
    expect(deltas).toEqual(['héllo ', 'world'])
  })

  it('accepts a non-streaming JSON fallback and reports HTTP errors concisely', async () => {
    const jsonFetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'plain answer' } }] })) as FetchLike
    await expect(runOpenAiChat(profile, 'hello', { model: 'm', timeout: 1 }, jsonFetcher))
      .resolves.toEqual({ ok: true, text: 'plain answer', error: '' })

    const errorFetcher = vi.fn(async () => Response.json(
      { error: { message: 'model not found' } },
      { status: 404 },
    )) as FetchLike
    const failed = await runOpenAiChat(profile, 'hello', { model: 'missing', timeout: 1 }, errorFetcher)
    expect(failed.ok).toBe(false)
    expect(failed.error).toBe('Ollama returned HTTP 404: model not found')
  })

  it('returns streamed partial text when the caller cancels', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'))
      },
      cancel() {},
    }), { headers: { 'content-type': 'text/event-stream' } })
    const fetcher = vi.fn(async () => response) as FetchLike
    const promise = runOpenAiChat(profile, 'hello', {
      model: 'm',
      timeout: 1,
      signal: controller.signal,
      onDelta: () => controller.abort(),
    }, fetcher)

    const result = await promise
    expect(result).toEqual({ ok: false, text: 'partial', error: '', cancelled: true })
  })

  it('aborts requests at the configured timeout', async () => {
    const fetcher = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })) as FetchLike

    const result = await runOpenAiChat(profile, 'hello', { model: 'm', timeout: 0.01 }, fetcher)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Ollama didn't answer within 0.01s")
  })
})
