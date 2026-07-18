import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { useLibraryStore } from '../state/libraryStore'
import { sidebarPaperFilter } from '../state/uiStore'

export default function PrimarySidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const store = useLibraryStore()
  const [query, setQuery] = useState('')
  const papers = useMemo(() => sidebarPaperFilter(store.allPapers, query), [store.allPapers, query])
  const activeDocId = /^\/read\/(\d+)$/.exec(location.pathname)?.[1]

  const openPaper = async (docId: number) => {
    await store.openPaper(docId)
    navigate(`/read/${docId}`)
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
          papers.map((paper) => (
            <button
              key={paper.id}
              className={`sidebar-paper ${activeDocId === String(paper.id) ? 'active' : ''}`}
              onClick={() => void openPaper(paper.id)}
              title={paper.title}
              role="listitem"
            >
              <span className={`paper-state ${paper.isFailed ? 'failed' : paper.isIngesting || paper.isTagging ? 'working' : ''}`} />
              <span className="sidebar-paper-title">{paper.title}</span>
              {paper.isNew && <span className="sidebar-new">NEW</span>}
            </button>
          ))
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
