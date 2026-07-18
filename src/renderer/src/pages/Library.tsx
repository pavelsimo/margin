import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PaperRow } from '@shared/ipc'
import Icon from '../components/Icon'
import { filterPaperRows, useLibraryStore } from '../state/libraryStore'

function PaperPreview({ paper }: { paper: PaperRow }) {
  if (paper.previewUrl) {
    return <img src={paper.previewUrl} loading="lazy" draggable={false} alt="" />
  }

  if (paper.isFailed) {
    return (
      <div className="paper-preview-state failed">
        <span className="preview-state-mark">×</span>
        <span>Preview unavailable</span>
      </div>
    )
  }

  if (paper.isIngesting || !paper.isReady) {
    return (
      <div className="paper-preview-state processing">
        <span className="spinner" />
        <span>Rendering first page…</span>
      </div>
    )
  }

  return (
    <div className="paper-preview-state missing">
      <span className="preview-state-mark">—</span>
      <span>Preview unavailable</span>
    </div>
  )
}

function PaperCard({ paper }: { paper: PaperRow }) {
  const navigate = useNavigate()
  const { askDelete, openPaper } = useLibraryStore()

  const open = async () => {
    await openPaper(paper.id)
    navigate(`/read/${paper.id}`)
  }

  return (
    <article className="paper-card">
      <button className="paper-card-open" onClick={() => void open()} aria-label={`Open ${paper.title}`}>
        <div className="paper-cover">
          <PaperPreview paper={paper} />
          <div className="paper-cover-badges">
            {paper.isNew && <span className="badge-new">NEW</span>}
            {paper.isFailed ? (
              <span className="paper-status-badge failed">Failed</span>
            ) : paper.isIngesting || !paper.isReady ? (
              <span className="paper-status-badge processing">Processing…</span>
            ) : paper.isTagging ? (
              <span className="paper-status-badge processing">Finding topics…</span>
            ) : null}
          </div>
        </div>
        <div className="paper-card-copy">
          <h3 title={paper.title}>{paper.title}</h3>
          <div className="paper-card-meta mono">
            <span>{paper.pagesLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{paper.added}</span>
          </div>
        </div>
      </button>
      <button
        className="paper-card-delete"
        title="Delete paper"
        aria-label={`Delete ${paper.title}`}
        onClick={() => askDelete(paper.id)}
      >
        ×
      </button>
    </article>
  )
}

function AddPaperBar({ urlInputRef }: { urlInputRef: RefObject<HTMLInputElement | null> }) {
  const store = useLibraryStore()
  const fileInput = useRef<HTMLInputElement>(null)
  const adding = store.addingSource !== null

  return (
    <section className="home-add-bar" aria-label="Add a paper">
      <form
        className="home-add-row"
        onSubmit={(event) => {
          event.preventDefault()
          void store.addByLink()
        }}
      >
        <div className="home-add-input-wrap">
          <Icon name="link" className="home-add-link-icon" />
          <input
            ref={urlInputRef}
            id="paper-url"
            className="text-input mono-input home-add-input"
            placeholder="Paste an arXiv link or PDF URL…"
            aria-label="arXiv link or PDF URL"
            value={store.linkUrl}
            disabled={adding}
            onChange={(event) => store.setLinkUrl(event.target.value)}
          />
          <button
            type="button"
            className="home-attach-btn"
            title="Choose a PDF file"
            aria-label="Choose a PDF file"
            disabled={adding}
            onClick={() => fileInput.current?.click()}
          >
            {store.addingSource === 'file' ? <span className="spinner" /> : <Icon name="paperclip" />}
          </button>
        </div>
        <button className="btn home-add-submit" type="submit" disabled={!store.linkUrl.trim() || adding}>
          {store.addingSource === 'link' ? <><span className="spinner" /> Fetching…</> : 'Add paper'}
        </button>
      </form>
      <div className="home-add-meta">
        {store.addError ? (
          <span className="error-text" role="alert">{store.addError}</span>
        ) : store.addingSource === 'file' ? (
          <span className="home-add-hint">Uploading…</span>
        ) : (
          <span className="home-add-hint">or drop a PDF anywhere in this window · up to 50 MB</span>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        disabled={adding}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file && !adding) void store.addByFile(file)
          event.currentTarget.value = ''
        }}
      />
    </section>
  )
}

function LoadingGrid() {
  return (
    <div className="paper-grid" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div className="paper-card paper-card-skeleton" key={index}>
          <div className="paper-cover" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ))}
    </div>
  )
}

export default function Home() {
  const store = useLibraryStore()
  const urlInputRef = useRef<HTMLInputElement>(null)
  const view = useMemo(
    () => filterPaperRows(store.allPapers, store.query),
    [store.allPapers, store.query],
  )
  const countLabel = `${view.length} ${view.length === 1 ? 'paper' : 'papers'}`

  useEffect(() => {
    if (store.addFocusRequest > 0) {
      urlInputRef.current?.focus()
      urlInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [store.addFocusRequest])

  return (
    <section className="route-page">
      <header className="route-header home-route-header">
        <h1>Home</h1>
      </header>
      <div className="route-scroll">
        <main className="home-content">
          <AddPaperBar urlInputRef={urlInputRef} />
          <section className="home-papers" aria-labelledby="papers-heading">
            <div className="home-papers-header">
              <div className="route-title-group">
                <h2 id="papers-heading">Papers</h2>
                <span className="mono">{countLabel}</span>
              </div>
              <label className="search-box home-search">
                <Icon name="search" className="search-svg" />
                <input
                  className="text-input"
                  placeholder="Search papers or topics…"
                  value={store.query}
                  onChange={(event) => store.setQuery(event.target.value)}
                />
              </label>
            </div>
            {!store.loaded ? (
              <LoadingGrid />
            ) : store.allPapers.length === 0 ? (
              <div className="home-empty-state">
                <span className="spark">✦</span>
                <span className="empty-title">Your paper collection is empty</span>
                <span className="empty-copy">Paste a link above or drop a PDF anywhere in this window.</span>
              </div>
            ) : view.length === 0 ? (
              <div className="home-empty-state compact">
                <span className="empty-title">No matching papers</span>
                <span className="empty-copy">Try another title or topic.</span>
              </div>
            ) : (
              <div className="paper-grid">
                {view.map((paper) => <PaperCard key={paper.id} paper={paper} />)}
              </div>
            )}
          </section>
        </main>
      </div>
    </section>
  )
}
