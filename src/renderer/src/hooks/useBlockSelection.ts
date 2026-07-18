// Port of assets/block-selection.js: drag block-region selection and exact
// Shift-drag image-region selection. Pointer tracking and marquee rendering
// stay local; the store receives one payload on pointer-up.
import { useEffect, useRef } from 'react'
import { useReaderStore } from '../state/readerStore'

const DRAG_THRESHOLD = 5

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function useBlockSelection(pageRef: React.RefObject<HTMLDivElement | null>) {
  const suppressClick = useRef(false)

  useEffect(() => {
    const page = pageRef.current
    if (!page) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType === 'touch') return
      const target = event.target as HTMLElement
      if (target.closest?.('.reader-selection-toolbar')) return

      const pageRect = page.getBoundingClientRect()
      const pageImage = page.querySelector('img')
      if (!(pageImage instanceof HTMLImageElement)) return
      const imageRect = pageImage.getBoundingClientRect()
      const startX = clamp(event.clientX, imageRect.left, imageRect.right)
      const startY = clamp(event.clientY, imageRect.top, imageRect.bottom)
      const exactRegion = event.shiftKey
      const additive = event.ctrlKey || event.metaKey
      const marquee = page.querySelector('.reader-selection-marquee') as HTMLElement | null
      if (!marquee || typeof target.setPointerCapture !== 'function') return

      let dragging = false
      let endX = startX
      let endY = startY
      target.setPointerCapture(event.pointerId)

      const draw = () => {
        marquee.style.left = `${Math.min(startX, endX) - pageRect.left}px`
        marquee.style.top = `${Math.min(startY, endY) - pageRect.top}px`
        marquee.style.width = `${Math.abs(endX - startX)}px`
        marquee.style.height = `${Math.abs(endY - startY)}px`
        marquee.style.display = 'block'
      }

      const move = (moveEvent: PointerEvent) => {
        endX = clamp(moveEvent.clientX, imageRect.left, imageRect.right)
        endY = clamp(moveEvent.clientY, imageRect.top, imageRect.bottom)
        if (!dragging && Math.hypot(endX - startX, endY - startY) < DRAG_THRESHOLD) return
        if (!dragging) {
          dragging = true
          page.classList.add('region-selecting')
          document.body.classList.add('reader-region-selecting')
        }
        moveEvent.preventDefault()
        draw()
      }

      const finish = (upEvent: PointerEvent | Event) => {
        target.removeEventListener('pointermove', move)
        target.removeEventListener('pointerup', finish)
        target.removeEventListener('pointercancel', cancel)
        if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
        page.classList.remove('region-selecting')
        document.body.classList.remove('reader-region-selecting')
        marquee.removeAttribute('style')
        if (!dragging) return

        upEvent.preventDefault()
        if ('clientX' in upEvent) {
          endX = clamp((upEvent as PointerEvent).clientX, imageRect.left, imageRect.right)
          endY = clamp((upEvent as PointerEvent).clientY, imageRect.top, imageRect.bottom)
        }
        const left = Math.min(startX, endX)
        const right = Math.max(startX, endX)
        const top = Math.min(startY, endY)
        const bottom = Math.max(startY, endY)
        const { selectRegion } = useReaderStore.getState()
        if (exactRegion) {
          selectRegion({
            kind: 'region',
            x0: (left - imageRect.left) / imageRect.width,
            y0: (top - imageRect.top) / imageRect.height,
            x1: (right - imageRect.left) / imageRect.width,
            y1: (bottom - imageRect.top) / imageRect.height,
          })
        } else {
          const ids = [...page.querySelectorAll('.reader-block:not([data-block-kind="image"])')]
            .filter((block) => {
              const rect = block.getBoundingClientRect()
              const centerX = rect.left + rect.width / 2
              const centerY = rect.top + rect.height / 2
              return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom
            })
            .map((block) => Number.parseInt((block as HTMLElement).dataset.blockId ?? '', 10))
            .filter(Number.isInteger)
          selectRegion({ kind: 'blocks', ids, additive })
        }
        suppressClick.current = true
        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }

      const cancel = () => {
        dragging = false
        finish(new Event('pointercancel'))
      }

      target.addEventListener('pointermove', move)
      target.addEventListener('pointerup', finish)
      target.addEventListener('pointercancel', cancel)
    }

    const onClick = (event: MouseEvent) => {
      if (!suppressClick.current) return
      suppressClick.current = false
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    const onDragStart = (event: DragEvent) => event.preventDefault()

    page.addEventListener('pointerdown', onPointerDown)
    page.addEventListener('click', onClick, true)
    page.addEventListener('dragstart', onDragStart)
    return () => {
      page.removeEventListener('pointerdown', onPointerDown)
      page.removeEventListener('click', onClick, true)
      page.removeEventListener('dragstart', onDragStart)
    }
  }, [pageRef])
}
