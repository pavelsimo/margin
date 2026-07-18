// Streaming AI provider abstraction over subscription CLIs. Claude uses its
// stream-JSON print mode; Codex uses the app-server JSONL protocol;
// Antigravity (agy) prints the plain-text answer from its --print mode.

import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { PROVIDER_LABELS, type Provider } from '@shared/constants'
import type { CliExecutableInfo } from '@shared/ipc'
import { buildCommand, cliEnvironment, parseClaudeStreamLine, parseCodexStreamLine } from './aiCore'
import { executableInfo } from './executableSettings'

export { buildCommand, parseClaudeStreamLine, parseCodexStreamLine } from './aiCore'

const AI_TIMEOUT = Number(process.env.AI_TIMEOUT || 180)
const IMAGE_FILENAME = 'figure.png'
const FORCE_KILL_DELAY_MS = 1_000

const IMAGE_INSTRUCTION =
  '\n\nThe figure under discussion is saved as ./figure.png in your working directory. ' +
  'Read that image file first and ground your answer in what it shows.'

export interface AIResult {
  ok: boolean
  text: string
  error: string
  cancelled?: boolean
}

export interface RunOpts {
  model?: string
  effort?: string
  imagePng?: Buffer | null
  timeout?: number
  signal?: AbortSignal
  onDelta?: (text: string) => void
}

export async function runPrompt(provider: Provider, prompt: string, opts: RunOpts = {}): Promise<AIResult> {
  const label = PROVIDER_LABELS[provider] ?? provider
  const executable = executableInfo(provider)
  const timeout = opts.timeout ?? AI_TIMEOUT
  const workdir = await mkdtemp(join(tmpdir(), 'margin-ai-'))
  try {
    if (opts.signal?.aborted) return cancelledResult('')
    let imagePath = ''
    let fullPrompt = prompt
    if (opts.imagePng) {
      imagePath = join(workdir, IMAGE_FILENAME)
      await writeFile(imagePath, opts.imagePng)
      if (provider === 'claude' || provider === 'antigravity') fullPrompt += IMAGE_INSTRUCTION
    }
    if (opts.signal?.aborted) return cancelledResult('')
    if (provider === 'claude') {
      return await runClaude(fullPrompt, workdir, imagePath, executable, label, timeout, opts)
    }
    if (provider === 'antigravity') {
      return await runAntigravity(fullPrompt, workdir, imagePath, executable, label, timeout, opts)
    }
    return await runCodex(prompt, workdir, imagePath, executable, label, timeout, opts)
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {})
  }
}

