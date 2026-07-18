import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import PageViewer from '../components/reader/PageViewer'
import PageNav from '../components/reader/PageNav'
import ChatSidebar from '../components/chat/ChatSidebar'
import { usePanelResize } from '../hooks/usePanelResize'
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

export default function Reader() {
  const { docId } = useParams()
  const store = useReaderStore()
  const { assistantOpen, toggleAssistant } = useUiStore()
  const handleRef = usePanelResize(CHAT_RESIZE)

  useEffect(() => {
    const id = Number(docId)
    if (Number.isInteger(id) && id > 0) void store.loadReader(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const loaded = store.doc && store.documentId === Number(docId)

  return (
    <section className="route-page reader-route">
      <header className="route-header reader-route-header">
        <div className="reader-heading">
          <span className="route-eyebrow">Paper</span>
          <h1 title={store.doc?.title}>{store.doc?.title || 'Loading paper…'}</h1>
        </div>
        <button className={`route-icon-button ${assistantOpen ? 'active' : ''}`} onClick={toggleAssistant} title="Toggle assistant" aria-label="Toggle assistant" aria-pressed={assistantOpen}>
          <Icon name="assistant" />
        </button>
      </header>
      {loaded && store.doc!.scanned && <div className="scanned-notice">This PDF has little or no text layer (it may be scanned) — block selection and answers will be limited.</div>}
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
