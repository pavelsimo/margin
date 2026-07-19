// Chat slash-commands. Port of margin/commands.py.

import { clearMessages } from './chat'

const COMMANDS: Record<string, string> = {
  clear: 'Delete the history in this chat',
  help: 'Show available commands',
}

export interface CommandOutcome {
  kind: 'clear' | 'help' | 'unknown'
  text: string // feedback for the chat panel; "" for clear
}

export function isCommand(text: string): boolean {
  return text.trimStart().startsWith('/')
}

/** First token minus the leading slash, lowercased: "/Clear now" -> "clear", "/" -> "". */
export function parse(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return trimmed.split(/\s+/)[0].replace(/^\//, '').toLowerCase()
}

export function helpText(): string {
  return Object.entries(COMMANDS)
    .map(([name, description]) => `- \`/${name}\`: ${description}`)
    .join('\n')
}

export function execute(threadId: number | undefined, text: string): CommandOutcome {
  const name = parse(text)
  if (name === 'clear') {
    if (threadId) clearMessages(threadId)
    return { kind: 'clear', text: '' }
  }
  if (name === 'help') {
    return { kind: 'help', text: helpText() }
  }
  return { kind: 'unknown', text: `Unknown command: /${name}. Type /help to see available commands.` }
}
