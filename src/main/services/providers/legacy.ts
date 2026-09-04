// Compatibility types retained while callers migrate to ProviderRequest.
export interface AIResult {
  ok: boolean
  text: string
  error: string
  cancelled?: boolean
  errorCode?: import('./types').ProviderErrorCode
  retryAfter?: string
}

export interface RunOpts {
  model?: string
  effort?: string
  imagePng?: Buffer | null
  timeout?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
}
