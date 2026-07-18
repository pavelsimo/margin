// Drag-resize for side panels (papers sidebar, chat sidebar): the returned
// callback ref attaches listeners when the handle mounts and cleans up when it
// unmounts, so resizing works regardless of when the handle enters the DOM.
import { useCallback, useRef } from 'react'

interface PanelResizeOptions {
  cssVar: string
  storageKey: string
  min: number
  /** Which side of the container the panel sits on. */
  side: 'left' | 'right'
  containerSelector: string
  max: (containerWidth: number) => number
}

// Options must be a module-level constant: the returned ref is memoized once
// and never re-reads them.
export function usePanelResize(opts: PanelResizeOptions): (el: HTMLDivElement | null) => void {
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((handle: HTMLDivElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!handle) return

    const root = document.documentElement
    const container = handle.closest(opts.containerSelector) as HTMLElement | null
    const clampWidth = (w: number) => {
      const available = container?.clientWidth ?? window.innerWidth
      const max = Math.max(opts.min, opts.max(available))
      return Math.min(Math.max(w, opts.min), max)
    }
    const apply = (w: number) => root.style.setProperty(opts.cssVar, clampWidth(w) + 'px')

    const saved = parseInt(localStorage.getItem(opts.storageKey) ?? '', 10)
    if (!Number.isNaN(saved)) apply(saved)

    const widthFromPointer = (ev: PointerEvent) => {
      const rect = container?.getBoundingClientRect()
      return opts.side === 'right'
        ? (rect?.right ?? window.innerWidth) - ev.clientX
        : ev.clientX - (rect?.left ?? 0)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      handle.setPointerCapture(e.pointerId)
      handle.classList.add('dragging')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const move = (ev: PointerEvent) => apply(widthFromPointer(ev))
      const up = () => {
        handle.classList.remove('dragging')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const w = parseInt(root.style.getPropertyValue(opts.cssVar), 10)
        if (!Number.isNaN(w)) localStorage.setItem(opts.storageKey, String(w))
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    }

    const onDblClick = () => {
      // reset to default width
      root.style.removeProperty(opts.cssVar)
      localStorage.removeItem(opts.storageKey)
    }

    const onResize = () => {
      const current = parseInt(root.style.getPropertyValue(opts.cssVar), 10)
      if (!Number.isNaN(current)) apply(current)
    }

    handle.addEventListener('pointerdown', onPointerDown)
    handle.addEventListener('dblclick', onDblClick)
    window.addEventListener('resize', onResize)
    cleanupRef.current = () => {
      handle.removeEventListener('pointerdown', onPointerDown)
      handle.removeEventListener('dblclick', onDblClick)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
