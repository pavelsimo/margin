import type { AiChoice } from '@shared/ipc'

export type TaskKind = 'chat' | 'title' | 'tagging'
export type Capability = boolean | 'unknown'
export interface ProviderCapabilities {
  streaming: Capability
  images: Capability
  nativeSessions: Capability
  structuredOutput: Capability
  modelOptions: readonly string[]
}
export interface ProviderInput {
  instructions: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: { documentId: number; pageNumber: number | null; scope: string; text: string }
  attachments: Array<{ name: string; mediaType: 'image/png'; data: Buffer }>
  // Compatibility serialization preserves the existing wire prompt during extraction.
  prompt: string
}
export interface ProviderRequest extends ProviderInput {
  requestId: string
  task: TaskKind
  profile: Readonly<AiChoice>
  deadline: number
  signal: AbortSignal
  onEvent?: (event: { type: 'text'; text: string }) => void
}
export type ProviderErrorCode = 'executable_unavailable' | 'authentication_required' | 'rate_limited'
  | 'unsupported_input' | 'timeout' | 'transport' | 'protocol' | 'configuration'
export interface ProviderError {
  code: ProviderErrorCode
  message: string
  retryAfter?: string
}
export type ProviderResult =
  | { status: 'completed'; text: string }
  | { status: 'cancelled'; text: string }
  | { status: 'failed'; text: string; error: ProviderError }
export interface ProviderAdapter {
  readonly capabilities: ProviderCapabilities
  execute(request: ProviderRequest): Promise<ProviderResult>
  dispose(): Promise<void>
}

export interface ProviderControls {
  signal?: AbortSignal
  deadline?: number
}
