import { EventEmitter } from 'node:events'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { ChatSendRequest } from '@shared/ipc'
import type { SendChatOptions } from '../services/chatExecution'
import type { ExecutionLease } from '../services/executionCoordinator'

const stubs = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), send: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => stubs.handlers.set(name, callback) } }))
vi.mock('../services/chat', () => ({}))
vi.mock('../services/commands', () => ({}))
vi.mock('../services/executableSettings', () => ({}))
vi.mock('../services/chatRuntime', () => ({ chatExecution: { send: stubs.send } }))
import { registerChatIpc } from './chat'
import { executions } from '../services/executionCoordinator'

beforeAll(registerChatIpc)
const leases: ExecutionLease[] = []
afterEach(() => { for (const lease of leases) lease.finish(); leases.length = 0; stubs.send.mockReset() })
const request: ChatSendRequest = { requestId: 'one', docId: 10, threadId: 20, mode: 'ask', scope: 'page', pageNumber: 1, question: 'Q', contextText: '' }
function sender(id = 1) {
  return Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send: vi.fn() })
}
it('validates input before calling the chat service', async () => {
  await expect(stubs.handlers.get('chat:send')!({ sender: sender() }, { ...request, docId: '10' })).rejects.toThrow('Invalid')
  expect(stubs.send).not.toHaveBeenCalled()
})
it('passes ownership and routes events to the originating window', async () => {
  const window = sender()
  stubs.send.mockImplementation(async (_req: ChatSendRequest, opts: SendChatOptions) => {
    expect(opts.ownerId).toBe(1)
    opts.onDelta?.('text')
  })
  await stubs.handlers.get('chat:send')!({ sender: window }, request)
  expect(window.send).toHaveBeenCalledWith('chat:delta', { requestId: 'one', text: 'text' })
})
it('rejects cancellation from another window', () => {
  leases.push(executions.begin({ requestId: 'one', task: 'chat', ownerId: 1 }))
  expect(stubs.handlers.get('chat:stop')!({ sender: sender(2) }, 'one')).toBe(false)
  expect(stubs.handlers.get('chat:stop')!({ sender: sender(1) }, 'one')).toBe(true)
})
it.each(['destroyed', 'reload', 'render-process-gone'])('invalidates chat and title work on %s', async (event) => {
  const window = sender()
  await stubs.handlers.get('chat:send')!({ sender: window }, request)
  leases.push(executions.begin({ requestId: 'one', task: 'chat', ownerId: 1, threadId: 20 }))
  leases.push(executions.begin({ requestId: 'title', task: 'title', ownerId: 1, threadId: 20 }))
  if (event === 'reload') window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  else window.emit(event)
  expect(leases.every((lease) => !lease.valid && lease.signal.aborted)).toBe(true)
})
it('keeps chat running during hash-route navigation', async () => {
  const window = sender()
  await stubs.handlers.get('chat:send')!({ sender: window }, request)
  const lease = executions.begin({ requestId: 'one', task: 'chat', ownerId: 1 })
  leases.push(lease)
  window.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  expect(lease.valid).toBe(true)
})
