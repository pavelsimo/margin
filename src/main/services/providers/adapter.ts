import type { AIResult } from './legacy'
import type { ProviderAdapter, ProviderCapabilities, ProviderError, ProviderRequest, ProviderResult } from './types'

export function normalizeError(detail: string, code?: ProviderError['code']): ProviderError {
  const value = detail.toLowerCase()
  code ??= /not found at|isn't installed|not executable|enoent|eacces/.test(value) ? 'executable_unavailable'
    : /sign.*in|log.?in|unauthorized|authenticate|api key|http 401|http 403/.test(value) ? 'authentication_required'
    : /rate.?limit|http 429/.test(value) ? 'rate_limited'
    : /didn't answer within|timed? ?out/.test(value) ? 'timeout'
    : /unsupported|not support/.test(value) ? 'unsupported_input'
    : /malformed|empty response|protocol|thread id/.test(value) ? 'protocol'
    : /needs a model|no longer exists/.test(value) ? 'configuration' : 'transport'
  const messages: Record<ProviderError['code'], string> = {
    executable_unavailable: 'The provider executable is unavailable. Choose an executable in Settings or install the CLI.',
    authentication_required: 'Provider authentication is required. Sign in to the CLI or update the API key in Settings.',
    rate_limited: 'The provider is rate limited. Wait before trying again.',
    unsupported_input: 'The provider does not support this model or input. Check your provider settings.',
    timeout: 'The provider did not answer before the deadline. Try again or ask something smaller.',
    transport: 'The provider connection failed. Check the provider and explicitly retry when ready.',
    protocol: 'The provider returned an invalid or empty response. Check the provider and try again.',
    configuration: 'The selected provider configuration is unavailable or incomplete. Check Settings.',
  }
  // Provider output can echo prompts and credentials. Only curated diagnostics cross this boundary.
  return { code, message: messages[code] }
}

export function managedAdapter(
  capabilities: ProviderCapabilities,
  run: (request: ProviderRequest) => Promise<AIResult>,
): ProviderAdapter {
  const active = new Map<AbortController, Promise<ProviderResult>>()
  let disposed = false
  return {
    capabilities,
    execute(request) {
      if (disposed || request.signal.aborted) return Promise.resolve({ status: 'cancelled', text: '' })
      const controller = new AbortController()
      const signal = AbortSignal.any([request.signal, controller.signal])
      const captured = { ...request, profile: { ...request.profile }, signal }
      let finished = false
      let deliveryFailed = false
      const work = Promise.resolve().then(async (): Promise<ProviderResult> => {
        if (signal.aborted) return { status: 'cancelled', text: '' }
        if (captured.deadline <= Date.now()) return { status: 'failed', text: '', error: normalizeError('', 'timeout') }
        try {
          const result = await run({ ...captured, onEvent: (event) => {
            if (!finished && !signal.aborted) {
              try { captured.onEvent?.(event) }
              catch { deliveryFailed = true; controller.abort() }
            }
          } })
          if (deliveryFailed) return { status: 'failed', text: result.text, error: normalizeError('', 'transport') }
          if (result.cancelled || signal.aborted) return { status: 'cancelled', text: result.text }
          if (result.ok) return { status: 'completed', text: result.text }
          return { status: 'failed', text: result.text, error: {
            ...normalizeError(result.error, result.errorCode), ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}),
          } }
        } catch (error) {
          if (signal.aborted) return { status: 'cancelled', text: '' }
          return { status: 'failed', text: '', error: normalizeError(String(error)) }
        } finally {
          finished = true
        }
      }).finally(() => active.delete(controller))
      active.set(controller, work)
      return work
    },
    async dispose() {
      disposed = true
      for (const controller of active.keys()) controller.abort()
      await Promise.allSettled(active.values())
    },
  }
}
