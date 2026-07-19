import { describe, expect, it } from 'vitest'
import { readerShortcut, type ReaderShortcutContext } from './readerShortcuts'

const activeReader: ReaderShortcutContext = { ready: true, editable: false, modalOpen: false }

function key(
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {},
) {
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('reader shortcuts', () => {
  it.each([
    ['PageUp', 'previous-page'],
    ['PageDown', 'next-page'],
    ['+', 'zoom-in'],
    ['-', 'zoom-out'],
  ] as const)('maps %s to %s', (pressed, action) => {
    expect(readerShortcut(key(pressed), activeReader)).toBe(action)
  })

  it('allows Shift when it is needed to produce the plus key', () => {
    expect(readerShortcut(key('+', { shiftKey: true }), activeReader)).toBe('zoom-in')
  })

  it.each([
    key('PageDown', { ctrlKey: true }),
    key('PageDown', { metaKey: true }),
    key('PageDown', { altKey: true }),
    key('PageDown', { shiftKey: true }),
    key('+', { ctrlKey: true }),
    key('-', { metaKey: true }),
    key('='),
    key('ArrowRight'),
  ])('ignores modified and unrelated keys', (event) => {
    expect(readerShortcut(event, activeReader)).toBeNull()
  })

  it.each([
    { ready: false, editable: false, modalOpen: false },
    { ready: true, editable: true, modalOpen: false },
    { ready: true, editable: false, modalOpen: true },
  ])('is disabled outside an active reader context', (context) => {
    expect(readerShortcut(key('PageDown'), context)).toBeNull()
  })
})
