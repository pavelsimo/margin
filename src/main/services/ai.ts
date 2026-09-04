// Main-process composition and compatibility API for independent AI requests.
import { net } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AiProviderId } from '@shared/constants'
import type { AiChoice } from '@shared/ipc'
import { executableInfo, openAiApiKey, openAiProfile } from './executableSettings'
import { createProviderRegistry } from './providers/registry'
import { executions, type ExecutionLease } from './executionCoordinator'
import { normalizeError } from './providers/adapter'
import type { AIResult, RunOpts } from './providers/legacy'
import type { ProviderControls, ProviderInput, ProviderResult, TaskKind } from './providers/types'

export { buildCommand, parseClaudeStreamLine, parseCodexStreamLine } from './aiCore'
export type { AIResult, RunOpts }
export const AI_TIMEOUT = Number(process.env.AI_TIMEOUT || 180)
const registry = createProviderRegistry({ executableInfo, openAiApiKey, openAiProfile, fetch: (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init) })
export const captureProvider = (choice: AiChoice, controls?: ProviderControls) => registry.resolve(choice, controls)
export type CapturedProvider = Awaited<ReturnType<typeof captureProvider>>

export function legacyResult(result: ProviderResult): AIResult {
  if (result.status === 'completed') return { ok: true, text: result.text, error: '' }
  if (result.status === 'cancelled') return { ok: false, text: result.text, error: '', cancelled: true }
  return { ok: false, text: result.text, error: result.error.message, errorCode: result.error.code }
}

export async function runPrompt(provider: AiProviderId, prompt: string, opts: RunOpts & { task?: TaskKind; execution?: ExecutionLease } = {}): Promise<AIResult> {
  const input: ProviderInput = { prompt, instructions: prompt, messages: [], attachments: opts.imagePng
    ? [{ name: 'figure.png', mediaType: 'image/png', data: opts.imagePng }] : [] }
  const lease = opts.execution ?? executions.begin({ requestId: randomUUID(), task: opts.task ?? 'chat' })
  const signal = opts.signal ? AbortSignal.any([opts.signal, lease.signal]) : lease.signal
  const deadline = Date.now() + (opts.timeout ?? AI_TIMEOUT) * 1_000
  let captured: CapturedProvider | undefined
  try {
    if (signal.aborted) return { ok: false, text: '', error: '', cancelled: true }
    captured = await captureProvider({ provider, model: opts.model ?? '', effort: opts.effort ?? '' }, { signal, deadline })
    lease.captureProfile(captured.profile)
    const result = await captured.adapter.execute({ ...input, requestId: lease.scope.requestId, task: opts.task ?? 'chat',
      profile: captured.profile, deadline,
      signal, onEvent: (event) => { if (lease.valid) opts.onDelta?.(event.text) },
    })
    if (!lease.valid) return { ok: false, text: '', error: '', cancelled: true }
    return legacyResult(result)
  } catch (error) {
    if (signal.aborted) return { ok: false, text: '', error: '', cancelled: true }
    return legacyResult({ status: 'failed', text: '', error: normalizeError(String(error)) })
  } finally {
    try { await captured?.adapter.dispose() } finally { if (!opts.execution) lease.finish() }
  }
}
