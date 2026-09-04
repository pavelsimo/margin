// Main-process composition and compatibility API for independent AI requests.
import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiProviderId } from '@shared/constants'
import type { AiChoice } from '@shared/ipc'
import { executableInfo, openAiApiKey, openAiProfile } from './executableSettings'
import { createProviderRegistry } from './providers/registry'
import { normalizeError } from './providers/adapter'
import type { AIResult, RunOpts } from './providers/legacy'
import type { ProviderInput, ProviderResult, TaskKind } from './providers/types'

export { buildCommand, parseClaudeStreamLine, parseCodexStreamLine } from './aiCore'
export type { AIResult, RunOpts }
export const AI_TIMEOUT = Number(process.env.AI_TIMEOUT || 180)
const registry = createProviderRegistry({ executableInfo, openAiApiKey, openAiProfile, fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init) })
export const captureProvider = (choice: AiChoice) => registry.resolve(choice)
export type CapturedProvider = Awaited<ReturnType<typeof captureProvider>>

export function legacyResult(result: ProviderResult): AIResult {
  if (result.status === 'completed') return { ok: true, text: result.text, error: '' }
  if (result.status === 'cancelled') return { ok: false, text: result.text, error: '', cancelled: true }
  return { ok: false, text: result.text, error: result.error.message, errorCode: result.error.code }
}

export async function runPrompt(provider: AiProviderId, prompt: string, opts: RunOpts & { task?: TaskKind } = {}): Promise<AIResult> {
  const input: ProviderInput = { prompt, instructions: prompt, messages: [], attachments: opts.imagePng
    ? [{ name: 'figure.png', mediaType: 'image/png', data: opts.imagePng }] : [] }
  let captured: CapturedProvider | undefined
  try {
    if (opts.signal?.aborted) return { ok: false, text: '', error: '', cancelled: true }
    captured = await captureProvider({ provider, model: opts.model ?? '', effort: opts.effort ?? '' })
    return legacyResult(await captured.adapter.execute({ ...input, requestId: randomUUID(), task: opts.task ?? 'chat',
      profile: captured.profile, deadline: Date.now() + (opts.timeout ?? AI_TIMEOUT) * 1_000,
      signal: opts.signal ?? new AbortController().signal, onEvent: (event) => opts.onDelta?.(event.text),
    }))
  } catch (error) {
    return legacyResult({ status: 'failed', text: '', error: normalizeError(String(error)) })
  } finally {
    await captured?.adapter.dispose()
  }
}