function runClaude(
  prompt: string,
  workdir: string,
  imagePath: string,
  executable: CliExecutableInfo,
  label: string,
  timeout: number,
  opts: RunOpts,
): Promise<AIResult> {
  const [bin, ...args] = buildCommand('claude', opts.model ?? '', opts.effort ?? '', imagePath, executable.effectiveCommand)
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: workdir, env: cliEnvironment() })
    const decoder = new StringDecoder('utf8')
    let stdoutBuffer = ''
    let stderr = ''
    let streamedText = ''
    let finalText = ''
    let streamError = ''
    let timedOut = false
    let settled = false
    let forceKillTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      opts.signal?.removeEventListener('abort', abort)
    }
    const finish = (result: AIResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const terminate = () => {
      proc.kill('SIGTERM')
      forceKillTimer = setTimeout(() => proc.kill('SIGKILL'), FORCE_KILL_DELAY_MS)
      forceKillTimer.unref()
    }
    const abort = () => terminate()
    const consumeLine = (line: string) => {
      const event = parseClaudeStreamLine(line)
      if (event.delta) {
        streamedText += event.delta
        opts.onDelta?.(event.delta)
      }
      if (event.finalText !== undefined) finalText = event.finalText
      if (event.error) streamError = event.error
    }
    const consumeChunk = (chunk: Buffer) => {
      stdoutBuffer += decoder.write(chunk)
      let newline = stdoutBuffer.indexOf('\n')
      while (newline !== -1) {
        consumeLine(stdoutBuffer.slice(0, newline))
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        newline = stdoutBuffer.indexOf('\n')
      }
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeout * 1000)
    timer.unref()
    opts.signal?.addEventListener('abort', abort, { once: true })
    proc.stdin.on('error', () => {})
    proc.stdout.on('data', consumeChunk)
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') finish({ ok: false, text: '', error: missingExecutableError(label, executable) })
      else if (err.code === 'EACCES') finish({ ok: false, text: '', error: notExecutableError(label, bin) })
      else finish({ ok: false, text: '', error: friendlyError(label, String(err)) })
    })
    proc.on('close', (code) => {
      stdoutBuffer += decoder.end()
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer)
      if (opts.signal?.aborted) return finish(cancelledResult(streamedText))
      if (timedOut) {
        return finish({ ok: false, text: '', error: `${label} didn't answer within ${timeout}s. Try again or ask something smaller.` })
      }
      if (streamError) return finish({ ok: false, text: '', error: friendlyError(label, streamError) })
      if (code !== 0) return finish({ ok: false, text: '', error: friendlyError(label, stderr) })
      const text = (finalText || streamedText).trim()
      if (!text) return finish({ ok: false, text: '', error: `${label} returned an empty response.` })
      finish({ ok: true, text, error: '' })
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
    if (opts.signal?.aborted) abort()
  })
}

// agy takes the prompt via argv (no stdin mode), so very long prompts could
// hit the ~32KB command-line limit on Windows. Stdout is the plain answer.
function runAntigravity(
  prompt: string,
  workdir: string,
  imagePath: string,
  executable: CliExecutableInfo,
  label: string,
  timeout: number,
  opts: RunOpts,
): Promise<AIResult> {
  const [bin, ...args] = buildCommand('antigravity', opts.model ?? '', '', imagePath, executable.effectiveCommand)
  args.push('--print-timeout', `${timeout}s`, '-p', prompt)
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: workdir, env: cliEnvironment() })
    const decoder = new StringDecoder('utf8')
    let stderr = ''
    let streamedText = ''
    let timedOut = false
    let settled = false
    let forceKillTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      opts.signal?.removeEventListener('abort', abort)
    }
    const finish = (result: AIResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const terminate = () => {
      proc.kill('SIGTERM')
      forceKillTimer = setTimeout(() => proc.kill('SIGKILL'), FORCE_KILL_DELAY_MS)
      forceKillTimer.unref()
    }
    const abort = () => terminate()
    const consumeChunk = (chunk: Buffer) => {
      const text = decoder.write(chunk)
      if (!text) return
      streamedText += text
      opts.onDelta?.(text)
    }

    const timer = setTimeout(() => {
      timedOut = true
      terminate()
    }, timeout * 1000)
    timer.unref()
    opts.signal?.addEventListener('abort', abort, { once: true })
    proc.stdin.on('error', () => {})
    proc.stdin.end()
    proc.stdout.on('data', consumeChunk)
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') finish({ ok: false, text: '', error: missingExecutableError(label, executable) })
      else if (err.code === 'EACCES') finish({ ok: false, text: '', error: notExecutableError(label, bin) })
      else finish({ ok: false, text: '', error: friendlyError(label, String(err)) })
    })
    proc.on('close', (code) => {
      streamedText += decoder.end()
      if (opts.signal?.aborted) return finish(cancelledResult(streamedText))
      if (timedOut) return finish(timeoutResult(label, timeout))
      if (code !== 0) return finish({ ok: false, text: '', error: friendlyError(label, stderr) })
      const text = streamedText.trim()
      if (!text) return finish({ ok: false, text: '', error: `${label} returned an empty response.` })
      finish({ ok: true, text, error: '' })
    })
    if (opts.signal?.aborted) abort()
  })
}

