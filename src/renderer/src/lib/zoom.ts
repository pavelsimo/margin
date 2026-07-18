import { BASE_PAGE_WIDTH, ZOOM_LEVELS } from '@shared/constants'

const DEFAULT_ZOOM = 100

export function openingZoomForWidth(contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return DEFAULT_ZOOM

  let zoom = DEFAULT_ZOOM
  for (const level of ZOOM_LEVELS) {
    if (level < DEFAULT_ZOOM) continue
    if ((BASE_PAGE_WIDTH * level) / 100 > contentWidth) break
    zoom = level
  }
  return zoom
}
