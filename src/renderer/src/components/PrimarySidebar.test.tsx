import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatThreadSummary, DocumentInfo, PaperRow } from '@shared/ipc'
import PrimarySidebar from './PrimarySidebar'

const { mockReaderState, mockStore, mockUiState } = vi.hoisted(() => ({
  mockReaderState: {
    currentPage: 1,
    doc: null as DocumentInfo | null,
    goToPage: vi.fn(),
    startNewChat: vi.fn(),
  },
  mockStore: {
    allPapers: [] as PaperRow[],
    chatThreads: [] as ChatThreadSummary[],
    loaded: false,
    openPaper: vi.fn().mockResolvedValue(undefined),
    requestAddFocus: vi.fn(),
  },
  mockUiState: { documentOutlineOpen: false },
}))

vi.mock('../state/libraryStore', () => ({ useLibraryStore: () => mockStore }))
vi.mock('../state/readerStore', () => ({
  useReaderStore: Object.assign(
    (selector: (state: typeof mockReaderState) => unknown) => selector(mockReaderState),
    { getState: () => mockReaderState },
  ),
}))
vi.mock('../state/uiStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('../state/uiStore')>(),
  useUiStore: (selector: (state: typeof mockUiState) => unknown) => selector(mockUiState),
}))

const paper: PaperRow = {
  id: 7,
  title: 'Attention Is All You Need',
  tags: ['transformers'],
  previewUrl: null,
  pagesLabel: '15 pp',
  added: 'Jul 19',
  isNew: false,
  isFailed: false,
  isIngesting: false,
  isTagging: false,
  isReady: true,
}

const threads: ChatThreadSummary[] = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  documentId: paper.id,
  title: `Paper chat ${index + 1}`,
  createdAt: `2026-07-${19 - index}`,
  updatedAt: `2026-07-${19 - index}`,
}))

describe('PrimarySidebar chat groups', () => {
  afterEach(() => {
    mockStore.allPapers = []
    mockStore.chatThreads = []
    mockStore.loaded = false
    mockUiState.documentOutlineOpen = false
    mockReaderState.doc = null
    mockReaderState.currentPage = 1
  })

  it('renders a paper group, a new-chat action, five chats, and Show more', () => {
    mockStore.allPapers = [paper]
    mockStore.chatThreads = threads
    mockStore.loaded = true
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/read/7/chat/1']}>
        <PrimarySidebar />
      </MemoryRouter>,
    )

    expect(html).toContain('Attention Is All You Need')
    expect(html).toContain('aria-label="New chat for Attention Is All You Need"')
    expect((html.match(/class="sidebar-chat/g) ?? [])).toHaveLength(5)
    expect(html).toContain('Show more')
    expect(html).toContain('sidebar-chat active')
    expect(html).not.toContain('Paper chat 6')
  })

  it('replaces the paper list with a nested document outline', () => {
    mockStore.allPapers = [paper]
    mockStore.loaded = true
    mockUiState.documentOutlineOpen = true
    mockReaderState.currentPage = 3
    mockReaderState.doc = {
      id: paper.id,
      title: paper.title,
      authors: '',
      pageCount: 15,
      ready: true,
      failed: false,
      failMessage: '',
      scanned: false,
      outline: [
        { title: 'Introduction', page: 1, children: [] },
        { title: 'Architecture', page: 3, children: [{ title: 'Attention', page: 4, children: [] }] },
      ],
    }

    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/read/7/chat/1']}>
        <PrimarySidebar />
      </MemoryRouter>,
    )

    expect(html).toContain('Document outline')
    expect(html).toContain('Back to library')
    expect(html).toContain('Introduction')
    expect(html).toContain('Architecture')
    expect(html).toContain('Attention')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('Find a paper…')
  })
})
