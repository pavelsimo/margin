import { appendFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runPrompt } from './ai'
import type { Provider } from '@shared/constants'

const launches = vi.hoisted(() => [] as Array<{ command: string; args: string[]; cwd: string; spawnedAt?: number }>)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (command: string, args: string[], options: { cwd: string }) => {
    launches.push({ command, args, cwd: options.cwd })
    const launch = launches.at(-1)!
    const child = actual.spawn(process.execPath, [resolve('src/main/services/__fixtures__/provider.cjs'), command, ...args], options)
    child.once('spawn', () => { launch.spawnedAt = performance.now() })
    return child
  } }
})
vi.mock('./executableSettings', () => ({
  executableInfo: (provider: string) => ({ customPath: '', effectiveCommand: provider, source: 'default' }),
}))

for (const provider of ['claude', 'codex', 'antigravity'] as Provider[]) {
  describe(`${provider} execution baseline`, () => {
    it('decodes fragmented UTF-8 and preserves image workdir until exit', async () => {
      const deltas: string[] = []
      const result = await runPrompt(provider, 'cwd-probe', {
        model: 'test-model', effort: 'low', imagePng: Buffer.from('image'), onDelta: (text) => deltas.push(text),
      })
      expect(result).toEqual({ ok: true, text: 'héllo world', error: '' })
      expect(deltas.join('')).toBe('héllo world')
      const launch = launches.at(-1)!
      expect(existsSync(launch.cwd)).toBe(false)
      if (provider === 'codex') expect(launch.args).toEqual(['app-server'])
      else expect(launch.args).toContain('--model')
    })

    it('returns a single authoritative response', async () => {
      const result = await runPrompt(provider, 'duplicate')
      expect(result.text).toBe('héllo world')
    })

    it('reports an early process exit', async () => {
      expect((await runPrompt(provider, 'early-exit')).ok).toBe(false)
    })

    it('retains streamed text on stop and cleans up', async () => {
      const controller = new AbortController()
      const result = await runPrompt(provider, 'stop', {
        signal: controller.signal, onDelta: (text) => { if (text.includes("world")) controller.abort() },
      })
      expect(result.cancelled).toBe(true)
      expect(result.text).toBe('héllo world')
      expect(existsSync(launches.at(-1)!.cwd)).toBe(false)
    })

    it('does not launch already-cancelled requests', async () => {
      const count = launches.length
      const result = await runPrompt(provider, 'hello', { signal: AbortSignal.abort() })
      expect(result.cancelled).toBe(true)
      expect(launches).toHaveLength(count)
    })

    it('records fixture timing when explicitly enabled', async () => {
      if (!process.env.MARGIN_BENCHMARK) return
      const samples = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        let first = 0
        await runPrompt(provider, 'timing', { onDelta: () => { first ||= performance.now() - start } })
        const total = performance.now() - start
        const startupMs = launches.at(-1)!.spawnedAt! - start
        const controller = new AbortController()
        let stop = 0
        await runPrompt(provider, 'timing', { signal: controller.signal, onDelta: (text) => {
          if (!text.includes("world")) return
          stop = performance.now()
          controller.abort()
        } })
        samples.push({ startupMs, firstTextMs: first, totalMs: total, cancellationMs: performance.now() - stop })
      }
      appendFileSync(process.env.MARGIN_BENCHMARK!, JSON.stringify({ provider, samples }) + '\n')
    })
  })
}
