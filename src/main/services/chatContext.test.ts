import { expect, it } from 'vitest'
import { buildChatInput, imageContext, regionImageContext, textContext } from './chatContext'
import { assemblePrompt, capText, DEFAULT_PROMPTS, FORMAT_SUFFIX } from './promptCore'
import type { ChatSendRequest } from '@shared/ipc'
import type { ChatMessageRow } from '@shared/models'

const request: ChatSendRequest = { requestId: 'one', docId: 1, question: 'Why?', contextText: '', pageNumber: 1, scope: 'page', mode: 'ask' }
it('preserves selection, page, and document fallback precedence', () => {
  const pages = [{ number: 1, text: 'First' }, { number: 2, text: '' }, { number: 3, text: 'Last' }]
  expect(textContext({ title: 'Paper' }, pages, { scope: 'page', pageNumber: 1, selectedText: ' selection ' })[0]).toBe('selection')
  expect(textContext({ title: 'Paper' }, pages, { scope: 'page', pageNumber: 1 })[0]).toBe('First')
  expect(textContext({ title: 'Paper' }, pages, { scope: 'page', pageNumber: 2 })[0]).toBe('First\n\nLast')
  expect(textContext({ title: 'Paper' }, pages, { scope: 'document', pageNumber: 1 })[1]).toBe('the paper "Paper"')
})
it.each([DEFAULT_PROMPTS.ask, 'Custom {context}: {question} ({scope})', 'Broken {'])('keeps template and history serialization unchanged', (template) => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message-${i}`, mode: i === 5 ? 'error' : 'ask' })) as ChatMessageRow[]
  const context = 'x'.repeat(20_000)
  const input = buildChatInput({ request, template, history, context: [context, 'page'] })
  expect(input.prompt).toBe(assemblePrompt(template, { context, question: request.question, scopeLabel: 'page', history }))
  expect(input.prompt).toContain(capText(context))
  expect(input.prompt).toContain(FORMAT_SUFFIX)
  expect(input.prompt).toContain('Assistant: message-5')
  expect(input.messages).toHaveLength(10)
})
it('distinguishes exact regions from figures and retains page labels', () => {
  expect(imageContext(2)[0]).toContain('selected a figure on page 2')
  expect(regionImageContext(3)[0]).toContain('exact visual region on page 3')
})
