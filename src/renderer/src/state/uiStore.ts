import { create } from 'zustand'
import type { AppWindowState, ChatThreadSummary, PaperRow } from '@shared/ipc'
import { APP_ZOOM_LEVELS, DEFAULT_APP_ZOOM } from '@shared/constants'

export type ThemeMode = 'dark' | 'light'
export type PdfTheme = 'dark' | 'light'

export function storedBoolean(value: string | null, fallback: boolean): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

export function storedPdfTheme(value: string | null): PdfTheme {
  return value === 'dark' ? 'dark' : 'light'
}

export function sidebarPaperFilter(rows: PaperRow[], query: string): PaperRow[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(
    (row) => row.title.toLowerCase().includes(needle) || row.tags.some((tag) => tag.toLowerCase().includes(needle)),
  )
}

export function visibleSidebarThreads(
  rows: ChatThreadSummary[],
  expanded: boolean,
  activeThreadId?: number,
): ChatThreadSummary[] {
  if (expanded || (activeThreadId && rows.findIndex((row) => row.id === activeThreadId) >= 5)) return rows
  return rows.slice(0, 5)
}

export function isReaderRoute(pathname: string): boolean {
  return /^\/read\/\d+(?:\/new|\/chat\/\d+)?$/.test(pathname)
}

export type AppZoomShortcut = 'in' | 'out' | 'reset'

export function storedAppZoom(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_APP_ZOOM
  const parsed = Number(value)
  return APP_ZOOM_LEVELS.some((level) => level === parsed) ? parsed : DEFAULT_APP_ZOOM
}

export function steppedAppZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return APP_ZOOM_LEVELS.find((level) => level > current) ?? APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1]
  }
  return [...APP_ZOOM_LEVELS].reverse().find((level) => level < current) ?? APP_ZOOM_LEVELS[0]
}

export function appZoomShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>,
): AppZoomShortcut | null {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return null
  if (event.key === '+' || event.key === '=') return 'in'
  if (event.key === '-' || event.key === '_') return 'out'
  if (event.key === '0') return 'reset'
  return null
}

function read(key: string): string | null {
  return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
}

function write(key: string, value: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, value)
}

interface UiStore {
  leftSidebarOpen: boolean
  assistantOpen: boolean
  documentOutlineOpen: boolean
  theme: ThemeMode
  pdfTheme: PdfTheme
  appZoom: number
  aboutOpen: boolean
  windowState: AppWindowState | null
  toggleLeftSidebar: () => void
  toggleAssistant: () => void
  toggleDocumentOutline: () => void
  setDocumentOutlineOpen: (open: boolean) => void
  setAssistantOpen: (open: boolean) => void
  toggleTheme: () => void
  togglePdfTheme: () => void
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  openAbout: () => void
  closeAbout: () => void
  setWindowState: (state: AppWindowState) => void
}

export const useUiStore = create<UiStore>((set, get) => ({
  leftSidebarOpen: storedBoolean(read('margin.leftSidebarOpen'), true),
  assistantOpen: storedBoolean(read('margin.assistantOpen'), true),
  documentOutlineOpen: false,
  theme: read('margin.theme') === 'light' ? 'light' : 'dark',
  pdfTheme: storedPdfTheme(read('margin.pdfTheme')),
  appZoom: storedAppZoom(read('margin.appZoom')),
  aboutOpen: false,
  windowState: null,

  toggleLeftSidebar: () => {
    const leftSidebarOpen = !get().leftSidebarOpen
    write('margin.leftSidebarOpen', String(leftSidebarOpen))
    set({ leftSidebarOpen })
  },
  toggleAssistant: () => {
    const assistantOpen = !get().assistantOpen
    write('margin.assistantOpen', String(assistantOpen))
    set({ assistantOpen })
  },
  toggleDocumentOutline: () => {
    const documentOutlineOpen = !get().documentOutlineOpen
    if (documentOutlineOpen) write('margin.leftSidebarOpen', 'true')
    set({ documentOutlineOpen, leftSidebarOpen: documentOutlineOpen ? true : get().leftSidebarOpen })
  },
  setDocumentOutlineOpen: (documentOutlineOpen) => set({ documentOutlineOpen }),
  setAssistantOpen: (assistantOpen) => {
    write('margin.assistantOpen', String(assistantOpen))
    set({ assistantOpen })
  },
  toggleTheme: () => {
    const theme = get().theme === 'dark' ? 'light' : 'dark'
    write('margin.theme', theme)
    set({ theme })
  },
  togglePdfTheme: () => {
    const pdfTheme = get().pdfTheme === 'dark' ? 'light' : 'dark'
    write('margin.pdfTheme', pdfTheme)
    set({ pdfTheme })
  },
  zoomIn: () => {
    const appZoom = steppedAppZoom(get().appZoom, 1)
    write('margin.appZoom', String(appZoom))
    set({ appZoom })
  },
  zoomOut: () => {
    const appZoom = steppedAppZoom(get().appZoom, -1)
    write('margin.appZoom', String(appZoom))
    set({ appZoom })
  },
  resetZoom: () => {
    write('margin.appZoom', String(DEFAULT_APP_ZOOM))
    set({ appZoom: DEFAULT_APP_ZOOM })
  },
  openAbout: () => set({ aboutOpen: true }),
  closeAbout: () => set({ aboutOpen: false }),
  setWindowState: (windowState) => set({ windowState }),
}))
