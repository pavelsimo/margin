import { describe, expect, it, vi } from 'vitest'
import type { PaperRow } from '@shared/ipc'
import { isValidAppZoomFactor } from '@shared/constants'
import {
  appZoomShortcut,
  isReaderRoute,
  sidebarPaperFilter,
  steppedAppZoom,
  storedAppZoom,
  storedBoolean,
  storedPdfTheme,
  useUiStore,
} from './uiStore'

const paper = (id: number, title: string, tags: string[]): PaperRow => ({
  id,
  title,
  tags,
  pagesLabel: '10 pp',
  previewUrl: '',
  added: 'Jul 18',
  isNew: false,
  isFailed: false,
  isIngesting: false,
  isTagging: false,
  isReady: true,
})

describe('storedBoolean', () => {
  it('uses the supplied default for absent or invalid values', () => {
    expect(storedBoolean(null, true)).toBe(true)
    expect(storedBoolean('invalid', false)).toBe(false)
  })

  it('parses persisted boolean strings', () => {
    expect(storedBoolean('true', false)).toBe(true)
    expect(storedBoolean('false', true)).toBe(false)
  })
})

describe('storedPdfTheme', () => {
  it('restores dark PDF mode', () => {
    expect(storedPdfTheme('dark')).toBe('dark')
  })

  it('defaults missing, light, and invalid values to light PDF mode', () => {
    expect(storedPdfTheme(null)).toBe('light')
    expect(storedPdfTheme('light')).toBe('light')
    expect(storedPdfTheme('invalid')).toBe('light')
  })

  it('toggles and persists the PDF theme independently', () => {
    const setItem = vi.fn()
    vi.stubGlobal('window', { localStorage: { setItem } })
    useUiStore.setState({ pdfTheme: 'light' })

    useUiStore.getState().togglePdfTheme()

    expect(useUiStore.getState().pdfTheme).toBe('dark')
    expect(setItem).toHaveBeenCalledWith('margin.pdfTheme', 'dark')

    useUiStore.setState({ pdfTheme: 'light' })
    vi.unstubAllGlobals()
  })
})

describe('application zoom', () => {
  it('restores supported levels and falls back to 100%', () => {
    expect(storedAppZoom('125')).toBe(125)
    expect(storedAppZoom(null)).toBe(100)
    expect(storedAppZoom('')).toBe(100)
    expect(storedAppZoom('120')).toBe(100)
    expect(storedAppZoom('not-a-number')).toBe(100)
  })

  it('moves between browser-like levels and clamps at the limits', () => {
    expect(steppedAppZoom(100, 1)).toBe(110)
    expect(steppedAppZoom(100, -1)).toBe(90)
    expect(steppedAppZoom(300, 1)).toBe(300)
    expect(steppedAppZoom(50, -1)).toBe(50)
  })

  it('accepts only finite Electron zoom factors within the supported range', () => {
    expect(isValidAppZoomFactor(0.5)).toBe(true)
    expect(isValidAppZoomFactor(3)).toBe(true)
    expect(isValidAppZoomFactor(0.49)).toBe(false)
    expect(isValidAppZoomFactor(3.01)).toBe(false)
    expect(isValidAppZoomFactor(Number.NaN)).toBe(false)
  })

  it.each([
    ['+', 'in'],
    ['=', 'in'],
    ['-', 'out'],
    ['_', 'out'],
    ['0', 'reset'],
  ] as const)('maps Ctrl+%s to zoom %s', (key, shortcut) => {
    expect(appZoomShortcut({ key, ctrlKey: true, metaKey: false, altKey: false })).toBe(shortcut)
  })

  it('supports Command and ignores unmodified or Alt-modified keys', () => {
    expect(appZoomShortcut({ key: '+', ctrlKey: false, metaKey: true, altKey: false })).toBe('in')
    expect(appZoomShortcut({ key: '+', ctrlKey: false, metaKey: false, altKey: false })).toBeNull()
    expect(appZoomShortcut({ key: '+', ctrlKey: true, metaKey: false, altKey: true })).toBeNull()
  })
})

describe('sidebarPaperFilter', () => {
  const rows = [
    paper(1, 'Attention Is All You Need', ['Transformers']),
    paper(2, 'Sparse Models', ['Mixture of Experts']),
  ]

  it('keeps the library order when no query is provided', () => {
    expect(sidebarPaperFilter(rows, '')).toEqual(rows)
  })

  it('matches titles and tags without case sensitivity', () => {
    expect(sidebarPaperFilter(rows, 'attention').map((row) => row.id)).toEqual([1])
    expect(sidebarPaperFilter(rows, 'EXPERTS').map((row) => row.id)).toEqual([2])
  })
})

describe('isReaderRoute', () => {
  it('recognizes valid paper reader paths', () => {
    expect(isReaderRoute('/read/37')).toBe(true)
  })

  it('rejects non-reader and malformed paths', () => {
    expect(isReaderRoute('/')).toBe(false)
    expect(isReaderRoute('/settings')).toBe(false)
    expect(isReaderRoute('/read/not-a-number')).toBe(false)
  })
})