function runCodex(
  prompt: string,
  workdir: string,
  imagePath: string,
  executable: CliExecutableInfo,
  label: string,
  timeout: number,
  opts: RunOpts,
): Promise<AIResult> {
  const [bin, ...args] = buildCommand('codex', '', '', '', executable.effectiveCommand)
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { cwd: workdir, env: cliEnvironment() })
    const decoder = new StringDecoder('utf8')
    const phases = new Map<string, 'commentary' | 'final_answer' | null>()
    let stdoutBuffer = ''
    let stderr = ''
    let streamedText = ''
    let threadId = ''
    let turnId = ''
    let terminal: 'cancelled' | 'timeout' | null = null
    let completedResult: AIResult | null = null
    let protocolError = ''
    let settled = false
    let terminateTimer: NodeJS.Timeout | undefined
    let forceKillTimer: NodeJS.Timeout | undefined

    const send = (message: unknown) => {
      if (!proc.stdin.destroyed) proc.stdin.write(`${JSON.stringify(message)}\n`)
    }
    const cleanup = () => {
      clearTimeout(timer)
      if (terminateTimer) clearTimeout(terminateTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      opts.signal?.removeEventListener('abort', abort)
    }
    const finish = (result: AIResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const terminate = () => {
      proc.kill('SIGTERM')
      forceKillTimer = setTimeout(() => proc.kill('SIGKILL'), FORCE_KILL_DELAY_MS)
      forceKillTimer.unref()
    }
    const shutdownAfterTurn = (result: AIResult) => {
      completedResult = result
      terminate()
    }
    const interrupt = (reason: 'cancelled' | 'timeout') => {
      if (terminal) return
      terminal = reason
      if (threadId && turnId) {
        send({ method: 'turn/interrupt', id: 4, params: { threadId, turnId } })
        terminateTimer = setTimeout(terminate, 350)
        terminateTimer.unref()
      } else {
        terminate()
      }
    }
    const abort = () => interrupt('cancelled')

    const consumeLine = (line: string) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      if (message.error && typeof message.error === 'object') {
        const detail = (message.error as Record<string, unknown>).message
        protocolError = typeof detail === 'string' ? detail : 'Codex app-server returned an error.'
        return terminate()
      }
      if (message.id === 1 && message.result) {
        send({ method: 'initialized', params: {} })
        send({
          method: 'thread/start',
          id: 2,
          params: {
            cwd: workdir,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            ephemeral: true,
            ...(opts.model ? { model: opts.model } : {}),
          },
        })
        return
      }
      if (message.id === 2 && message.result && typeof message.result === 'object') {
        const thread = (message.result as Record<string, unknown>).thread
        if (!thread || typeof thread !== 'object' || typeof (thread as Record<string, unknown>).id !== 'string') {
          protocolError = 'Codex app-server did not return a thread ID.'
          return terminate()
        }
        threadId = (thread as Record<string, unknown>).id as string
        const input: Array<Record<string, unknown>> = [{ type: 'text', text: prompt, text_elements: [] }]
        if (imagePath) input.push({ type: 'localImage', path: imagePath })
        send({
          method: 'turn/start',
          id: 3,
          params: {
            threadId,
            input,
            ...(opts.effort ? { effort: opts.effort } : {}),
          },
        })
        return
      }
      if (message.id === 3 && message.result && typeof message.result === 'object') {
        const turn = (message.result as Record<string, unknown>).turn
        if (turn && typeof turn === 'object' && typeof (turn as Record<string, unknown>).id === 'string') {
          turnId = (turn as Record<string, unknown>).id as string
        }
      }

      const event = parseCodexStreamLine(line)
      if (event.item) phases.set(event.item.itemId, event.item.phase)
      if (event.delta && phases.get(event.delta.itemId) !== 'commentary') {
        streamedText += event.delta.text
        opts.onDelta?.(event.delta.text)
      }
      if (event.completed) {
        const authoritative = (event.completed.finalText || streamedText).trim()
        if (event.completed.status === 'interrupted' || terminal === 'cancelled') {
          return shutdownAfterTurn(cancelledResult(streamedText))
        }
        if (terminal === 'timeout') return shutdownAfterTurn(timeoutResult(label, timeout))
        if (event.completed.status === 'failed') {
          return shutdownAfterTurn({ ok: false, text: '', error: friendlyError(label, event.completed.error || stderr) })
        }
        if (!authoritative) {
          return shutdownAfterTurn({ ok: false, text: '', error: `${label} returned an empty response.` })
        }
        shutdownAfterTurn({ ok: true, text: authoritative, error: '' })
      }
    }
    const consumeChunk = (chunk: Buffer) => {
      stdoutBuffer += decoder.write(chunk)
      let newline = stdoutBuffer.indexOf('\n')
      while (newline !== -1) {
        consumeLine(stdoutBuffer.slice(0, newline))
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        newline = stdoutBuffer.indexOf('\n')
      }
    }

    const timer = setTimeout(() => interrupt('timeout'), timeout * 1000)
    timer.unref()
    opts.signal?.addEventListener('abort', abort, { once: true })
    proc.stdin.on('error', () => {})
    proc.stdout.on('data', consumeChunk)
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') finish({ ok: false, text: '', error: missingExecutableError(label, executable) })
      else if (err.code === 'EACCES') finish({ ok: false, text: '', error: notExecutableError(label, bin) })
      else finish({ ok: false, text: '', error: friendlyError(label, String(err)) })
    })
    proc.on('close', (code) => {
      stdoutBuffer += decoder.end()
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer)
      if (terminal === 'cancelled') return finish(cancelledResult(streamedText))
      if (terminal === 'timeout') return finish(timeoutResult(label, timeout))
      if (completedResult) return finish(completedResult)
      if (protocolError) return finish({ ok: false, text: '', error: friendlyError(label, protocolError) })
      finish({ ok: false, text: '', error: friendlyError(label, stderr || `process exited with code ${code}`) })
    })
    send({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'margin_desktop', title: 'Margin Desktop', version: '0.1.0' }, capabilities: null },
    })
    if (opts.signal?.aborted) abort()
  })
}

