import { PROVIDER_COMMANDS, PROVIDER_ENV_VARS, type Provider } from '@shared/constants'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

function environmentExecutable(provider: Provider): string {
  return process.env[PROVIDER_ENV_VARS[provider]] || PROVIDER_COMMANDS[provider]
}

/**
 * Desktop launchers often provide a much smaller PATH than an interactive
 * shell. Preserve it, but add the standard system and user tool locations that
 * CLI wrappers (notably Omarchy's Codex wrapper) need to find mise/node.
 */
export function cliEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  home = env.HOME || homedir(),
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  if (platform === 'win32') return { ...env }
  const existing = (env.PATH || '').split(delimiter).filter(Boolean)
  const additions = [
    join(home, '.local', 'bin'),
    join(home, '.local', 'share', 'mise', 'shims'),
    join(home, '.local', 'share', 'omarchy', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  return {
    ...env,
    HOME: home,
    PATH: [...new Set([...existing, ...additions])].join(delimiter),
  }
}

export function buildCommand(
  provider: Provider,
  model = '',
  effort = '',
  imagePath = '',
  executable = environmentExecutable(provider),
): string[] {
  if (provider === 'claude') {
    const command = [
      executable,
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ]
    if (model) command.push('--model', model)
    if (effort) command.push('--effort', effort)
    if (imagePath) command.push('--allowed-tools', 'Read')
    return command
  }
  if (provider === 'codex') {
    return [executable, 'app-server']
  }
  if (provider === 'antigravity') {
    // The runner appends --print-timeout and `-p <prompt>`; agy only accepts
    // the prompt via argv. Reading the figure file needs tool auto-approval,
    // scoped by --sandbox and the throwaway working directory.
    const command = [executable]
    if (model) command.push('--model', model)
    if (imagePath) command.push('--sandbox', '--dangerously-skip-permissions')
    return command
  }
  throw new Error(`unknown provider: ${provider}`)
}

export interface ClaudeStreamLine {
  delta?: string
  finalText?: string
  error?: string
}

/** Parse one Claude stream-JSON line, ignoring thinking, tool, and status events. */
export function parseClaudeStreamLine(line: string): ClaudeStreamLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object') return {}
  const message = value as Record<string, unknown>
  if (message.type === 'stream_event' && message.event && typeof message.event === 'object') {
    const event = message.event as Record<string, unknown>
    if (event.type === 'content_block_delta' && event.delta && typeof event.delta === 'object') {
      const delta = event.delta as Record<string, unknown>
      if (delta.type === 'text_delta' && typeof delta.text === 'string') return { delta: delta.text }
    }
  }
  if (message.type === 'result') {
    if (message.is_error === true) {
      return { error: typeof message.result === 'string' ? message.result : 'Claude returned an error.' }
    }
    if (typeof message.result === 'string') return { finalText: message.result }
  }
  return {}
}

export interface CodexStreamLine {
  delta?: { itemId: string; text: string }
  item?: { itemId: string; phase: 'commentary' | 'final_answer' | null; text?: string }
  completed?: {
    status: 'completed' | 'interrupted' | 'failed' | 'inProgress'
    error?: string
    finalText?: string
  }
}

/** Parse answer-bearing Codex app-server notifications; request responses are handled by the runner. */
export function parseCodexStreamLine(line: string): CodexStreamLine {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object') return {}
  const message = value as Record<string, unknown>
  const params = message.params && typeof message.params === 'object'
    ? message.params as Record<string, unknown>
    : null
  if (message.method === 'item/started' && params?.item && typeof params.item === 'object') {
    const item = params.item as Record<string, unknown>
    if (item.type === 'agentMessage' && typeof item.id === 'string') {
      const phase = item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : null
      return { item: { itemId: item.id, phase } }
    }
  }
  if (message.method === 'item/completed' && params?.item && typeof params.item === 'object') {
    const item = params.item as Record<string, unknown>
    if (item.type === 'agentMessage' && typeof item.id === 'string') {
      const phase = item.phase === 'commentary' || item.phase === 'final_answer' ? item.phase : null
      return { item: { itemId: item.id, phase, text: typeof item.text === 'string' ? item.text : undefined } }
    }
  }
  if (message.method === 'item/agentMessage/delta' && params) {
    if (typeof params.itemId === 'string' && typeof params.delta === 'string') {
      return { delta: { itemId: params.itemId, text: params.delta } }
    }
  }
  if (message.method === 'turn/completed' && params?.turn && typeof params.turn === 'object') {
    const turn = params.turn as Record<string, unknown>
    const status = turn.status
    if (status !== 'completed' && status !== 'interrupted' && status !== 'failed' && status !== 'inProgress') return {}
    const error = turn.error && typeof turn.error === 'object'
      ? (turn.error as Record<string, unknown>).message
      : undefined
    const items = Array.isArray(turn.items) ? turn.items as Array<Record<string, unknown>> : []
    const messages = items.filter((item) => item.type === 'agentMessage' && typeof item.text === 'string')
    const final = [...messages].reverse().find((item) => item.phase === 'final_answer') ?? messages.at(-1)
    return {
      completed: {
        status,
        error: typeof error === 'string' ? error : undefined,
        finalText: typeof final?.text === 'string' ? final.text : undefined,
      },
    }
  }
  return {}
}
