import { useLayoutEffect, useRef } from 'react'
import { BASE_PAGE_WIDTH, MODE_LABELS, type Mode } from '@shared/constants'
import { useReaderStore } from '../../state/readerStore'
import { useUiStore } from '../../state/uiStore'
import { useBlockSelection } from '../../hooks/useBlockSelection'
import { openingZoomForWidth } from '../../lib/zoom'

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function SelectionToolbar() {
  const store = useReaderStore()
  const setAssistantOpen = useUiStore((state) => state.setAssistantOpen)
  const hasRegion = store.selectedRegion.length === 4
  const selected = store.pageBlocks.filter((b) => store.selectedBlockIds.includes(b.id))
  const left = hasRegion ? store.selectedRegion[0] : selected.length ? Math.min(...selected.map((b) => b.x0)) : 0
  const top = hasRegion ? store.selectedRegion[1] : selected.length ? Math.min(...selected.map((b) => b.y0)) : 0
  return (
    <div
      className="reader-selection-toolbar"
      style={{ left: pct(left), top: pct(top) }}
      onClick={(e) => e.stopPropagation()}
    >
      {hasRegion ? (
        <span className="sel-info">Region · page {store.selectedRegionPage}</span>
      ) : (
        store.selectedBlockIds.length > 1 && <span className="sel-info">{store.selectedBlockIds.length} blocks</span>
      )}
      <button className="ask-btn" onClick={() => { store.askSelection(); setAssistantOpen(true) }}>
        ✦ Ask
      </button>
      <span className="divider" />
      {(['explain', 'summarize', 'eli12'] as Mode[]).map((mode) => (
        <button key={mode} className="mode-btn" onClick={() => { store.runMode(mode); setAssistantOpen(true) }}>
          {MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  )
}

export default function PageViewer() {
  const store = useReaderStore()
  const pdfTheme = useUiStore((state) => state.pdfTheme)
  const viewerRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useBlockSelection(pageRef)

  useLayoutEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const style = window.getComputedStyle(viewer)
    const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
    store.setZoom(openingZoomForWidth(viewer.clientWidth - horizontalPadding))
  }, [store.documentId, store.setZoom])

  const hasRegion = store.selectedRegion.length === 4
  const hasSelection = store.selectedBlockIds.length > 0 || hasRegion
  const width = Math.floor((BASE_PAGE_WIDTH * store.zoom) / 100)

  return (
    <div ref={viewerRef} className="reader-viewer">
      <div ref={pageRef} className={`reader-pdf-page ${pdfTheme === 'dark' ? 'pdf-dark' : ''}`} style={{ width }} onClick={store.clearSelection}>
        {store.pageImage && <img src={store.pageImage} draggable={false} alt="" />}
        {store.pageBlocks.map((b) => (
          <div
            key={b.id}
            className={`reader-block ${store.selectedBlockIds.includes(b.id) ? 'selected' : ''}`}
            data-block-id={b.id}
            data-block-kind={b.kind}
            style={{
              left: pct(b.x0),
              top: pct(b.y0),
              width: pct(b.x1 - b.x0),
              height: pct(b.y1 - b.y0),
            }}
            onClick={(e) => {
              e.stopPropagation()
              store.selectBlock(b.id, { ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey })
            }}
          />
        ))}
        {hasRegion && (
          <div
            className="region-highlight"
            style={{
              left: pct(store.selectedRegion[0]),
              top: pct(store.selectedRegion[1]),
              width: pct(store.selectedRegion[2] - store.selectedRegion[0]),
              height: pct(store.selectedRegion[3] - store.selectedRegion[1]),
            }}
          />
        )}
        <div className="reader-selection-marquee" />
        {hasSelection && <SelectionToolbar />}
      </div>
    </div>
  )
}
