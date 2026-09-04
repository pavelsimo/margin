import { isOpenAiCompatibleProvider, type Provider } from '@shared/constants'
import type { AiChoice, CliExecutableInfo, OpenAiCompatibleProfile } from '@shared/ipc'
import type { FetchLike } from '../openAiCompatibleCore'
import { claudeCliAdapter } from './claudeCliAdapter'
import { codexAdapter } from './codexAdapter'
import { antigravityAdapter } from './antigravityAdapter'
import { openAiCompatibleAdapter } from './openAiCompatibleAdapter'
import type { ProviderAdapter } from './types'

export interface RegistryDependencies {
  executableInfo(provider: Provider): CliExecutableInfo
  openAiProfile(id: string): OpenAiCompatibleProfile | undefined
  openAiApiKey(id: string): Promise<string>
  fetch: FetchLike
}
const cliFactories = { claude: claudeCliAdapter, codex: codexAdapter, antigravity: antigravityAdapter }
export function createProviderRegistry(deps: RegistryDependencies) {
  return {
    async resolve(choice: AiChoice): Promise<{ profile: Readonly<AiChoice>; adapter: ProviderAdapter }> {
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
    },
  }
}
