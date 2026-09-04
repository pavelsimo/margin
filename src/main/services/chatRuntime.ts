// Electron/database composition is isolated from the testable chat service.
import { db, USER_ID } from '../db'
import { resolvePdf } from '../paths'
import type { DocumentRow } from '@shared/models'
import { renderPageRegionImage } from './pdf'
import * as chat from './chat'
import * as prompts from './prompts'
import { AI_TIMEOUT, captureProvider } from './ai'
import { executions } from './executionCoordinator'
import { createChatExecution } from './chatExecution'

export const chatExecution = createChatExecution({
  coordinator: executions,
  getDocument: (id) => db.prepare('SELECT * FROM document WHERE id = ? AND user_id = ?').get(id, USER_ID) as DocumentRow | undefined,
  pages: (id, pageNumber) => (pageNumber === undefined
    ? db.prepare('SELECT number, text FROM page WHERE document_id = ? ORDER BY number ASC').all(id)
    : db.prepare('SELECT number, text FROM page WHERE document_id = ? AND number = ?').all(id, pageNumber)) as Array<{ number: number; text: string }>,
  figure(id, documentId) {
    const row = db.prepare(`SELECT page.number, block.kind, block.x0, block.y0, block.x1, block.y1 FROM block
      JOIN page ON page.id = block.page_id WHERE block.id = ? AND page.document_id = ?`).get(id, documentId) as
      { number: number; kind: string; x0: number; y0: number; x1: number; y1: number } | undefined
    return row && { pageNumber: row.number, kind: row.kind, bounds: [row.x0, row.y0, row.x1, row.y1] }
  },
  renderRegion: (document, page, bounds) => renderPageRegionImage(resolvePdf(document.pdf_path), page, bounds),
  requireThread: chat.requireThread, addUserTurn: chat.addUserTurn, addAssistantMessage: chat.addAssistantMessage,
  history: chat.history, updateThreadTitle: chat.updateThreadTitle, threadSummary: chat.threadSummary,
  choice: chat.aiChoice, backgroundChoice: chat.backgroundAiChoice, template: prompts.effectiveTemplate,
  captureProvider, timeoutSeconds: AI_TIMEOUT,
})
