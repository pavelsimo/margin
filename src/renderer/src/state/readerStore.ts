import { create } from 'zustand'
import type { BlockRow } from '@shared/models'
import type {
  AiChoice,
  AiProviderInfo,
  ChatDelta,
  ChatSendRequest,
  ChatSendResult,
  ChatThreadSummary,
  ChatThreadUpdate,
  DocumentInfo,
  UiMessage,
} from '@shared/ipc'
import {
  CHIP_PREVIEW_CHARS,
  IMAGE_MODE_QUESTIONS,
  MODE_LABELS,
  MODE_QUESTIONS,
  REGION_MODE_QUESTIONS,
  ZOOM_LEVELS,
  type AiProviderId,
  type Mode,
} from '@shared/constants'
import {
  clickSelection,
  normalizeSelection,
  parseRegionPayload,
  regionSelection,
  selectionText,
  type SelectionResult,
} from '../lib/selection'
import { normalizeMath } from '../lib/normalizeMath'
import { cleanIpcError } from './libraryStore'

export interface DisplayMessage {
  key: number
  role: 'user' | 'assistant'
  content: string
  ctx: string
  isError: boolean
  requestId?: string
  rawContent?: string
}

let messageKey = 0
let readerLoadSequence = 0
function displayRow(message: UiMessage, key?: number): DisplayMessage {
  return {
    key: key ?? ++messageKey,
    role: message.role,
    content: message.role === 'user' ? message.content : normalizeMath(message.content),
    ctx: message.contextText.trim(),
    isError: message.isError,
  }
}

function draftRow(requestId: string): DisplayMessage {
  return { key: ++messageKey, role: 'assistant', content: '', rawContent: '', ctx: '', isError: false, requestId }
}

// A transient chat row shown in the panel but never persisted or sent to the AI.
function localRow(content: string, isError = false): DisplayMessage {
  return { key: ++messageKey, role: 'assistant', content, ctx: '', isError }
}

export function ctxShort(ctx: string): string {
  return ctx.slice(0, CHIP_PREVIEW_CHARS) + (ctx.length > CHIP_PREVIEW_CHARS ? '…' : '')
}

interface SendOpts {
  contextOverride?: string
  imageBlockId?: number
  imageRegion?: number[]
  imageRegionPage?: number
  imageLabel?: string
}

interface ReaderStore {
  documentId: number
  activeThreadId: number
  activeThread: ChatThreadSummary | null
  doc: DocumentInfo | null
  currentPage: number
  pageImage: string
  pageBlocks: BlockRow[]

  selectedBlockIds: number[]
  selectionAnchorId: number
  selectedRegion: number[]
  selectedRegionPage: number
  selectedText: string
  selectedKind: string
  selectionThumb: string

  messages: DisplayMessage[]
  historyGeneration: number
  inputText: string
  chipText: string
  chipBlockId: number
  chipRegion: number[]
  chipRegionPage: number
  chipLabel: string
  chipBlockCount: number
  chipThumb: string
  typing: boolean
  activeRequestId: string
  scope: 'page' | 'document'
  zoom: number
  ai: AiChoice
  aiProviders: AiProviderInfo[] | null

  loadReader: (docId: number, threadId?: number | null) => Promise<void>
  startNewChat: (docId: number) => void
  loadPage: (number: number) => Promise<void>
  nextPage: () => void
  prevPage: () => void
  zoomIn: () => void
  zoomOut: () => void
  setZoom: (zoom: number) => void
  selectBlock: (blockId: number, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean }) => void
  selectRegion: (payload: unknown) => void
  clearSelection: () => void
  setScope: (scope: 'page' | 'document') => void
  setInput: (value: string) => void
  clearChip: () => void
  askSelection: () => void
  runMode: (mode: Mode) => void
  send: () => void
  sendSuggestion: (text: string) => void
  stop: () => void
  clearAllChatHistory: () => void
  applyThreadUpdate: (update: ChatThreadUpdate) => void
  chooseAiProvider: (provider: AiProviderId) => Promise<void>
  chooseAiModel: (model: string) => Promise<void>
  chooseAiEffort: (effort: string) => Promise<void>
  refreshAiProviders: () => Promise<void>
}

