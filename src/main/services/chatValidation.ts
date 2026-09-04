import type { ChatSendRequest } from '@shared/ipc'
import { DEFAULT_PROMPTS } from './promptCore'

export function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
export function validateChatRequest(value: unknown): asserts value is ChatSendRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid chat request.')
  const req = value as Record<string, unknown>
  if (typeof req.requestId !== 'string' || !req.requestId.trim()) throw new Error('A chat request ID is required.')
  if (!positiveId(req.docId) || (req.threadId !== undefined && !positiveId(req.threadId))) throw new Error('Invalid paper or thread ID.')
  if (typeof req.question !== 'string' || typeof req.contextText !== 'string') throw new Error('Invalid chat text.')
  if (typeof req.mode !== 'string' || !Object.hasOwn(DEFAULT_PROMPTS, req.mode)) throw new Error('Invalid chat mode.')
  if (req.scope !== 'page' && req.scope !== 'document') throw new Error('Invalid chat scope.')
  if (!positiveId(req.pageNumber)) throw new Error('Invalid page number.')
  if (req.imageBlockId !== undefined && !positiveId(req.imageBlockId)) throw new Error('Invalid figure ID.')
  if (req.imageRegion !== undefined) {
    if (req.imageBlockId !== undefined) throw new Error('Choose a figure or an image region.')
    if (!positiveId(req.imageRegionPage) || !req.imageRegion || typeof req.imageRegion !== 'object') throw new Error('Invalid image region.')
    const box = req.imageRegion as Record<string, number>
    if (!['x0', 'y0', 'x1', 'y1'].every((key) => Number.isFinite(box[key]) && box[key] >= 0 && box[key] <= 1)
      || box.x0 >= box.x1 || box.y0 >= box.y1) throw new Error('Invalid image region bounds.')
  }
}