function cancelledResult(text: string): AIResult {
  return { ok: false, text: text.trim(), error: '', cancelled: true }
}

function timeoutResult(label: string, timeout: number): AIResult {
  return { ok: false, text: '', error: `${label} didn't answer within ${timeout}s. Try again or ask something smaller.` }
}

function missingExecutableError(label: string, executable: CliExecutableInfo): string {
  const command = `\`${executable.effectiveCommand}\``
  if (executable.source === 'custom') {
    return `The configured ${label} executable was not found at ${command}. Choose another executable in Settings or use the automatic default.`
  }
  if (executable.source === 'environment') {
    return `The ${label} executable from the environment was not found at ${command}. Check the environment variable or choose an executable in Settings.`
  }
  return `The ${label} CLI isn't installed (looked for ${command} on the system PATH). Install it and sign in, or choose an executable in Settings.`
}

function notExecutableError(label: string, bin: string): string {
  return `${label} cannot run \`${bin}\` because it is not executable. Choose another executable in Settings.`
}

function friendlyError(label: string, stderr: string): string {
  const trimmed = stderr.trim()
  const detail = trimmed ? trimmed.split('\n').at(-1) : 'no error output'
  const lowered = stderr.toLowerCase()
  const loginHints = ['log in', 'login', 'logged in', 'unauthorized', 'authenticate', 'api key']
  if (loginHints.some((hint) => lowered.includes(hint))) {
    return `${label} isn't signed in. Run the CLI once in a terminal to sign in, then try again.`
  }
  return `${label} failed: ${detail}`
}
