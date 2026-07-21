import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DisplayMessage } from '../../state/readerStore'
import { MessageRow, copyAnswer, formatMessageTime } from './ChatSidebar'

const assistant: DisplayMessage = {
  key: 1,
  role: 'assistant',
  content: 'A **rendered** answer',
  rawContent: 'A **rendered** answer',
  ctx: '',
  isError: false,
  createdAt: '2026-07-19 15:22:00.000000',
}

describe('chat answer actions', () => {
  it('formats database UTC timestamps as localized hour and minute values', () => {
    expect(formatMessageTime(assistant.createdAt!, 'en-US', 'UTC')).toBe('3:22 PM')
    expect(formatMessageTime('not-a-date', 'en-US', 'UTC')).toBe('')
  })

  it('copies source Markdown and absorbs clipboard failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    await expect(copyAnswer(assistant.rawContent!, { writeText })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('A **rendered** answer')

    await expect(copyAnswer('answer', { writeText: vi.fn().mockRejectedValue(new Error('denied')) })).resolves.toBe(false)
  })

  it('renders actions for completed assistant answers only', () => {
    const completed = renderToStaticMarkup(<MessageRow m={assistant} />)
    expect(completed).toContain('aria-label="Copy answer"')
    expect(completed).toContain('<time dateTime="2026-07-19 15:22:00.000000"')

    const streaming = renderToStaticMarkup(<MessageRow m={{ ...assistant, requestId: 'request-1', createdAt: undefined }} />)
    expect(streaming).not.toContain('msg-answer-footer')

    const user = renderToStaticMarkup(<MessageRow m={{ ...assistant, role: 'user' }} />)
    expect(user).not.toContain('msg-answer-footer')
  })
})
