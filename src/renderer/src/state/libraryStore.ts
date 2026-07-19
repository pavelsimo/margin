import { create } from 'zustand'
import type { ChatThreadSummary, PaperRow } from '@shared/ipc'

// Case-insensitive paper search across titles and generated topic tags.
export function filterPaperRows(rows: PaperRow[], query: string): PaperRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(
    (row) =>
      row.title.toLowerCase().includes(needle) || row.tags.some((tag) => tag.toLowerCase().includes(needle)),
  )
}

interface LibraryStore {
  allPapers: PaperRow[]
  chatThreads: ChatThreadSummary[]
  loaded: boolean
  query: string
  linkUrl: string
  addError: string
  addingSource: 'link' | 'file' | null
  addFocusRequest: number
  confirmDeleteId: number
  refresh: () => Promise<void>
  upsertChatThread: (thread: ChatThreadSummary) => void
  clearChatThreads: () => void
  setQuery: (query: string) => void
  setLinkUrl: (url: string) => void
  requestAddFocus: () => void
  openPaper: (docId: number) => Promise<void>
  askDelete: (docId: number) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
  addByLink: () => Promise<boolean>
  addByFile: (file: File) => Promise<boolean>
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  allPapers: [],
  chatThreads: [],
  loaded: false,
  query: '',
  linkUrl: '',
  addError: '',
  addingSource: null,
  addFocusRequest: 0,
  confirmDeleteId: 0,

  refresh: async () => {
    const [allPapers, chatThreads] = await Promise.all([
      window.margin.invoke('library:list'),
      window.margin.invoke('chat:list'),
    ])
    set({ allPapers, chatThreads, loaded: true })
  },

  upsertChatThread: (thread) => set((state) => {
    const chatThreads = state.chatThreads.filter((candidate) => candidate.id !== thread.id)
    chatThreads.push(thread)
    chatThreads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
    return { chatThreads }
  }),
  clearChatThreads: () => set({ chatThreads: [] }),

  setQuery: (query) => set({ query }),
  setLinkUrl: (linkUrl) => set({ linkUrl, addError: '' }),
  requestAddFocus: () => set((state) => ({ addFocusRequest: state.addFocusRequest + 1 })),

  openPaper: async (docId) => {
    await window.margin.invoke('library:open', docId)
  },

  askDelete: (confirmDeleteId) => set({ confirmDeleteId }),
  cancelDelete: () => set({ confirmDeleteId: 0 }),
  confirmDelete: async () => {
    const docId = get().confirmDeleteId
    if (docId) await window.margin.invoke('library:delete', docId)
    set({ confirmDeleteId: 0 })
    await get().refresh()
  },

  addByLink: async () => {
    const url = get().linkUrl.trim()
    if (!url) return false
    set({ addError: '', addingSource: 'link' })
    try {
      await window.margin.invoke('ingest:fromUrl', url)
      set({ linkUrl: '', addingSource: null })
      await get().refresh()
      return true
    } catch (err) {
      set({ addError: cleanIpcError(err), addingSource: null })
      return false
    }
  },

  addByFile: async (file) => {
    set({ addError: '', addingSource: 'file' })
    try {
      const data = await file.arrayBuffer()
      await window.margin.invoke('ingest:fromFile', { name: file.name, data })
      set({ addingSource: null })
      await get().refresh()
      return true
    } catch (err) {
      set({ addError: cleanIpcError(err), addingSource: null })
      return false
    }
  },
}))

// Electron prefixes invoke() rejections with "Error invoking remote method '…': ".
export function cleanIpcError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
