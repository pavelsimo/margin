import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useLibraryStore } from '../state/libraryStore'
import { useReaderStore } from '../state/readerStore'
import { sidebarPaperFilter, visibleSidebarThreads } from '../state/uiStore'

export default function PrimarySidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const store = useLibraryStore()
  const [query, setQuery] = useState('')
  const [expandedPapers, setExpandedPapers] = useState<Set<number>>(() => new Set())
  const papers = useMemo(() => sidebarPaperFilter(store.allPapers, query), [store.allPapers, query])
  const activeRoute = /^\/read\/(\d+)(?:\/chat\/(\d+)|\/new)?$/.exec(location.pathname)
  const activeDocId = activeRoute?.[1]
  const activeThreadId = activeRoute?.[2]

  useEffect(() => {
    if (!activeDocId || !activeThreadId) return
    const paperThreads = store.chatThreads.filter((thread) => thread.documentId === Number(activeDocId))
    if (paperThreads.findIndex((thread) => thread.id === Number(activeThreadId)) < 5) return
    setExpandedPapers((current) => {
      if (current.has(Number(activeDocId))) return current
      const next = new Set(current)
      next.add(Number(activeDocId))
      return next
    })
  }, [activeDocId, activeThreadId, store.chatThreads])

  const openPaper = async (docId: number) => {
    await store.openPaper(docId)
    const latest = store.chatThreads.find((thread) => thread.documentId === docId)
    navigate(latest ? `/read/${docId}/chat/${latest.id}` : `/read/${docId}/new`)
  }

  const newChat = async (docId: number) => {
    useReaderStore.getState().startNewChat(docId)
    await store.openPaper(docId)
    navigate(`/read/${docId}/new`)
  }

  const toggleExpanded = (docId: number) => {
    setExpandedPapers((current) => {
      const next = new Set(current)
      if (next.has(docId)) next.delete(docId)
      else next.add(docId)
      return next
    })
  }

  const showAddControls = () => {
    navigate('/')
    store.requestAddFocus()
  }

  return (
    <aside className="primary-sidebar">
      <div className="sidebar-brand">
        <span className="app-logo" />
        <span>Margin</span>
      </div>
      <nav className="sidebar-primary" aria-label="Primary">
        <button className={`sidebar-action ${location.pathname === '/' ? 'active' : ''}`} onClick={() => navigate('/')}>
          <Icon name="home" />
          <span>Home</span>
        </button>
        <button className="sidebar-action" onClick={showAddControls}>
          <Icon name="plus" />
          <span>Add paper</span>
        </button>
      </nav>
      <div className="sidebar-section-head">
        <span>Papers</span>
        <span className="mono">{store.allPapers.length}</span>
      </div>
      <label className="sidebar-search">
        <Icon name="search" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a paper…" />
      </label>
      <div className="sidebar-papers" role="list">
        {store.loaded && papers.length === 0 ? (
          <span className="sidebar-empty">{query ? 'No matching papers' : 'No papers yet'}</span>
        ) : (
          papers.map((paper) => {
            const threads = store.chatThreads.filter((thread) => thread.documentId === paper.id)
            const expanded = expandedPapers.has(paper.id)
            const visibleThreads = visibleSidebarThreads(threads, expanded)
            const showingAll = visibleThreads.length === threads.length
            return (
              <div className="sidebar-paper-group" key={paper.id} role="listitem">
                <div className={`sidebar-paper-header ${activeDocId === String(paper.id) ? 'active' : ''}`}>
                  <button className="sidebar-paper-main" onClick={() => void openPaper(paper.id)} title={paper.title}>
                    <Icon name="document" />
                    <span className="sidebar-paper-title">{paper.title}</span>
                    {paper.isNew && <span className="sidebar-new">NEW</span>}
                  </button>
                  <button
                    className="sidebar-new-chat"
                    type="button"
                    onClick={() => void newChat(paper.id)}
                    title={`New chat for ${paper.title}`}
                    aria-label={`New chat for ${paper.title}`}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                {visibleThreads.map((thread) => (
                  <button
                    key={thread.id}
                    className={`sidebar-chat ${activeThreadId === String(thread.id) ? 'active' : ''}`}
                    onClick={() => void store.openPaper(paper.id).then(() => navigate(`/read/${paper.id}/chat/${thread.id}`))}
                    title={thread.title}
                  >
                    <span>{thread.title}</span>
                  </button>
                ))}
                {threads.length > 5 && (
                  <button className="sidebar-show-more" type="button" onClick={() => toggleExpanded(paper.id)}>
                    {showingAll ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      <div className="sidebar-footer">
        <button className={`sidebar-action ${location.pathname === '/settings' ? 'active' : ''}`} onClick={() => navigate('/settings')}>
          <span className="settings-avatar"><Icon name="settings" /></span>
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
