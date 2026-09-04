import { expect, it } from 'vitest'
import { resolvedChatPath } from './readerNavigation'

it('never redirects an explicitly selected chat to the previously loaded chat', () => {
  expect(resolvedChatPath('/read/1/chat/21', 1, { documentId: 1, activeThreadId: 20 })).toBeNull()
  expect(resolvedChatPath('/read/1/chat/20', 1, { documentId: 1, activeThreadId: 21 })).toBeNull()
})
it.each(['/read/1', '/read/1/new'])('resolves the loaded thread for %s', (pathname) => {
  expect(resolvedChatPath(pathname, 1, { documentId: 1, activeThreadId: 20 })).toBe('/read/1/chat/20')
})
it('keeps new chats and data from another paper from triggering a redirect', () => {
  expect(resolvedChatPath('/read/1/new', 1, { documentId: 1, activeThreadId: 0 })).toBeNull()
  expect(resolvedChatPath('/read/1', 1, { documentId: 2, activeThreadId: 20 })).toBeNull()
})
