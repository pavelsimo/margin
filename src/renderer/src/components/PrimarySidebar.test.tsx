import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatThreadSummary, PaperRow } from '@shared/ipc'
import PrimarySidebar from './PrimarySidebar'

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    allPapers: [] as PaperRow[],
    chatThreads: [] as ChatThreadSummary[],
    loaded: false,
    openPaper: vi.fn().mockResolvedValue(undefined),
    requestAddFocus: vi.fn(),
  },
}))

vi.mock('../state/libraryStore', () => ({ useLibraryStore: () => mockStore }))

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
})
