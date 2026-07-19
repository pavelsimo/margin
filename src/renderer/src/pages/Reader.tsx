import { useEffect, useLayoutEffect } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import PageViewer from '../components/reader/PageViewer'
import PageNav from '../components/reader/PageNav'
import ChatSidebar from '../components/chat/ChatSidebar'
import { usePanelResize } from '../hooks/usePanelResize'
import { readerShortcut, type ReaderShortcutAction } from '../lib/readerShortcuts'
import { useReaderStore } from '../state/readerStore'
import { useUiStore } from '../state/uiStore'

const CHAT_RESIZE = {
  cssVar: '--chat-width',
  storageKey: 'margin.chatWidth',
  min: 280,
  side: 'right',
  containerSelector: '.reader-body',
  max: (w: number) => Math.min(Math.round(w * 0.6), w - 360)
} as const

function NotReadyState() {
  const { doc } = useReaderStore()
  return (
    <div className="not-ready">
      {doc?.failed ? (
        <><span className="not-ready-title">This paper failed to process</span><span className="mono error-text">{doc.failMessage}</span></>
      ) : (
        <><span className="spinner" /><span className="not-ready-copy">Processing pages…</span></>
      )}
      <Link to="/" className="accent-link">Back to home</Link>
    </div>
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function runReaderShortcut(action: ReaderShortcutAction): void {
  const store = useReaderStore.getState()
  if (action === 'previous-page') store.prevPage()
  else if (action === 'next-page') store.nextPage()
  else if (action === 'zoom-in') store.zoomIn()
  else store.zoomOut()
}

export default function Reader() {
  const { docId, threadId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const store = useReaderStore()
  const { assistantOpen, pdfTheme, toggleAssistant, togglePdfTheme } = useUiStore()
  const handleRef = usePanelResize(CHAT_RESIZE)

  useLayoutEffect(() => {
    const id = Number(docId)
    if (!Number.isInteger(id) || id <= 0) return
    const isNewRoute = location.pathname.endsWith('/new')
    const requestedThreadId = isNewRoute ? null : threadId ? Number(threadId) : undefined
    const state = useReaderStore.getState()
    if (isNewRoute && state.activeThreadId) store.startNewChat(id)
    if (
      requestedThreadId !== null &&
      requestedThreadId !== undefined &&
      state.documentId === id &&
      state.activeThreadId === requestedThreadId &&
      state.doc
    ) return
    void store.loadReader(id, requestedThreadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, threadId, location.key])

  useEffect(() => {
    const id = Number(docId)
    if (!Number.isInteger(id) || id <= 0 || store.documentId !== id || !store.activeThreadId) return
    const expected = `/read/${id}/chat/${store.activeThreadId}`
    if (location.pathname !== expected) navigate(expected, { replace: true })
  }, [docId, location.pathname, navigate, store.activeThreadId, store.documentId])

  useEffect(() => {
    const id = Number(docId)
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useReaderStore.getState()
      const action = readerShortcut(event, {
        ready: Number.isInteger(id) && state.documentId === id && state.doc?.ready === true,
        editable: isEditableTarget(event.target),
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
      })
      if (!action) return
      event.preventDefault()
      runReaderShortcut(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [docId])

  const loaded = store.doc && store.documentId === Number(docId)

  return (
    <section className="route-page reader-route">
      <header className="route-header reader-route-header">
        <div className="reader-heading">
          <span className="route-eyebrow">Paper</span>
          <h1 title={store.doc?.title}>{store.doc?.title || 'Loading paper…'}</h1>
        </div>
        <div className="reader-header-actions">
          <button
            className={`route-icon-button ${pdfTheme === 'dark' ? 'active' : ''}`}
            onClick={togglePdfTheme}
            title={pdfTheme === 'dark' ? 'Use light PDF view' : 'Use dark PDF view'}
            aria-label={pdfTheme === 'dark' ? 'Use light PDF view' : 'Use dark PDF view'}
            aria-pressed={pdfTheme === 'dark'}
          >
            <Icon name={pdfTheme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button className={`route-icon-button ${assistantOpen ? 'active' : ''}`} onClick={toggleAssistant} title="Toggle assistant" aria-label="Toggle assistant" aria-pressed={assistantOpen}>
            <Icon name="assistant" />
          </button>
        </div>
      </header>
      {loaded && store.doc!.scanned && <div className="scanned-notice">This PDF has little or no text layer (it may be scanned), so block selection and answers will be limited.</div>}
      {!loaded ? (
        <div className="not-ready"><span className="spinner" /></div>
      ) : store.doc!.ready ? (
        <div className="reader-body">
          <div className="reader-viewer-wrap"><PageViewer /><PageNav /></div>
          {assistantOpen && <><div ref={handleRef} className="panel-resize-handle chat-resize-handle" /><ChatSidebar /></>}
        </div>
      ) : <NotReadyState />}
    </section>
  )
}
