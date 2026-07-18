// Worker-thread entry for CPU-heavy PDF work. mupdf's WASM calls are synchronous;
// running them here keeps the main process (and every IPC handler) responsive.
// Receives { pdfPath }, posts { kind: 'meta' } then one { kind: 'page' } per page,
// then { kind: 'done' } — or { kind: 'error' } on any failure.

import { parentPort, workerData } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import { extractMetadata, extractPage, openPdf } from './services/pdf'

const port = parentPort!
const { pdfPath } = workerData as { pdfPath: string }

try {
  const pdf = openPdf(readFileSync(pdfPath))
  const pageCount = pdf.countPages()
  const [title, authors] = extractMetadata(pdf)
  port.postMessage({ kind: 'meta', title, authors, pageCount })
  for (let number = 1; number <= pageCount; number++) {
    const page = extractPage(pdf, number)
    const pngBuffer = page.png.buffer as ArrayBuffer
    // transfer, don't copy, the PNG bytes
    port.postMessage({ kind: 'page', page: { ...page, png: pngBuffer } }, [pngBuffer])
  }
  pdf.destroy()
  port.postMessage({ kind: 'done' })
} catch (exc) {
  port.postMessage({ kind: 'error', message: exc instanceof Error ? exc.message : String(exc) || 'IngestError' })
}
