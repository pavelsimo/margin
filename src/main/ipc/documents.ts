import { ipcMain } from 'electron'
import type { BlockRow, DocumentRow, PageRow } from '@shared/models'
import type { DocumentInfo, PageData } from '@shared/ipc'
import { db, USER_ID } from '../db'
import { pageImageUrl } from '../protocol'

export function getDocumentRow(docId: number): DocumentRow | undefined {
  const doc = db.prepare('SELECT * FROM document WHERE id = ?').get(docId) as DocumentRow | undefined
  return doc && doc.user_id === USER_ID ? doc : undefined
}

// Port of ingest.looks_scanned: most pages lack a usable text layer.
function looksScanned(docId: number): boolean {
  const counts = db.prepare('SELECT LENGTH(text) AS len FROM page WHERE document_id = ?').all(docId) as {
    len: number
  }[]
  if (!counts.length) return false
  const empty = counts.filter((c) => c.len < 50).length
  return empty / counts.length > 0.8
}

function getDocument(docId: number): DocumentInfo {
  const doc = getDocumentRow(docId)
  if (!doc) throw new Error('This paper no longer exists.')
  const error = db
    .prepare('SELECT message FROM ingestionerror WHERE document_id = ? ORDER BY id DESC LIMIT 1')
    .get(docId) as { message: string } | undefined
  return {
    id: doc.id,
    title: doc.title,
    authors: doc.authors,
    pageCount: doc.page_count,
    ready: doc.page_count > 0,
    failed: !!error,
    failMessage: error?.message ?? '',
    scanned: doc.page_count > 0 && looksScanned(docId),
  }
}

function getPage(docId: number, number: number): PageData {
  const page = db
    .prepare('SELECT * FROM page WHERE document_id = ? AND number = ?')
    .get(docId, number) as PageRow | undefined
  if (!page) throw new Error(`page ${number} not found for document ${docId}`)
  const blocks = db
    .prepare('SELECT * FROM block WHERE page_id = ? ORDER BY order_index')
    .all(page.id) as BlockRow[]
  return { imageUrl: pageImageUrl(page.image_path), width: page.width, height: page.height, blocks }
}

export function registerDocumentIpc(): void {
  ipcMain.handle('document:get', (_e, docId: number) => getDocument(docId))
  ipcMain.handle('page:get', (_e, req: { docId: number; number: number }) => getPage(req.docId, req.number))
}
