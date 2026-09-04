import { expect, it } from 'vitest'
import { validateChatRequest } from './chatValidation'
const valid = { requestId: 'one', docId: 1, question: 'Q', contextText: '', pageNumber: 1, scope: 'page', mode: 'ask' }
it('accepts text and bounded image requests', () => {
  expect(() => validateChatRequest(valid)).not.toThrow()
  expect(() => validateChatRequest({ ...valid, imageRegionPage: 1, imageRegion: { x0: 0, y0: 0, x1: 1, y1: 1 } })).not.toThrow()
})
it.each([null, {}, { ...valid, docId: -1 }, { ...valid, mode: '__proto__' }, { ...valid, question: 4 },
  { ...valid, imageRegionPage: 1, imageRegion: { x0: 0.5, y0: 0, x1: 0.1, y1: Infinity } },
  { ...valid, imageBlockId: 2, imageRegionPage: 1, imageRegion: { x0: 0, y0: 0, x1: 1, y1: 1 } },
])('rejects malformed requests before execution: %j', (input) => {
  expect(() => validateChatRequest(input)).toThrow()
})
