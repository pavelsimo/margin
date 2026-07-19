export type ReaderShortcutAction = 'previous-page' | 'next-page' | 'zoom-in' | 'zoom-out'

export interface ReaderShortcutContext {
  ready: boolean
  editable: boolean
  modalOpen: boolean
}

type ReaderShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>

/** Resolve reader-only shortcuts without shadowing application or editing commands. */
export function readerShortcut(
  event: ReaderShortcutEvent,
  context: ReaderShortcutContext,
): ReaderShortcutAction | null {
  if (!context.ready || context.editable || context.modalOpen) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null

  // Producing "+" requires Shift on many keyboard layouts, so resolve it
  // before rejecting Shift-modified navigation keys.
  if (event.key === '+') return 'zoom-in'
  if (event.shiftKey) return null

  if (event.key === '-') return 'zoom-out'
  if (event.key === 'PageUp') return 'previous-page'
  if (event.key === 'PageDown') return 'next-page'
  return null
}
