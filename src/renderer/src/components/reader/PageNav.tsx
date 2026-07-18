import { ZOOM_LEVELS } from '@shared/constants'
import { useReaderStore } from '../../state/readerStore'

export default function PageNav() {
  const store = useReaderStore()
  const pageCount = store.doc?.pageCount ?? 0
  return (
    <div className="page-nav">
      <div className="pill">
        <button onClick={store.prevPage} disabled={store.currentPage <= 1}>
          ‹
        </button>
        <span className="nav-label">
          Page {store.currentPage} / {pageCount}
        </span>
        <button onClick={store.nextPage} disabled={store.currentPage >= pageCount}>
          ›
        </button>
        <span className="nav-divider" />
        <button onClick={store.zoomOut} disabled={store.zoom <= ZOOM_LEVELS[0]}>
          −
        </button>
        <span className="nav-label" style={{ padding: '0 6px' }}>
          {store.zoom}%
        </span>
        <button onClick={store.zoomIn} disabled={store.zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}>
          +
        </button>
      </div>
    </div>
  )
}
