// PDF rendering and extraction via mupdf.js (WASM build of the same engine
// PyMuPDF wraps, so metrics match the data ingested by the web app).
// Port of the PyMuPDF usage in margin/ingest.py.

import { readFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

export const RENDER_ZOOM = 2.0
export const MIN_BLOCK_AREA = 0.002 // fraction of page area; drops noise blocks
const JUNK_TITLES = new Set(['', 'untitled', 'unknown'])

export type NormalizedBBox = [number, number, number, number]

export interface ExtractedBlock {
  kind: 'text' | 'image'
  text: string
  bbox: NormalizedBBox
}

export interface ExtractedPage {
  number: number // 1-based
  png: Buffer
  width: number // PDF points
  height: number
  text: string
  blocks: ExtractedBlock[]
}

interface StLine {
  bbox: { x: number; y: number; w: number; h: number }
  wmode: number
  text: string
  font?: { size?: number }
  x?: number
  y?: number
}

interface StBlock {
  type: 'text' | 'image'
  bbox: { x: number; y: number; w: number; h: number }
  lines?: StLine[]
}

export function openPdf(data: Buffer): mupdf.PDFDocument {
  return mupdf.Document.openDocument(data, 'application/pdf') as mupdf.PDFDocument
}

function pageSize(page: mupdf.PDFPage): [number, number] {
  const [x0, y0, x1, y1] = page.getBounds()
  return [x1 - x0, y1 - y0]
}

function renderPagePng(page: mupdf.PDFPage): Buffer {
  const pixmap = page.toPixmap(mupdf.Matrix.scale(RENDER_ZOOM, RENDER_ZOOM), mupdf.ColorSpace.DeviceRGB, false, true)
  const png = Buffer.from(pixmap.asPNG())
  pixmap.destroy()
  return png
}

function structuredText(page: mupdf.PDFPage): { blocks: StBlock[] } {
  const st = page.toStructuredText('preserve-whitespace,preserve-images')
  const parsed = JSON.parse(st.asJSON()) as { blocks: StBlock[] }
  st.destroy()
  return parsed
}

function normalize(bbox: { x: number; y: number; w: number; h: number }, width: number, height: number): NormalizedBBox {
  return [
    Math.max(0, bbox.x / width),
    Math.max(0, bbox.y / height),
    Math.min(1, (bbox.x + bbox.w) / width),
    Math.min(1, (bbox.y + bbox.h) / height),
  ]
}

function areaFraction(bbox: { w: number; h: number }, width: number, height: number): number {
  return (bbox.w * bbox.h) / (width * height)
}

/** Selectable regions of a page, bboxes normalized to fractions of the page size.
 *  Unlike the web app there is no table detection, since mupdf.js lacks PyMuPDF's
 *  pure-Python find_tables, so new ingestion yields text and image blocks only. */
export function extractBlocks(page: mupdf.PDFPage): ExtractedBlock[] {
  const [width, height] = pageSize(page)
  const blocks: ExtractedBlock[] = []
  for (const raw of structuredText(page).blocks) {
    if (areaFraction(raw.bbox, width, height) < MIN_BLOCK_AREA) continue
    if (raw.type === 'text') {
      const text = (raw.lines ?? []).map((line) => line.text).join('\n').trim()
      if (text) blocks.push({ kind: 'text', text, bbox: normalize(raw.bbox, width, height) })
    } else {
      blocks.push({ kind: 'image', text: '', bbox: normalize(raw.bbox, width, height) })
    }
  }
  return blocks.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
}

export function extractPageText(page: mupdf.PDFPage): string {
  const st = page.toStructuredText('preserve-whitespace')
  const text = st.asText().trim()
  st.destroy()
  return text
}

export function extractPage(pdf: mupdf.PDFDocument, number: number): ExtractedPage {
  const page = pdf.loadPage(number - 1) as mupdf.PDFPage
  const [width, height] = pageSize(page)
  const extracted: ExtractedPage = {
    number,
    png: renderPagePng(page),
    width,
    height,
    text: extractPageText(page),
    blocks: extractBlocks(page),
  }
  page.destroy()
  return extracted
}

/** Best-effort (title, authors) from PDF metadata, falling back to first-page layout. */
export function extractMetadata(pdf: mupdf.PDFDocument): [string, string] {
  const metaTitle = (pdf.getMetaData('info:Title') ?? '').trim()
  if (!JUNK_TITLES.has(metaTitle.toLowerCase()) && !metaTitle.toLowerCase().endsWith('.pdf')) {
    return [metaTitle, (pdf.getMetaData('info:Author') ?? '').trim()]
  }
  if (pdf.countPages() === 0) return ['Untitled paper', '']
  const page = pdf.loadPage(0) as mupdf.PDFPage
  const result = titleFromLayout(page)
  page.destroy()
  return result
}

/** Largest-font line cluster in the top half of page 1 is the title; the row below is authors. */
function titleFromLayout(firstPage: mupdf.PDFPage): [string, string] {
  const [, height] = pageSize(firstPage)
  const half = height / 2
  const lines: { size: number; y: number; text: string }[] = []
  for (const raw of structuredText(firstPage).blocks) {
    if (raw.type !== 'text') continue
    for (const line of raw.lines ?? []) {
      const text = line.text.trim()
      if (!text || line.bbox.y > half) continue
      if (line.wmode !== 0) continue // vertical text, e.g. the arXiv margin stamp
      if (text.toLowerCase().startsWith('arxiv:')) continue
      lines.push({ size: line.font?.size ?? 0, y: line.bbox.y, text })
    }
  }
  if (!lines.length) return ['Untitled paper', '']
  const topSize = Math.max(...lines.map((l) => l.size))
  const titleLines = lines.filter((l) => l.size >= topSize - 0.5).sort((a, b) => a.y - b.y)
  const title = titleLines.map((l) => l.text).join(' ')
  const titleBottom = Math.max(...titleLines.map((l) => l.y))
  const below = lines.filter((l) => l.y > titleBottom && l.size < topSize - 0.5).sort((a, b) => a.y - b.y)
  if (!below.length) return [title.slice(0, 300), '']
  // authors are often laid out in columns: join every line within one row-height of the first
  const firstY = below[0].y
  const authors = below.filter((l) => l.y - firstY < 14).map((l) => l.text).join(', ')
  return [title.slice(0, 300), authors.slice(0, 300)]
}

function validNormalizedBbox(bbox: number[]): bbox is NormalizedBBox {
  if (bbox.length !== 4 || !bbox.every((v) => typeof v === 'number' && Number.isFinite(v))) return false
  const [x0, y0, x1, y1] = bbox
  return x0 >= 0 && x0 < x1 && x1 <= 1 && y0 >= 0 && y0 < y1 && y1 <= 1
}

/** Render a normalized page rectangle as PNG from the original PDF at the given zoom.
 *  Port of ingest.render_page_region_image; returns null when unavailable. */
export function renderPageRegionImage(
  pdfPath: string,
  pageNumber: number,
  bbox: number[],
  zoom: number = RENDER_ZOOM,
): Buffer | null {
  if (!validNormalizedBbox(bbox)) return null
  try {
    const pdf = openPdf(readFileSync(pdfPath))
    try {
      const page = pdf.loadPage(pageNumber - 1) as mupdf.PDFPage
      const [width, height] = pageSize(page)
      const [x0, y0, x1, y1] = bbox
      const matrix = mupdf.Matrix.scale(zoom, zoom)
      // The pixmap's bbox (in device space) acts as the clip, like PyMuPDF's clip=.
      const clip: [number, number, number, number] = [
        Math.floor(x0 * width * zoom),
        Math.floor(y0 * height * zoom),
        Math.ceil(x1 * width * zoom),
        Math.ceil(y1 * height * zoom),
      ]
      if (clip[2] <= clip[0] || clip[3] <= clip[1]) return null
      const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, clip, false)
      pixmap.clear(255)
      const device = new mupdf.DrawDevice(matrix, pixmap)
      page.run(device, mupdf.Matrix.identity)
      device.close()
      const png = Buffer.from(pixmap.asPNG())
      pixmap.destroy()
      page.destroy()
      return png
    } finally {
      pdf.destroy()
    }
  } catch {
    // corrupt file or bad page index; caller shows a friendly error
    return null
  }
}
