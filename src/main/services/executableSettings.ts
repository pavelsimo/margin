import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import type { OpenAiCompatibleProviderId, Provider } from '@shared/constants'
import type { AiChoice, OpenAiCompatibleProfileDraft } from '@shared/ipc'
import { ExecutableSettingsStore, type CredentialCodec } from './executableSettingsCore'

let runtimeStore: ExecutableSettingsStore | undefined

function store(): ExecutableSettingsStore {
  runtimeStore ??= new ExecutableSettingsStore(
    join(app.getPath('userData'), 'settings.json'),
    process.env,
    process.platform,
    console.warn,
    undefined,
    credentialCodec,
  )
  return runtimeStore
}

const credentialCodec: CredentialCodec = {
  encrypt: async (value) => (await safeStorage.encryptStringAsync(value)).toString('base64'),
  decrypt: async (value) => (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result,
  protection: () => process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
    ? 'basic'
    : 'os',
}

export function executableSettings() {
  return store().all()
}

export function executableInfo(provider: Provider) {
  return store().get(provider)
}

export function setExecutable(provider: Provider, path: string) {
  return store().set(provider, path)
}

export function resetExecutable(provider: Provider) {
  return store().reset(provider)
}

export function openAiProfiles() {
  return store().openAiProfiles()
}

export function openAiProfile(id: string) {
  return store().openAiProfile(id)
}

export function openAiApiKey(id: string) {
  return store().openAiApiKey(id)
}

export function draftApiKey(draft: OpenAiCompatibleProfileDraft) {
  return store().draftApiKey(draft)
}

export function upsertOpenAiProfile(draft: OpenAiCompatibleProfileDraft) {
  return store().upsertOpenAiProfile(draft)
}

export function deleteOpenAiProfile(id: OpenAiCompatibleProviderId) {
  return store().deleteOpenAiProfile(id)
}

export function updateOpenAiModels(id: OpenAiCompatibleProviderId, models: string[]) {
  return store().updateOpenAiModels(id, models)
}

export function backgroundChoice() {
  return store().backgroundChoice()
}

export function setBackgroundChoice(choice: AiChoice | null) {
  store().setBackgroundChoice(choice)
}
