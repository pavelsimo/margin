import { ipcMain } from 'electron'
import { rmSync } from 'node:fs'
import type { DocumentRow } from '@shared/models'
import type { PaperRow } from '@shared/ipc'
import { db, parseDbDate, utcnowSql, USER_ID } from '../db'
import { documentDir } from '../paths'
import { pageImageUrl } from '../protocol'

// Documents currently being worked on by background jobs (ingestion / tagging).
export const ingestingIds = new Set<number>()
export const taggingIds = new Set<number>()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function addedLabel(addedAt: string): string {
  const added = parseDbDate(addedAt)
  if (Date.now() - added.getTime() < 60 * 60 * 1000) return 'Just now'
  return `${MONTHS[added.getUTCMonth()]} ${String(added.getUTCDate()).padStart(2, '0')}`
}

export function listPapers(): PaperRow[] {
  const documents = db
    .prepare(`
      SELECT document.*, first_page.image_path AS preview_image_path
      FROM document
      LEFT JOIN page AS first_page
        ON first_page.document_id = document.id AND first_page.number = 1
      WHERE document.user_id = ?
      ORDER BY document.added_at DESC
    `)
    .all(USER_ID) as (DocumentRow & { preview_image_path: string | null })[]
  const opened = new Set(
    (db.prepare('SELECT document_id FROM documentopen WHERE user_id = ?').all(USER_ID) as { document_id: number }[])
      .map((r) => r.document_id),
  )
  const failed = new Set(
    (db.prepare('SELECT document_id FROM ingestionerror').all() as { document_id: number }[])
      .map((r) => r.document_id),
  )
  return documents.map((d) => {
    const tags = d.tags.split(',').map((t) => t.trim()).filter(Boolean)
    return {
      id: d.id,
      title: d.title,
      tags,
      previewUrl: d.preview_image_path ? pageImageUrl(d.preview_image_path) : null,
      pagesLabel: d.page_count ? `${d.page_count} pp` : '—',
      added: addedLabel(d.added_at),
      isNew: !opened.has(d.id),
      isFailed: failed.has(d.id),
      isIngesting: ingestingIds.has(d.id),
      isTagging: taggingIds.has(d.id),
      isReady: d.page_count > 0,
    }
  })
}

function markOpened(docId: number): void {
  const existing = db
    .prepare('SELECT id FROM documentopen WHERE user_id = ? AND document_id = ?')
    .get(USER_ID, docId)
  if (!existing) {
    db.prepare('INSERT INTO documentopen (user_id, document_id, opened_at) VALUES (?, ?, ?)').run(
      USER_ID,
      docId,
      utcnowSql(),
    )
  }
}

// Port of ingest.delete_document: rows first, then the files.
export function deleteDocument(docId: number): void {
  const doc = db.prepare('SELECT id, user_id FROM document WHERE id = ?').get(docId) as
    | { id: number; user_id: number }
    | undefined
  if (!doc || doc.user_id !== USER_ID) return
  db.transaction(() => {
    db.prepare('DELETE FROM block WHERE page_id IN (SELECT id FROM page WHERE document_id = ?)').run(docId)
    db.prepare('DELETE FROM page WHERE document_id = ?').run(docId)
    db.prepare('DELETE FROM chatmessage WHERE document_id = ?').run(docId)
    db.prepare('DELETE FROM documentopen WHERE document_id = ?').run(docId)
    db.prepare('DELETE FROM ingestionerror WHERE document_id = ?').run(docId)
    db.prepare('DELETE FROM document WHERE id = ?').run(docId)
  })()
  rmSync(documentDir(docId), { recursive: true, force: true })
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:list', async () => {
    const papers = listPapers()
    // Kick the tag backfill like the web app's load_library (fire-and-forget).
    const { backfillMissingTags } = await import('./ingest')
    void backfillMissingTags()
    return papers
  })
  ipcMain.handle('library:open', (_e, docId: number) => markOpened(docId))
  ipcMain.handle('library:delete', (_e, docId: number) => deleteDocument(docId))
}
