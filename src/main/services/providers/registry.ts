import { isOpenAiCompatibleProvider, type Provider } from '@shared/constants'
import type { AiChoice, CliExecutableInfo, OpenAiCompatibleProfile } from '@shared/ipc'
import type { FetchLike } from '../openAiCompatibleCore'
import { claudeCliAdapter } from './claudeCliAdapter'
import { codexAdapter } from './codexAdapter'
import { antigravityAdapter } from './antigravityAdapter'
import { openAiCompatibleAdapter } from './openAiCompatibleAdapter'
import type { ProviderAdapter, ProviderControls } from './types'

export interface RegistryDependencies {
  executableInfo(provider: Provider): CliExecutableInfo
  openAiProfile(id: string): OpenAiCompatibleProfile | undefined
  openAiApiKey(id: string): Promise<string>
  fetch: FetchLike
}
const cliFactories = { claude: claudeCliAdapter, codex: codexAdapter, antigravity: antigravityAdapter }
export function createProviderRegistry(deps: RegistryDependencies) {
  async function capture(choice: AiChoice): Promise<{ profile: Readonly<AiChoice>; adapter: ProviderAdapter }> {
    const profile = { ...choice }
    if (isOpenAiCompatibleProvider(profile.provider)) {
      const stored = deps.openAiProfile(profile.provider)
      if (!stored) throw new Error('That API provider no longer exists.')
      const snapshot = { ...stored }
      profile.model = profile.model.trim() || snapshot.defaultModel
      if (!profile.model) throw new Error('The API provider needs a model.')
      let apiKey: string
      try { apiKey = await deps.openAiApiKey(profile.provider) }
      catch { throw new Error('The saved API key could not be unlocked.') }
      return { profile, adapter: openAiCompatibleAdapter({ name: snapshot.name, baseUrl: snapshot.baseUrl, apiKey }, deps.fetch) }
    }
    const factory = cliFactories[profile.provider]
    if (!factory) throw new Error('That provider no longer exists.')
    return { profile, adapter: factory(deps.executableInfo(profile.provider)) }
  }
  return {
    resolve(choice: AiChoice, controls: ProviderControls = {}): Promise<Awaited<ReturnType<typeof capture>>> {
      return new Promise((resolve, reject) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const cleanup = () => {
          clearTimeout(timer)
          controls.signal?.removeEventListener('abort', abort)
        }
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          reject(error)
        }
        const abort = () => fail(new Error('Request cancelled.'))
        if (controls.signal?.aborted) return abort()
        if (controls.deadline !== undefined && controls.deadline <= Date.now()) return fail(new Error('Request timed out.'))
        controls.signal?.addEventListener('abort', abort, { once: true })
        if (controls.deadline !== undefined) {
          timer = setTimeout(() => fail(new Error('Request timed out.')), Math.max(0, controls.deadline - Date.now()))
          timer.unref()
        }
        void capture(choice).then((captured) => {
          if (settled) { void captured.adapter.dispose(); return }
          settled = true
          cleanup()
          resolve(captured)
        }, fail)
      })
    },
  }
}
