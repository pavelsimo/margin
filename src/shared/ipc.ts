// IPC contract between main and renderer. Channel names and payload shapes.

import type { BlockRow } from './models'
import type { Mode, Provider } from './constants'

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
  content: string // math-normalized for assistant rows
  contextText: string
  mode: string
  isError: boolean
}

export interface ChatSendRequest {
  requestId: string
  docId: number
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
  | { status: 'completed'; message: UiMessage }
  | { status: 'stopped'; message?: UiMessage }

export interface AiChoice {
  provider: Provider
  model: string
  effort: string
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
  'chat:history': (docId: number) => UiMessage[]
  'chat:send': (req: ChatSendRequest) => ChatSendResult
  'chat:stop': (requestId: string) => boolean
  'chat:command': (req: { docId: number; text: string }) => { kind: 'clear' | 'help' | 'unknown'; text: string }
  'chat:clear': (docId: number) => void
  'chat:clearAll': () => number
  'ai:getChoice': () => AiChoice
  'ai:setChoice': (choice: AiChoice) => AiChoice
  'prompts:get': () => Record<Mode, PromptInfo>
  'prompts:set': (req: { mode: Mode; template: string }) => PromptInfo
  'prompts:reset': (mode: Mode) => PromptInfo
  'settings:getExecutables': () => CliExecutableSettings
  'settings:setExecutable': (req: { provider: Provider; path: string }) => CliExecutableInfo
  'settings:resetExecutable': (provider: Provider) => CliExecutableInfo
  'settings:chooseExecutable': (provider: Provider) => string | null
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
  setZoomFactor(factor: number): void
}

declare global {
  interface Window {
    margin: MarginApi
  }
}
