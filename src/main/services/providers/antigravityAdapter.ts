import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import type { CliExecutableInfo } from '@shared/ipc'
import { buildCommand, cliEnvironment } from '../aiCore'
import type { AIResult, RunOpts } from './legacy'
import { stderrTail, FORCE_KILL_DELAY_MS, cancelledResult, timeoutResult, missingExecutableError, notExecutableError, friendlyError } from './processHelpers'
import { createCliAdapter } from './cliAdapter'

export function antigravityAdapter(executable: CliExecutableInfo) {
  return createCliAdapter('antigravity', executable, runAntigravity)
}

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
    let launchError: AIResult | undefined
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
      if (forceKillTimer || settled) return
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
    proc.stderr.on('data', (chunk) => (stderr = stderrTail(stderr, chunk)))
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') launchError = { ok: false, text: '', error: missingExecutableError(label, executable) }
      else if (err.code === 'EACCES') launchError = { ok: false, text: '', error: notExecutableError(label, bin) }
      else launchError = { ok: false, text: '', error: friendlyError(label, String(err)) }
      if (proc.pid) terminate()
    })
    proc.on('close', (code) => {
      if (launchError) return finish(launchError)
      streamedText += decoder.end()
      if (opts.signal?.aborted) return finish(cancelledResult(streamedText))
      if (timedOut) return finish(timeoutResult(label, timeout, streamedText))
      if (code !== 0) return finish({ ok: false, text: '', error: friendlyError(label, stderr) })
      const text = streamedText.trim()
      if (!text) return finish({ ok: false, text: '', error: `${label} returned an empty response.` })
      finish({ ok: true, text, error: '' })
    })
    if (opts.signal?.aborted) abort()
  })
}
