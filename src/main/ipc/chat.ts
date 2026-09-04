import { ipcMain, type WebContents } from 'electron'
import type { AiChoice, ChatDelta, ChatSendRequest } from '@shared/ipc'
import * as chat from '../services/chat'
import * as commands from '../services/commands'
import { backgroundChoice } from '../services/executableSettings'
import { executions } from '../services/executionCoordinator'
import { chatExecution } from '../services/chatRuntime'
import { uiMessage, type SendChatOptions } from '../services/chatExecution'
import { positiveId, validateChatRequest } from '../services/chatValidation'

export function sendChat(req: ChatSendRequest, opts: SendChatOptions = {}) {
  validateChatRequest(req)
  return chatExecution.send(req, opts)
}

const observedSenders = new WeakSet<WebContents>()
function observeSender(sender: WebContents): void {
  if (observedSenders.has(sender)) return
  observedSenders.add(sender)
  const ownerId = sender.id
  sender.once('destroyed', () => executions.invalidateOwner(ownerId))
  sender.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) executions.invalidateOwner(ownerId)
  })
  sender.on('render-process-gone', () => executions.invalidateOwner(ownerId))
}
function requireId(id: unknown): asserts id is number {
  if (!positiveId(id)) throw new Error('Invalid thread ID.')
}
export function registerChatIpc(): void {
  ipcMain.handle('chat:list', () => chat.listThreads())
  ipcMain.handle('chat:history', (_e, req: { docId: number; threadId: number }) => {
    requireId(req?.threadId)
    requireId(req?.docId)
    chat.requireThread(req.threadId, req.docId)
    return chat.history(req.threadId).map(uiMessage)
  })
  ipcMain.handle('chat:send', async (event, req: ChatSendRequest) => {
    validateChatRequest(req)
    const sender = event.sender
    observeSender(sender)
    return sendChat(req, {
      ownerId: sender.id,
      onDelta: (text) => {
        if (!text || sender.isDestroyed()) return
        const delta: ChatDelta = { requestId: req.requestId, text }
        sender.send('chat:delta', delta)
      },
      onThreadUpdate: (update) => {
        if (!sender.isDestroyed()) sender.send('chat:thread-update', update)
      },
    })
  })
  ipcMain.handle('chat:stop', (event, requestId: string) => {
    if (typeof requestId !== 'string') throw new Error('Invalid request ID.')
    return executions.stop(requestId, event.sender.id)
  })
  ipcMain.handle('chat:command', (_e, req: { threadId?: number; text: string }) => {
    if (!req || typeof req.text !== 'string') throw new Error('Invalid chat command.')
    if (req.threadId !== undefined) requireId(req.threadId)
    return commands.execute(req.threadId, req.text)
  })
  ipcMain.handle('chat:clear', (_e, threadId: number) => {
    requireId(threadId)
    return void chat.clearMessages(threadId)
  })
  ipcMain.handle('chat:clearAll', () => chat.clearAllChats())
  ipcMain.handle('ai:getChoice', () => chat.aiChoice())
  ipcMain.handle('ai:setChoice', (_e, choice: AiChoice) => chat.setAiChoice(choice))
  ipcMain.handle('ai:getBackgroundChoice', () => backgroundChoice())
  ipcMain.handle('ai:setBackgroundChoice', (_e, choice: AiChoice | null) => chat.setBackgroundAiChoice(choice))
  ipcMain.handle('ai:getProviders', () => chat.aiProviders())
}
