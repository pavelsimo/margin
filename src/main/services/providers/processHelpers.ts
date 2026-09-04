import type { CliExecutableInfo } from '@shared/ipc'
import type { AIResult } from './legacy'

export const FORCE_KILL_DELAY_MS = 1_000

export function cancelledResult(text: string): AIResult {
  return { ok: false, text: text.trim(), error: '', cancelled: true }
}

export function timeoutResult(label: string, timeout: number, text = ''): AIResult {
  return { ok: false, text: text.trim(), errorCode: 'timeout', error: `${label} didn't answer within ${timeout}s. Try again or ask something smaller.` }
}

export function missingExecutableError(label: string, executable: CliExecutableInfo): string {
  const command = `\`${executable.effectiveCommand}\``
  if (executable.source === 'custom') {
    return `The configured ${label} executable was not found at ${command}. Choose another executable in Settings or use the automatic default.`
  }
  if (executable.source === 'environment') {
    return `The ${label} executable from the environment was not found at ${command}. Check the environment variable or choose an executable in Settings.`
  }
  return `The ${label} CLI isn't installed (looked for ${command} on the system PATH). Install it and sign in, or choose an executable in Settings.`
}

export function notExecutableError(label: string, bin: string): string {
  return `${label} cannot run \`${bin}\` because it is not executable. Choose another executable in Settings.`
}

export function friendlyError(label: string, stderr: string): string {
  const trimmed = stderr.trim()
  const detail = trimmed ? trimmed.split('\n').at(-1) : 'no error output'
  const lowered = stderr.toLowerCase()
  const loginHints = ['log in', 'login', 'logged in', 'unauthorized', 'authenticate', 'api key']
  if (loginHints.some((hint) => lowered.includes(hint))) {
    return `${label} isn't signed in. Run the CLI once in a terminal to sign in, then try again.`
  }
  return `${label} failed: ${detail}`
}

/** Keep only a bounded in-memory tail for classification; never log provider output. */
export function stderrTail(previous: string, chunk: Buffer): string {
  return (previous + chunk.toString()).slice(-8_192)
}
