// Ingestion orchestration. Port of ingest.create_document / ingest_document:
// the worker renders and extracts; this module owns all file and DB writes.

import { Worker } from 'node:worker_threads'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExtractedPage } from './pdf'
import { db, utcnowSql, USER_ID } from '../db'
import { documentDir } from '../paths'
import { validatePdf } from './fetchPdf'

export function createDocument(pdfBytes: Buffer, sourceUrl = ''): number {
  validatePdf(pdfBytes)
  // Two-phase like the web app: row first (for the id-based path), then the file.
  const info = db
    .prepare('INSERT INTO document (user_id, title, authors, venue, tags, source_url, pdf_path, page_count, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(USER_ID, 'Untitled paper', '', '', '', sourceUrl, '', 0, utcnowSql())
  const docId = Number(info.lastInsertRowid)
  const dir = documentDir(docId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'original.pdf'), pdfBytes)
  const pdfPath = `uploaded_files/docs/${docId}/original.pdf` // same project-relative format as the web app
  db.prepare('UPDATE document SET pdf_path = ? WHERE id = ?').run(pdfPath, docId)
  return docId
}

type WorkerMessage =
  | { kind: 'meta'; title: string; authors: string; pageCount: number }
  | { kind: 'page'; page: Omit<ExtractedPage, 'png'> & { png: ArrayBuffer } }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

/** Render pages and extract blocks. Records an ingestionerror row and returns false on failure. */
export function ingestDocument(docId: number, workerPath: string, absPdfPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const worker = new Worker(workerPath, { workerData: { pdfPath: absPdfPath } })
    let failed = false

    const fail = (message: string) => {
      if (failed) return
      failed = true
      db.prepare('INSERT INTO ingestionerror (document_id, message, created_at) VALUES (?, ?, ?)').run(
        docId,
        message,
        utcnowSql(),
      )
      void worker.terminate()
      resolve(false)
    }

    worker.on('message', (msg: WorkerMessage) => {
      try {
        if (msg.kind === 'meta') {
          db.prepare('UPDATE document SET title = ?, authors = ? WHERE id = ?').run(msg.title, msg.authors, docId)
        } else if (msg.kind === 'page') {
          const page = msg.page
          const imageDir = join(documentDir(docId), 'pages')
          mkdirSync(imageDir, { recursive: true })
          writeFileSync(join(imageDir, `${page.number}.png`), Buffer.from(page.png))
          const imagePath = `docs/${docId}/pages/${page.number}.png` // uploads-relative, like the web app
          const info = db
            .prepare('INSERT INTO page (document_id, number, image_path, width, height, text) VALUES (?, ?, ?, ?, ?, ?)')
            .run(docId, page.number, imagePath, page.width, page.height, page.text)
          const pageId = Number(info.lastInsertRowid)
          const insertBlock = db.prepare(
            'INSERT INTO block (page_id, kind, text, order_index, x0, y0, x1, y1) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          db.transaction(() => {
            msg.page.blocks.forEach((block, order) => {
              insertBlock.run(pageId, block.kind, block.text, order, ...block.bbox)
            })
          })()
        } else if (msg.kind === 'done') {
          const count = (db.prepare('SELECT COUNT(*) AS n FROM page WHERE document_id = ?').get(docId) as { n: number }).n
          db.prepare('UPDATE document SET page_count = ? WHERE id = ?').run(count, docId)
          void worker.terminate()
          resolve(true)
        } else if (msg.kind === 'error') {
          fail(msg.message)
        }
      } catch (exc) {
        fail(exc instanceof Error ? exc.message : String(exc))
      }
    })
    worker.on('error', (err: Error) => fail(err.message || 'worker error'))
    worker.on('exit', (code) => {
      if (code !== 0 && !failed) fail(`ingest worker exited with code ${code}`)
    })
  })
}
