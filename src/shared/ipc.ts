// IPC contract between main and renderer. Channel names and payload shapes.

import type { BlockRow } from './models'
import type { AiProviderId, Mode, OpenAiCompatibleProviderId, Provider } from './constants'

export interface PaperRow {
  id: number
  title: string
  tags: string[]
  previewUrl: string | null
  pagesLabel: string
  added: string
  isNew: boolean
  isFailed: boolean
  isIngesting: boolean
  isTagging: boolean
  isReady: boolean
}

export interface DocumentInfo {
  id: number
  title: string
  authors: string
  pageCount: number
  ready: boolean
  failed: boolean
  failMessage: string
  scanned: boolean
  outline: PdfOutlineItem[]
}

export interface PdfOutlineItem {
  title: string
  page: number // 1-based
  children: PdfOutlineItem[]
}

export interface PageData {
  imageUrl: string
  width: number
  height: number
  blocks: BlockRow[]
}

export interface UiMessage {
  id: number
  role: 'user' | 'assistant'
  content: string // persisted source content; assistant math is normalized in the renderer
  contextText: string
  mode: string
  isError: boolean
  createdAt: string
}

export interface ChatThreadSummary {
  id: number
  documentId: number
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChatThreadUpdate {
  thread: ChatThreadSummary
  reason: 'created' | 'updated' | 'titled'
  requestId?: string
}

export interface ChatSendRequest {
  requestId: string
  docId: number
  threadId?: number
  question: string
  mode: Mode
  scope: 'page' | 'document'
  pageNumber: number
  contextText: string
  // For figure/region questions a PNG crop is rendered from the PDF at chat time.
  imageBlockId?: number
  imageRegion?: { x0: number; y0: number; x1: number; y1: number }
  imageRegionPage?: number
}

export interface ChatDelta {
  requestId: string
  text: string
}

export type ChatSendResult =
  | { status: 'completed'; message: UiMessage; thread: ChatThreadSummary }
  | { status: 'stopped'; message?: UiMessage; thread: ChatThreadSummary }

export interface ClearAllChatsResult {
  threadsDeleted: number
  messagesDeleted: number
}

export interface AiChoice {
  provider: AiProviderId
  model: string
  effort: string
}

export interface AiProviderInfo {
  id: AiProviderId
  label: string
  kind: 'cli' | 'openai-compatible'
  models: string[]
  defaultModel: string
  efforts: string[]
  available: boolean
}

export type CredentialProtection = 'os' | 'basic'

export interface OpenAiCompatibleProfile {
  id: OpenAiCompatibleProviderId
  name: string
  baseUrl: string
  defaultModel: string
  models: string[]
  hasApiKey: boolean
  credentialProtection: CredentialProtection
}

export interface OpenAiCompatibleProfileDraft {
  id?: OpenAiCompatibleProviderId
  name: string
  baseUrl: string
  defaultModel: string
  models?: string[]
  apiKey?: string
  clearApiKey?: boolean
}

export interface OpenAiConnectionResult {
  models: string[]
}

export interface PromptInfo {
  template: string
  customized: boolean
}

export type ExecutableSource = 'custom' | 'environment' | 'path'

export interface CliExecutableInfo {
  customPath: string
  effectiveCommand: string
  source: ExecutableSource
  detected: boolean
  /** Absolute path of the detected executable, or '' when not detected. */
  resolvedPath: string
}

export type CliExecutableSettings = Record<Provider, CliExecutableInfo>

export interface IngestUpdate {
  docId: number
  phase: 'ingesting' | 'ready' | 'failed' | 'tagging' | 'done'
  error?: string
}

export type AppCommand =
  | 'minimize'
  | 'toggle-maximize'
  | 'close-window'
  | 'quit'
  | 'reload'
  | 'toggle-full-screen'
  | 'go-back'
  | 'go-forward'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select-all'

export interface AppWindowState {
  platform: string
  version: string
  maximized: boolean
  fullScreen: boolean
  canGoBack: boolean
  canGoForward: boolean
}

// invoke() channels: request/response
export interface IpcApi {
  'app:command': (command: AppCommand) => void
  'app:getWindowState': () => AppWindowState
  'library:list': () => PaperRow[]
  'library:open': (docId: number) => void
  'library:delete': (docId: number) => void
  'document:get': (docId: number) => DocumentInfo
  'page:get': (req: { docId: number; number: number }) => PageData
  'page:renderRegion': (req: {
    docId: number
    pageNumber: number
    bbox: [number, number, number, number] // normalized 0-1 fractions
  }) => string | null // PNG data URL, null when unavailable
  'chat:list': () => ChatThreadSummary[]
  'chat:history': (req: { docId: number; threadId: number }) => UiMessage[]
  'chat:send': (req: ChatSendRequest) => ChatSendResult
  'chat:stop': (requestId: string) => boolean
  'chat:command': (req: { threadId?: number; text: string }) => { kind: 'clear' | 'help' | 'unknown'; text: string }
  'chat:clear': (threadId: number) => void
  'chat:clearAll': () => ClearAllChatsResult
  'ai:getChoice': () => AiChoice
  'ai:setChoice': (choice: AiChoice) => AiChoice
  'ai:getBackgroundChoice': () => AiChoice | null
  'ai:setBackgroundChoice': (choice: AiChoice | null) => AiChoice | null
  'ai:getProviders': () => AiProviderInfo[]
  'prompts:get': () => Record<Mode, PromptInfo>
  'prompts:set': (req: { mode: Mode; template: string }) => PromptInfo
  'prompts:reset': (mode: Mode) => PromptInfo
  'settings:getExecutables': () => CliExecutableSettings
  'settings:setExecutable': (req: { provider: Provider; path: string }) => CliExecutableInfo
  'settings:resetExecutable': (provider: Provider) => CliExecutableInfo
  'settings:chooseExecutable': (provider: Provider) => string | null
  'settings:getOpenAiProviders': () => OpenAiCompatibleProfile[]
  'settings:upsertOpenAiProvider': (draft: OpenAiCompatibleProfileDraft) => OpenAiCompatibleProfile
  'settings:deleteOpenAiProvider': (id: OpenAiCompatibleProviderId) => AiChoice
  'settings:testOpenAiProvider': (draft: OpenAiCompatibleProfileDraft) => OpenAiConnectionResult
  'settings:refreshOpenAiModels': (id: OpenAiCompatibleProviderId) => OpenAiCompatibleProfile
  'ingest:fromUrl': (url: string) => { docId: number }
  'ingest:fromFile': (req: { name: string; data: ArrayBuffer }) => { docId: number }
}

export type IpcChannel = keyof IpcApi

// Renderer-facing API exposed by the preload script.
export interface MarginApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: Parameters<IpcApi[C]>
  ): Promise<Awaited<ReturnType<IpcApi[C]>>>
  onIngestUpdate(listener: (update: IngestUpdate) => void): () => void
  onWindowState(listener: (state: AppWindowState) => void): () => void
  onChatDelta(listener: (delta: ChatDelta) => void): () => void
  onChatThreadUpdate(listener: (update: ChatThreadUpdate) => void): () => void
  setZoomFactor(factor: number): void
}

declare global {
  interface Window {
    margin: MarginApi
  }
}
