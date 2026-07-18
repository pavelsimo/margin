import { app } from 'electron'
import { join } from 'node:path'
import type { Provider } from '@shared/constants'
import { ExecutableSettingsStore } from './executableSettingsCore'

let runtimeStore: ExecutableSettingsStore | undefined

function store(): ExecutableSettingsStore {
  runtimeStore ??= new ExecutableSettingsStore(join(app.getPath('userData'), 'settings.json'))
  return runtimeStore
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
