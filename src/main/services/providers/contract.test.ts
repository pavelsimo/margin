import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { claudeCliAdapter } from './claudeCliAdapter'
import { codexAdapter } from './codexAdapter'
import { antigravityAdapter } from './antigravityAdapter'
import { openAiCompatibleAdapter } from './openAiCompatibleAdapter'
import { normalizeError } from './adapter'
import { stderrTail } from './processHelpers'
import type { ProviderAdapter, ProviderRequest } from './types'

const launches = vi.hoisted(() => [] as Array<{ cwd: string; closed: boolean }>)
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn(command: string, args: string[], options: { cwd: string }) {
    const launch = { cwd: options.cwd, closed: false }
    launches.push(launch)
    const child = command.startsWith('fixture-')
      ? actual.spawn(process.execPath, [resolve('src/main/services/__fixtures__/provider.cjs'), command.slice(8), ...args], options)
      : actual.spawn(command, args, options)
    child.once('close', () => { launch.closed = true })
    return child
  } }
})
function httpAdapter() {
  return openAiCompatibleAdapter({ name: 'Fixture', baseUrl: 'http://unused/v1', apiKey: 'private-key' }, async (_url, options) => {
    const prompt = JSON.parse(options!.body as string).messages[0].content as string
    if (prompt === 'malformed') return new Response('data: invalid\n\n', { headers: { 'content-type': 'text/event-stream' } })
    if (prompt === 'early-exit' || prompt === 'stderr-flood') throw new Error('private-key private prompt')
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('data: {"choices":[{"delta":{"content":"héllo world"}}]}\n\n'))
        if (!prompt.includes('hang')) {
          controller.enqueue(Buffer.from('data: [DONE]\n\ndata: {"choices":[{"delta":{"content":"late"}}]}\n\n'))
          controller.close()
        }
      },
    }), { headers: { 'content-type': 'text/event-stream' } })
  })
}
const factories: Record<string, () => ProviderAdapter> = {
  claude: () => claudeCliAdapter({ customPath: '', effectiveCommand: 'fixture-claude', source: 'path', detected: true, resolvedPath: '' }),
  codex: () => codexAdapter({ customPath: '', effectiveCommand: 'fixture-codex', source: 'path', detected: true, resolvedPath: '' }),
  antigravity: () => antigravityAdapter({ customPath: '', effectiveCommand: 'fixture-antigravity', source: 'path', detected: true, resolvedPath: '' }),
  http: httpAdapter,
}
function request(prompt: string, overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return { requestId: 'contract', task: 'chat', profile: { provider: 'claude', model: 'model', effort: '' },
    prompt, instructions: prompt, messages: [], attachments: [], deadline: Date.now() + 5_000,
    signal: new AbortController().signal, ...overrides }
}
for (const [name, create] of Object.entries(factories)) {
  describe(`${name} adapter contract`, () => {
    it('streams text and produces exactly one authoritative result', async () => {
      const adapter = create()
      const deltas: string[] = []
      const result = await adapter.execute(request('duplicate', { onEvent: (event) => deltas.push(event.text) }))
      expect(result).toEqual({ status: 'completed', text: 'héllo world' })
      expect(deltas.join('')).toBe('héllo world')
      await adapter.dispose()
      if (name !== 'http') expect(launches.at(-1)).toMatchObject({ closed: true })
    })
    it('retains partial text on cancellation and suppresses later deltas', async () => {
      const adapter = create()
      const controller = new AbortController()
      const result = await adapter.execute(request('stop', { signal: controller.signal, onEvent: (event) => {
        if (event.text.includes('world')) controller.abort()
      } }))
      expect(result).toEqual({ status: 'cancelled', text: 'héllo world' })
      await adapter.dispose()
    })
    it('bounds cancellation of an unresponsive provider and cleans up owned resources', async () => {
      const adapter = create()
      let resolve!: () => void
      const ready = new Promise<void>((r) => { resolve = r })
      const work = adapter.execute(request('hang', { onEvent: (event) => { if (event.text.includes('world')) resolve() } }))
      await ready
      const start = performance.now()
      await adapter.dispose()
      expect((await work).status).toBe('cancelled')
      expect(performance.now() - start).toBeLessThan(4_000)
      if (name !== 'http') {
        expect(launches.at(-1)?.closed).toBe(true)
        expect(existsSync(launches.at(-1)!.cwd)).toBe(false)
      }
    })
    it('retains partial text on deadline expiry', async () => {
      const adapter = create()
      const result = await adapter.execute(request('hang', { deadline: Date.now() + 1_000 }))
      expect(result).toMatchObject({ status: 'failed', text: 'héllo world', error: { code: 'timeout' } })
      await adapter.dispose()
    })
    it('does not launch after cancellation or disposal', async () => {
      const adapter = create()
      const count = launches.length
      expect((await adapter.execute(request('hello', { signal: AbortSignal.abort() }))).status).toBe('cancelled')
      await adapter.dispose()
      expect((await adapter.execute(request('hello'))).status).toBe('cancelled')
      expect(launches).toHaveLength(count)
    })
    it('reports failures without returning provider diagnostics', async () => {
      const adapter = create()
      const result = await adapter.execute(request('stderr-flood'))
      expect(result.status).toBe('failed')
      expect(JSON.stringify(result)).not.toContain('private')
      await adapter.dispose()
    })
    if (name !== 'antigravity') it('reports malformed protocol data', async () => {
      const adapter = create()
      expect((await adapter.execute(request('malformed'))).status).toBe('failed')
      await adapter.dispose()
    })
  })
}
it.each([claudeCliAdapter, codexAdapter, antigravityAdapter])('normalizes missing executables', async (create) => {
  const adapter = create({ customPath: '', effectiveCommand: join(tmpdir(), 'margin-missing-executable-0000'), source: 'path', detected: true, resolvedPath: '' })
  expect(await adapter.execute(request('hello'))).toMatchObject({ status: 'failed', error: { code: 'executable_unavailable' } })
  await adapter.dispose()
  expect(existsSync(launches.at(-1)!.cwd)).toBe(false)
})
it('bounds stderr before classification', () => {
  expect(stderrTail('old', Buffer.from('x'.repeat(20_000)))).toHaveLength(8_192)
})
it.each([
  ['HTTP 429', 'rate_limited'], ['HTTP 401', 'authentication_required'], ['unsupported image input', 'unsupported_input'],
  ['malformed response', 'protocol'], ['Connection reset', 'transport'], ['needs a model', 'configuration'],
])('normalizes %s', (text, code) => {
  expect(normalizeError(text).code).toBe(code)
})