const clearedSelection = {
  selectedBlockIds: [] as number[],
  selectionAnchorId: 0,
  selectedRegion: [] as number[],
  selectedRegionPage: 0,
  selectedText: '',
  selectedKind: '',
  selectionThumb: '',
}

const clearedChip = {
  chipText: '',
  chipBlockId: 0,
  chipRegion: [] as number[],
  chipRegionPage: 0,
  chipLabel: '',
  chipBlockCount: 0,
  chipThumb: '',
}

// Invalidates in-flight thumbnail renders when the selection or chip changes underneath them.
let thumbSeq = 0

export const useReaderStore = create<ReaderStore>((set, get) => {
  function applySelection(result: SelectionResult): void {
    const { pageBlocks } = get()
    thumbSeq++
    const selectedBlockIds = normalizeSelection(pageBlocks, result.blockIds)
    const selected = pageBlocks.filter((block) => selectedBlockIds.includes(block.id))
    if (!selected.length) {
      set({ ...clearedSelection })
      return
    }
    const selectedText = selectionText(pageBlocks, selectedBlockIds)
    set({
      selectedRegion: [],
      selectedRegionPage: 0,
      selectedBlockIds,
      selectionAnchorId: result.anchorId,
      selectedText,
      selectedKind: selected.length === 1 ? selected[0].kind : '',
      selectionThumb: '',
    })
    // No extractable text means a figure/table; preview it in the chat panel.
    if (!selectedText.trim()) {
      const first = selected[0]
      loadThumb(get().currentPage, [first.x0, first.y0, first.x1, first.y1])
    }
  }

  // Fetches a small PNG of the region and attaches it to whichever of the
  // selection preview or the pinned chip is still current when it resolves.
  function loadThumb(pageNumber: number, bbox: number[]): void {
    const seq = ++thumbSeq
    void window.margin
      .invoke('page:renderRegion', {
        docId: get().documentId,
        pageNumber,
        bbox: bbox as [number, number, number, number],
      })
      .then((thumb) => {
        if (!thumb || seq !== thumbSeq) return
        const state = get()
        if (state.selectedBlockIds.length || state.selectedRegion.length === 4) set({ selectionThumb: thumb })
        else if (state.chipBlockId || state.chipRegion.length === 4) set({ chipThumb: thumb })
      })
      .catch(() => {}) // best-effort; the text label alone is fine
  }

  function figureLabel(): string {
    const { selectedKind, currentPage } = get()
    return `${selectedKind === 'table' ? 'Table' : 'Figure'} · page ${currentPage}`
  }

  async function sendMessage(question: string, mode: Mode, opts: SendOpts = {}): Promise<void> {
    const state = get()
    const historyGeneration = state.historyGeneration
    const requestId = crypto.randomUUID()
    let imageBlockId = opts.imageBlockId ?? 0
    let imageRegion = opts.imageRegion ?? []
    let imageRegionPage = opts.imageRegionPage ?? 0
    if (opts.contextOverride) {
      imageBlockId = 0
      imageRegion = []
      imageRegionPage = 0
    } else if (opts.imageRegion) {
      imageBlockId = 0
    } else if (imageBlockId) {
      imageRegion = []
      imageRegionPage = 0
    } else {
      imageBlockId = state.chipBlockId
      imageRegion = [...state.chipRegion]
      imageRegionPage = state.chipRegionPage
    }
    const imageLabel = opts.imageLabel || state.chipLabel
    const contextText = opts.contextOverride || state.chipText.trim()
    // the figure label is display-only; never pass it as selected text
    const displayCtx = contextText || (imageBlockId || imageRegion.length === 4 ? imageLabel : '')

    const draft = draftRow(requestId)
    set({
      ...clearedChip,
      typing: true,
      activeRequestId: requestId,
      messages: [
        ...state.messages,
        { key: ++messageKey, role: 'user', content: question, ctx: displayCtx.trim(), isError: false },
        draft,
      ],
    })

    const request: ChatSendRequest = {
      requestId,
      docId: state.documentId,
      threadId: state.activeThreadId || undefined,
      question,
      mode,
      scope: state.scope,
      pageNumber: state.currentPage,
      contextText,
      imageBlockId: imageBlockId || undefined,
      imageRegion:
        imageRegion.length === 4
          ? { x0: imageRegion[0], y0: imageRegion[1], x1: imageRegion[2], y1: imageRegion[3] }
          : undefined,
      imageRegionPage: imageRegionPage || undefined,
    }
    const onDelta = (delta: ChatDelta) => {
      if (delta.requestId !== requestId || !delta.text) return
      set((s) => {
        if (
          s.historyGeneration !== historyGeneration ||
          s.documentId !== request.docId ||
          s.activeRequestId !== requestId
        ) return {}
        return {
          messages: s.messages.map((message) => {
            if (message.key !== draft.key) return message
            const rawContent = (message.rawContent ?? '') + delta.text
            return { ...message, rawContent, content: normalizeMath(rawContent) }
          }),
        }
      })
    }
    const unsubscribe = typeof window.margin.onChatDelta === 'function'
      ? window.margin.onChatDelta(onDelta)
      : () => {}
    try {
      const result = await window.margin.invoke('chat:send', request)
      set((s) =>
        s.historyGeneration === historyGeneration &&
        s.documentId === request.docId &&
        s.activeRequestId === requestId
          ? {
              typing: false,
              activeRequestId: '',
              activeThreadId: result.thread.id,
              activeThread: result.thread,
              messages: settleDraft(s.messages, draft.key, result),
            }
          : {},
      )
    } catch (err) {
      set((s) =>
        s.historyGeneration === historyGeneration &&
        s.documentId === request.docId &&
        s.activeRequestId === requestId
          ? {
              typing: false,
              activeRequestId: '',
              messages: [
                ...s.messages.filter((message) => message.key !== draft.key),
                localRow(cleanIpcError(err), true),
              ],
            }
          : {},
      )
    } finally {
      unsubscribe()
    }
  }

  async function runCommand(text: string): Promise<void> {
    const { activeThreadId } = get()
    const outcome = await window.margin.invoke('chat:command', {
      threadId: activeThreadId || undefined,
      text,
    })
    if (outcome.kind === 'clear') {
      set({ messages: [] })
    } else {
      set((s) => ({ messages: [...s.messages, localRow(outcome.text, outcome.kind === 'unknown')] }))
    }
  }

  return {
    documentId: 0,
    activeThreadId: 0,
    activeThread: null,
    doc: null,
    currentPage: 1,
    pageImage: '',
    pageBlocks: [],
    ...clearedSelection,
    messages: [],
    historyGeneration: 0,
    inputText: '',
    ...clearedChip,
    typing: false,
    activeRequestId: '',
    scope: 'page',
    zoom: 100,
    ai: { provider: 'claude', model: '', effort: '' },
    aiProviders: null,

    loadReader: async (docId, requestedThreadId) => {
      const loadSequence = ++readerLoadSequence
      const activeRequestId = get().activeRequestId
      if (activeRequestId) await window.margin.invoke('chat:stop', activeRequestId).catch(() => false)
      const [doc, threads, ai, aiProviders] = await Promise.all([
        window.margin.invoke('document:get', docId),
        window.margin.invoke('chat:list'),
        window.margin.invoke('ai:getChoice'),
        window.margin.invoke('ai:getProviders'),
      ])
      if (loadSequence !== readerLoadSequence) return
      const resolvedThreadId = requestedThreadId === undefined
        ? (threads.find((thread) => thread.documentId === docId)?.id ?? 0)
        : requestedThreadId && threads.some((thread) => thread.id === requestedThreadId && thread.documentId === docId)
          ? requestedThreadId
          : 0
      const history = resolvedThreadId
        ? await window.margin.invoke('chat:history', { docId, threadId: resolvedThreadId })
        : []
      if (loadSequence !== readerLoadSequence) return
      const activeThread = resolvedThreadId
        ? (threads.find((thread) => thread.id === resolvedThreadId) ?? null)
        : null
      set({
        documentId: docId,
        activeThreadId: resolvedThreadId,
        activeThread,
        doc,
        currentPage: 1,
        messages: history.map(displayRow),
        ai,
        aiProviders,
        inputText: '',
        ...clearedChip,
        ...clearedSelection,
        scope: 'page',
        typing: false,
        activeRequestId: '',
        zoom: 100,
      })
      void get().refreshAiProviders()
      await get().loadPage(1)
    },

    startNewChat: (docId) => {
      readerLoadSequence++
      thumbSeq++
      const state = get()
      if (state.activeRequestId) void window.margin.invoke('chat:stop', state.activeRequestId).catch(() => false)
      set({
        documentId: docId,
        doc: state.documentId === docId ? state.doc : null,
        activeThreadId: 0,
        activeThread: null,
        messages: [],
        inputText: '',
        ...clearedChip,
        ...clearedSelection,
        typing: false,
        activeRequestId: '',
      })
    },

    loadPage: async (number) => {
      const { documentId } = get()
      try {
        const page = await window.margin.invoke('page:get', { docId: documentId, number })
        set({ pageImage: page.imageUrl, pageBlocks: page.blocks })
      } catch {
        set({ pageImage: '', pageBlocks: [] })
      }
    },

    nextPage: () => {
      const { currentPage, doc, loadPage } = get()
      if (doc && currentPage < doc.pageCount) {
        set({ currentPage: currentPage + 1, ...clearedSelection })
        void loadPage(currentPage + 1)
      }
    },

    prevPage: () => {
      const { currentPage, loadPage } = get()
      if (currentPage > 1) {
        set({ currentPage: currentPage - 1, ...clearedSelection })
        void loadPage(currentPage - 1)
      }
    },

    zoomIn: () => {
      const { zoom } = get()
      const next = ZOOM_LEVELS.find((level) => level > zoom)
      if (next) set({ zoom: next })
    },

    zoomOut: () => {
      const { zoom } = get()
      const next = [...ZOOM_LEVELS].reverse().find((level) => level < zoom)
      if (next) set({ zoom: next })
    },

    setZoom: (zoom) => set({ zoom }),

    selectBlock: (blockId, mods) => {
      const { pageBlocks, selectedBlockIds, selectionAnchorId } = get()
      applySelection(clickSelection(pageBlocks, selectedBlockIds, selectionAnchorId, blockId, mods))
    },

    selectRegion: (payload) => {
      const request = parseRegionPayload(payload)
      if (!request) return
      if (request.kind === 'region') {
        const region = [request.x0, request.y0, request.x1, request.y1]
        set({
          selectedBlockIds: [],
          selectionAnchorId: 0,
          selectedText: '',
          selectedKind: '',
          selectedRegion: region,
          selectedRegionPage: get().currentPage,
          selectionThumb: '',
        })
        loadThumb(get().currentPage, region)
        return
      }
      const { pageBlocks, selectedBlockIds, selectionAnchorId } = get()
      applySelection(regionSelection(pageBlocks, selectedBlockIds, selectionAnchorId, request.ids, request.additive))
    },

    clearSelection: () => {
      thumbSeq++
      set({ ...clearedSelection })
    },
    setScope: (scope) => set({ scope }),
    setInput: (inputText) => set({ inputText }),
    clearChip: () => {
      thumbSeq++
      set({ ...clearedChip })
    },

    askSelection: () => {
      // Pin the selected blocks or exact region and let the user type the question.
      const state = get()
      if (state.selectedRegion.length === 4) {
        set({
          ...clearedChip,
          chipRegion: [...state.selectedRegion],
          chipRegionPage: state.selectedRegionPage,
          chipLabel: `Region · page ${state.selectedRegionPage}`,
          chipThumb: state.selectionThumb,
          ...clearedSelection,
        })
        return
      }
      if (!state.selectedBlockIds.length) return
      if (state.selectedText.trim()) {
        set({
          ...clearedChip,
          chipText: state.selectedText,
          chipBlockCount: state.selectedBlockIds.length,
          ...clearedSelection,
        })
      } else {
        // no extractable text; pin the block itself, sent later as a cropped image
        set({
          ...clearedChip,
          chipBlockId: state.selectedBlockIds[0],
          chipLabel: figureLabel(),
          chipThumb: state.selectionThumb,
          ...clearedSelection,
        })
      }
    },

    runMode: (mode) => {
      // Explain / Summarize / ELI12 on the selection; sends immediately.
      const state = get()
      if (state.typing || (!state.selectedBlockIds.length && state.selectedRegion.length !== 4)) return
      if (state.selectedRegion.length === 4) {
        const imageRegion = [...state.selectedRegion]
        const imageRegionPage = state.selectedRegionPage
        set({ ...clearedSelection })
        const question = REGION_MODE_QUESTIONS[mode] ?? ''
        void sendMessage(question || MODE_LABELS[mode], mode, {
          imageRegion,
          imageRegionPage,
          imageLabel: `Region · page ${imageRegionPage}`,
        })
        return
      }
      if (state.selectedText.trim()) {
        const context = state.selectedText
        set({ ...clearedSelection })
        const question = MODE_QUESTIONS[mode] ?? ''
        void sendMessage(question || MODE_LABELS[mode], mode, { contextOverride: context })
        return
      }
      const blockId = state.selectedBlockIds[0]
      const label = figureLabel()
      set({ ...clearedSelection })
      const question = IMAGE_MODE_QUESTIONS[mode] ?? ''
      void sendMessage(question || MODE_LABELS[mode], mode, { imageBlockId: blockId, imageLabel: label })
    },

    send: () => {
      const state = get()
      if (state.typing || !state.inputText.trim()) return
      const text = state.inputText.trim()
      set({ inputText: '' })
      if (text.trimStart().startsWith('/')) {
        void runCommand(text)
        return
      }
      void sendMessage(text, 'ask')
    },

    sendSuggestion: (text) => {
      if (get().typing) return
      void sendMessage(text, 'ask')
    },

    stop: () => {
      const { activeRequestId } = get()
      if (activeRequestId) void window.margin.invoke('chat:stop', activeRequestId)
    },

    clearAllChatHistory: () => {
      const { activeRequestId } = get()
      if (activeRequestId) void window.margin.invoke('chat:stop', activeRequestId)
      set((state) => ({
        historyGeneration: state.historyGeneration + 1,
        activeThreadId: 0,
        activeThread: null,
        messages: [],
        typing: false,
        activeRequestId: '',
      }))
    },

    applyThreadUpdate: (update) => {
      const state = get()
      if (update.thread.documentId !== state.documentId) return
      if (update.reason === 'created' && update.requestId === state.activeRequestId) {
        set({ activeThreadId: update.thread.id, activeThread: update.thread })
      } else if (update.thread.id === state.activeThreadId) {
        set({ activeThread: update.thread })
      }
    },

    chooseAiProvider: async (provider) => {
      const info = get().aiProviders?.find((candidate) => candidate.id === provider)
      const ai = await window.margin.invoke('ai:setChoice', {
        provider,
        model: info?.defaultModel ?? '',
        effort: '',
      })
      set({ ai })
    },

    chooseAiModel: async (model) => {
      const { ai } = get()
      const updated = await window.margin.invoke('ai:setChoice', { ...ai, model })
      set({ ai: updated })
    },

    chooseAiEffort: async (effort) => {
      const { ai } = get()
      const updated = await window.margin.invoke('ai:setChoice', { ...ai, effort })
      set({ ai: updated })
    },

    refreshAiProviders: async () => {
      let aiProviders: AiProviderInfo[]
      try {
        aiProviders = await window.margin.invoke('ai:getProviders')
      } catch {
        return
      }
      set({ aiProviders })
      const available = aiProviders.filter((provider) => provider.available)
      const { ai } = get()
      if (available.length && !available.some((provider) => provider.id === ai.provider)) {
        await get().chooseAiProvider(available[0].id)
      }
    },
  }
})

function settleDraft(messages: DisplayMessage[], draftKey: number, result: ChatSendResult): DisplayMessage[] {
  const message = result.message
  if (!message) return messages.filter((row) => row.key !== draftKey)
  return messages.map((row) => row.key === draftKey ? displayRow(message, draftKey) : row)
}
