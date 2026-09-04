import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { CliExecutableInfo } from '@shared/ipc'
import { buildCommand, cliEnvironment, parseCodexStreamLine } from '../aiCore'
import type { AIResult, RunOpts } from './legacy'
import { FORCE_KILL_DELAY_MS, cancelledResult, timeoutResult, missingExecutableError, notExecutableError, friendlyError } from './processHelpers'
import { createCliAdapter } from './cliAdapter'

export function codexAdapter(executable: CliExecutableInfo) {
  return createCliAdapter('codex', executable, runCodex)
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
