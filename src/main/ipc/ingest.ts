import { BrowserWindow, ipcMain } from 'electron'
import type { IngestUpdate } from '@shared/ipc'
import { resolvePdf } from '../paths'
import { db } from '../db'
import { createDocument, ingestDocument } from '../services/ingest'
import { fetchPdfFromUrl } from '../services/fetchPdf'
import { generateDocumentTags, missingDocumentIds } from '../services/tagging'
import { ingestingIds, taggingIds } from './library'

const workerPath = process.env.MARGIN_WORKER_PATH! // set by main/index.ts before IPC modules load

function emitUpdate(update: IngestUpdate): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ingest:update', update)
  }
}

// Port of LibraryState._ingest + _tag_one: worker ingest, then auto-tagging.
async function runIngest(docId: number): Promise<void> {
  ingestingIds.add(docId)
  emitUpdate({ docId, phase: 'ingesting' })
  const pdfPath = (db.prepare('SELECT pdf_path FROM document WHERE id = ?').get(docId) as { pdf_path: string })
    .pdf_path
  const ingested = await ingestDocument(docId, workerPath, resolvePdf(pdfPath))
  ingestingIds.delete(docId)
  emitUpdate({ docId, phase: ingested ? 'ready' : 'failed' })
  if (ingested) await tagOne(docId)
  emitUpdate({ docId, phase: 'done' })
}

async function tagOne(docId: number): Promise<{ providerFailed: boolean }> {
  taggingIds.add(docId)
  emitUpdate({ docId, phase: 'tagging' })
  try {
    return await generateDocumentTags(docId)
  } finally {
    taggingIds.delete(docId)
    emitUpdate({ docId, phase: 'done' })
  }
}

// Serialized backfill for ready-but-untagged papers, stopping when the provider fails.
let backfillRunning = false
export async function backfillMissingTags(): Promise<void> {
  if (backfillRunning) return
  backfillRunning = true
  try {
    for (const docId of missingDocumentIds()) {
      if (taggingIds.has(docId)) continue
      const result = await tagOne(docId)
      if (result.providerFailed) break
    }
  } finally {
    backfillRunning = false
  }
}

export const runIngestForTest = runIngest

export function registerIngestIpc(): void {
  ipcMain.handle('ingest:fromUrl', async (_e, url: string) => {
    const pdfBytes = await fetchPdfFromUrl(url)
    const docId = createDocument(pdfBytes, url)
    void runIngest(docId)
    return { docId }
  })
  ipcMain.handle('ingest:fromFile', (_e, req: { name: string; data: ArrayBuffer }) => {
    const docId = createDocument(Buffer.from(req.data))
    void runIngest(docId)
    return { docId }
  })
}
