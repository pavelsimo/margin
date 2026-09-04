import { expect, it, vi } from 'vitest'
import { createProviderRegistry } from './registry'
import type { OpenAiCompatibleProfile } from '@shared/ipc'
import type { ProviderRequest } from './types'

it('captures profile and model before asynchronous credential resolution', async () => {
  const profile: OpenAiCompatibleProfile = { id: 'openai-compatible:one', name: 'Original', baseUrl: 'http://original/v1', defaultModel: 'old-model',
    models: [], hasApiKey: true, credentialProtection: 'os' }
  let unlock!: (key: string) => void
  const key = new Promise<string>((resolve) => { unlock = resolve })
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'answer' } }] }))
  const registry = createProviderRegistry({ executableInfo: vi.fn(), openAiProfile: () => profile, openAiApiKey: () => key, fetch: fetcher })
  const choice = { provider: profile.id, model: '', effort: '' }
  const pending = registry.resolve(choice)
  profile.baseUrl = 'http://changed/v1'
  profile.defaultModel = 'changed-model'
  choice.model = 'changed-choice'
  unlock('original-key')
  const captured = await pending
  expect(captured.profile.model).toBe('old-model')
  const request: ProviderRequest = { requestId: 'one', profile: captured.profile, task: 'chat', deadline: Date.now() + 1_000,
    prompt: 'question', instructions: 'question', messages: [], attachments: [], signal: new AbortController().signal }
  await captured.adapter.execute(request)
  expect(fetcher).toHaveBeenCalledWith('http://original/v1/chat/completions', expect.objectContaining({
    headers: expect.objectContaining({ Authorization: 'Bearer original-key' }), body: expect.stringContaining('old-model'),
  }))
  expect(captured.adapter.capabilities.images).toBe('unknown')
  expect(JSON.stringify(captured.profile)).not.toContain('original-key')
  await captured.adapter.dispose()
})

it.each(['abort', 'deadline'])('bounds credential resolution on %s', async (reason) => {
  let unlock!: (key: string) => void
  const key = new Promise<string>((resolve) => { unlock = resolve })
  const profile = { id: 'openai-compatible:one', name: 'Fixture', baseUrl: 'http://unused', defaultModel: 'model', models: [], hasApiKey: true, credentialProtection: 'os' } satisfies OpenAiCompatibleProfile
  const registry = createProviderRegistry({ executableInfo: vi.fn(), openAiProfile: () => profile, openAiApiKey: () => key, fetch: vi.fn() })
  const controller = new AbortController()
  const pending = registry.resolve({ provider: profile.id, model: '', effort: '' }, {
    signal: controller.signal, deadline: Date.now() + (reason === 'deadline' ? 10 : 1_000),
  })
  if (reason === 'abort') controller.abort()
  await expect(pending).rejects.toThrow(reason === 'abort' ? 'cancelled' : 'timed out')
  unlock('key')
})
