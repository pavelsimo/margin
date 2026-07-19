export interface OpenAiRuntimeProfile {
  name: string
  baseUrl: string
  apiKey: string
}

export interface OpenAiRunOptions {
  model: string
  imagePng?: Buffer | null
  timeout: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

export interface OpenAiRunResult {
  ok: boolean
  text: string
  error: string
  cancelled?: boolean
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export function openAiEndpoint(baseUrl: string, resource: 'models' | 'chat/completions'): string {
  return `${baseUrl.replace(/\/+$/, '')}/${resource}`
}

export function openAiHeaders(apiKey: string, json = false): Record<string, string> {
  return {
    Accept: json ? 'text/event-stream, application/json' : 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

export function parseOpenAiModelList(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).data)) {
    throw new Error('The endpoint returned an invalid model list.')
  }
  const ids = ((value as Record<string, unknown>).data as unknown[]).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const id = (item as Record<string, unknown>).id
    return typeof id === 'string' && id.trim() ? [id.trim()] : []
  })
  return [...new Set(ids)]
}

export function buildOpenAiChatBody(prompt: string, model: string, imagePng?: Buffer | null): Record<string, unknown> {
  const content: string | Array<Record<string, unknown>> = imagePng
    ? [
        { type: 'text', text: prompt },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${imagePng.toString('base64')}` },
        },
      ]
    : prompt
  return { model, messages: [{ role: 'user', content }], stream: true }
}

function errorDetail(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const error = (value as Record<string, unknown>).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as Record<string, unknown>).message as string
  }
  return ''
}

function answerText(value: unknown, streaming: boolean): string {
  if (!value || typeof value !== 'object') return ''
  const choices = (value as Record<string, unknown>).choices
  if (!Array.isArray(choices) || !choices.length || !choices[0] || typeof choices[0] !== 'object') return ''
  const choice = choices[0] as Record<string, unknown>
  const container = streaming ? choice.delta : choice.message
  if (!container || typeof container !== 'object') return ''
  const content = (container as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const text = (part as Record<string, unknown>).text
    return typeof text === 'string' ? [text] : []
  }).join('')
}

export function parseOpenAiJsonResponse(value: unknown): string {
  const error = errorDetail(value)
  if (error) throw new Error(error)
  return answerText(value, false).trim()
}

export interface OpenAiSseEvent {
  done: boolean
  text: string
  error: string
}

export function parseOpenAiSseEvent(block: string): OpenAiSseEvent {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
    .trim()
  if (!data) return { done: false, text: '', error: '' }
  if (data === '[DONE]') return { done: true, text: '', error: '' }
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    return { done: false, text: '', error: 'The endpoint returned a malformed streaming response.' }
  }
  return { done: false, text: answerText(value, true), error: errorDetail(value) }
}

async function responseError(response: Response): Promise<string> {
  const raw = (await response.text().catch(() => '')).trim().slice(0, 2_000)
  if (raw) {
    try {
      const detail = errorDetail(JSON.parse(raw))
      if (detail) return detail
    } catch {
      // Plain-text errors are common among local compatibility servers.
    }
    return raw.split('\n').at(-1) ?? raw
  }
  return response.statusText || `HTTP ${response.status}`
}

export async function fetchOpenAiModels(
  profile: OpenAiRuntimeProfile,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await fetcher(openAiEndpoint(profile.baseUrl, 'models'), {
    method: 'GET',
    headers: openAiHeaders(profile.apiKey),
    signal,
  })
  if (!response.ok) throw new Error(`${profile.name} returned HTTP ${response.status}: ${await responseError(response)}`)
  return parseOpenAiModelList(await response.json())
}

export async function runOpenAiChat(
  profile: OpenAiRuntimeProfile,
  prompt: string,
  opts: OpenAiRunOptions,
  fetcher: FetchLike,
): Promise<OpenAiRunResult> {
  const controller = new AbortController()
  let timedOut = false
  let streamedText = ''
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const abort = () => {
    controller.abort(opts.signal?.reason)
    void activeReader?.cancel().catch(() => {})
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
    void activeReader?.cancel().catch(() => {})
  }, opts.timeout * 1_000)
  timer.unref()
  opts.signal?.addEventListener('abort', abort, { once: true })
  try {
    if (opts.signal?.aborted) return { ok: false, text: '', error: '', cancelled: true }
    const response = await fetcher(openAiEndpoint(profile.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: openAiHeaders(profile.apiKey, true),
      body: JSON.stringify(buildOpenAiChatBody(prompt, opts.model, opts.imagePng)),
      signal: controller.signal,
    })
    if (!response.ok) {
      return { ok: false, text: '', error: `${profile.name} returned HTTP ${response.status}: ${await responseError(response)}` }
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.includes('text/event-stream')) {
      const text = parseOpenAiJsonResponse(await response.json())
      return text
        ? { ok: true, text, error: '' }
        : { ok: false, text: '', error: `${profile.name} returned an empty response.` }
    }
    if (!response.body) return { ok: false, text: '', error: `${profile.name} returned an empty response.` }

    const reader = response.body.getReader()
    activeReader = reader
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      buffer += decoder.decode(chunk.value, { stream: !done })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const event = parseOpenAiSseEvent(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event.error) return { ok: false, text: '', error: `${profile.name} failed: ${event.error}` }
        if (event.text) {
          streamedText += event.text
          opts.onDelta?.(event.text)
        }
        if (event.done) done = true
        boundary = buffer.indexOf('\n\n')
      }
    }
    if (buffer.trim()) {
      const event = parseOpenAiSseEvent(buffer)
      if (event.error) return { ok: false, text: '', error: `${profile.name} failed: ${event.error}` }
      if (event.text) {
        streamedText += event.text
        opts.onDelta?.(event.text)
      }
    }
    if (opts.signal?.aborted) return { ok: false, text: streamedText.trim(), error: '', cancelled: true }
    if (timedOut) {
      return { ok: false, text: '', error: `${profile.name} didn't answer within ${opts.timeout}s. Try again or ask something smaller.` }
    }
    const text = streamedText.trim()
    return text
      ? { ok: true, text, error: '' }
      : { ok: false, text: '', error: `${profile.name} returned an empty response.` }
  } catch (error) {
    if (opts.signal?.aborted) return { ok: false, text: streamedText.trim(), error: '', cancelled: true }
    if (timedOut) {
      return { ok: false, text: '', error: `${profile.name} didn't answer within ${opts.timeout}s. Try again or ask something smaller.` }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, text: '', error: `${profile.name} failed: ${detail}` }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', abort)
  }
}
