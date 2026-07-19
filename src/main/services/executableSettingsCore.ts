import { accessSync, constants, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, delimiter, dirname, isAbsolute, join, sep } from 'node:path'
import {
  OPENAI_COMPATIBLE_PROVIDER_PREFIX,
  PROVIDER_COMMANDS,
  PROVIDER_ENV_VARS,
  PROVIDERS,
  isBuiltInProvider,
  isOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderId,
  type Provider,
} from '@shared/constants'
import type {
  AiChoice,
  CliExecutableInfo,
  CliExecutableSettings,
  CredentialProtection,
  ExecutableSource,
  OpenAiCompatibleProfile,
  OpenAiCompatibleProfileDraft,
} from '@shared/ipc'
import { cliEnvironment } from './aiCore'

interface StoredOpenAiCompatibleProfile {
  id: OpenAiCompatibleProviderId
  name: string
  baseUrl: string
  defaultModel: string
  models: string[]
  encryptedApiKey?: string
}

interface StoredSettings {
  cliExecutables?: Partial<Record<Provider, string>>
  openAiCompatibleProviders?: StoredOpenAiCompatibleProfile[]
  // Provider/model used for background generation (chat titles, paper topics). Absent = follow the chat selection.
  backgroundAiChoice?: AiChoice
}

export interface CredentialCodec {
  encrypt(value: string): Promise<string>
  decrypt(value: string): Promise<string>
  protection(): CredentialProtection
}

const fallbackCodec: CredentialCodec = {
  encrypt: async (value) => Buffer.from(value, 'utf8').toString('base64'),
  decrypt: async (value) => Buffer.from(value, 'base64').toString('utf8'),
  protection: () => 'basic',
}

function cleanModels(values: unknown, defaultModel = ''): string[] {
  const candidates = [defaultModel, ...(Array.isArray(values) ? values : [])]
  return [...new Set(candidates.flatMap((value) => typeof value === 'string' && value.trim() ? [value.trim()] : []))]
}

function parseSettings(raw: string): StoredSettings {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const source = parsed as Record<string, unknown>
  const settings: StoredSettings = {}

  const executableCandidate = source.cliExecutables
  if (executableCandidate && typeof executableCandidate === 'object' && !Array.isArray(executableCandidate)) {
    const cliExecutables: Partial<Record<Provider, string>> = {}
    for (const provider of PROVIDERS) {
      const value = (executableCandidate as Partial<Record<Provider, unknown>>)[provider]
      if (typeof value === 'string' && value.trim()) cliExecutables[provider] = value.trim()
    }
    if (Object.keys(cliExecutables).length) settings.cliExecutables = cliExecutables
  }

  if (Array.isArray(source.openAiCompatibleProviders)) {
    const profiles: StoredOpenAiCompatibleProfile[] = []
    for (const rawProfile of source.openAiCompatibleProviders) {
      if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) continue
      const profile = rawProfile as Record<string, unknown>
      if (
        typeof profile.id !== 'string' || !isOpenAiCompatibleProvider(profile.id)
        || typeof profile.name !== 'string' || !profile.name.trim()
        || typeof profile.baseUrl !== 'string'
        || typeof profile.defaultModel !== 'string' || !profile.defaultModel.trim()
      ) continue
      try {
        profiles.push({
          id: profile.id,
          name: profile.name.trim(),
          baseUrl: normalizeOpenAiBaseUrl(profile.baseUrl),
          defaultModel: profile.defaultModel.trim(),
          models: cleanModels(profile.models, profile.defaultModel),
          ...(typeof profile.encryptedApiKey === 'string' && profile.encryptedApiKey
            ? { encryptedApiKey: profile.encryptedApiKey }
            : {}),
        })
      } catch {
        // Ignore an invalid profile without discarding valid settings.
      }
    }
    if (profiles.length) settings.openAiCompatibleProviders = profiles
  }

  const choiceCandidate = source.backgroundAiChoice
  if (choiceCandidate && typeof choiceCandidate === 'object' && !Array.isArray(choiceCandidate)) {
    const choice = choiceCandidate as Record<string, unknown>
    if (
      typeof choice.provider === 'string'
      && (isBuiltInProvider(choice.provider) || isOpenAiCompatibleProvider(choice.provider))
      && typeof choice.model === 'string'
      && typeof choice.effort === 'string'
    ) {
      settings.backgroundAiChoice = { provider: choice.provider, model: choice.model, effort: choice.effort }
    }
  }
  return settings
}

export function normalizeOpenAiBaseUrl(value: string): string {
  const draft = value.trim()
  if (!draft) throw new Error('Enter an API base URL.')
  let url: URL
  try {
    url = new URL(draft)
  } catch {
    throw new Error('Enter a valid absolute API base URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The API base URL must use HTTP or HTTPS.')
  }
  if (url.username || url.password) throw new Error('Put credentials in the API key field, not the URL.')
  if (url.search || url.hash) throw new Error('The API base URL cannot contain a query or fragment.')
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/v1'
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export function isExecutableFile(path: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    if (!statSync(path).isFile()) return false
    if (platform !== 'win32') accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveCommandOnPath(
  command: string,
  searchPath: string,
  isExecutable: (path: string) => boolean = isExecutableFile,
): string {
  for (const directory of searchPath.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command)
    if (isExecutable(candidate)) return candidate
  }
  return ''
}

export function detectExecutable(
  info: { effectiveCommand: string; source: ExecutableSource },
  searchPath: string,
  isExecutable: (path: string) => boolean = isExecutableFile,
): { detected: boolean; resolvedPath: string } {
  const command = info.effectiveCommand
  if (isAbsolute(command) || command.includes(sep)) {
    return isExecutable(command) ? { detected: true, resolvedPath: command } : { detected: false, resolvedPath: '' }
  }
  const resolvedPath = resolveCommandOnPath(command, searchPath, isExecutable)
  return { detected: Boolean(resolvedPath), resolvedPath }
}

export class ExecutableSettingsStore {
  private settings: StoredSettings

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly warn: (message: string) => void = console.warn,
    private readonly searchPath: () => string = () => cliEnvironment(env, undefined, platform).PATH ?? '',
    private readonly credentialCodec: CredentialCodec = fallbackCodec,
    private readonly createId: () => string = randomUUID,
  ) {
    this.settings = this.load()
  }

  all(): CliExecutableSettings {
    return Object.fromEntries(PROVIDERS.map((provider) => [provider, this.get(provider)])) as CliExecutableSettings
  }

  get(provider: Provider): CliExecutableInfo {
    const base = this.base(provider)
    return { ...base, ...detectExecutable(base, this.searchPath(), (path) => isExecutableFile(path, this.platform)) }
  }

  private base(provider: Provider): Omit<CliExecutableInfo, 'detected' | 'resolvedPath'> {
    const customPath = this.settings.cliExecutables?.[provider] ?? ''
    if (customPath) return { customPath, effectiveCommand: customPath, source: 'custom' }

    const environmentPath = this.env[PROVIDER_ENV_VARS[provider]]?.trim() ?? ''
    if (environmentPath) return { customPath: '', effectiveCommand: environmentPath, source: 'environment' }

    return { customPath: '', effectiveCommand: PROVIDER_COMMANDS[provider], source: 'path' }
  }

  set(provider: Provider, path: string): CliExecutableInfo {
    const normalized = path.trim()
    if (!normalized) throw new Error('Choose an executable file or use the automatic default.')
    this.validateExecutable(normalized)
    const cliExecutables = { ...this.settings.cliExecutables, [provider]: normalized }
    this.replace({ ...this.settings, cliExecutables })
    return this.get(provider)
  }

  reset(provider: Provider): CliExecutableInfo {
    const cliExecutables = { ...this.settings.cliExecutables }
    delete cliExecutables[provider]
    this.replace({ ...this.settings, cliExecutables })
    return this.get(provider)
  }

  openAiProfiles(): OpenAiCompatibleProfile[] {
    return (this.settings.openAiCompatibleProviders ?? []).map((profile) => this.publicProfile(profile))
  }

  openAiProfile(id: string): OpenAiCompatibleProfile | undefined {
    const profile = this.storedOpenAiProfile(id)
    return profile ? this.publicProfile(profile) : undefined
  }

  async openAiApiKey(id: string): Promise<string> {
    const encrypted = this.storedOpenAiProfile(id)?.encryptedApiKey
    return encrypted ? this.credentialCodec.decrypt(encrypted) : ''
  }

  async draftApiKey(draft: OpenAiCompatibleProfileDraft): Promise<string> {
    const supplied = draft.apiKey?.trim()
    if (supplied) return supplied
    if (draft.clearApiKey || !draft.id) return ''
    return this.openAiApiKey(draft.id)
  }

  async upsertOpenAiProfile(draft: OpenAiCompatibleProfileDraft): Promise<OpenAiCompatibleProfile> {
    const current = draft.id ? this.storedOpenAiProfile(draft.id) : undefined
    if (draft.id && !current) throw new Error('That API profile no longer exists.')
    const id = current?.id ?? `${OPENAI_COMPATIBLE_PROVIDER_PREFIX}${this.createId()}` as OpenAiCompatibleProviderId
    const name = draft.name.trim()
    if (!name) throw new Error('Enter a profile name.')
    if (name.length > 64) throw new Error('Profile names must be 64 characters or fewer.')
    const duplicate = (this.settings.openAiCompatibleProviders ?? [])
      .find((profile) => profile.id !== id && profile.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (duplicate) throw new Error('Choose a unique profile name.')
    const baseUrl = normalizeOpenAiBaseUrl(draft.baseUrl)
    const defaultModel = draft.defaultModel.trim()
    if (!defaultModel) throw new Error('Enter or select a default model.')
    const apiKey = await this.draftApiKey(draft)
    const encryptedApiKey = apiKey ? await this.credentialCodec.encrypt(apiKey) : undefined
    const profile: StoredOpenAiCompatibleProfile = {
      id,
      name,
      baseUrl,
      defaultModel,
      models: cleanModels(draft.models, defaultModel),
      ...(encryptedApiKey ? { encryptedApiKey } : {}),
    }
    const profiles = [...(this.settings.openAiCompatibleProviders ?? [])]
    const index = profiles.findIndex((candidate) => candidate.id === id)
    if (index === -1) profiles.push(profile)
    else profiles[index] = profile
    this.replace({ ...this.settings, openAiCompatibleProviders: profiles })
    return this.publicProfile(profile)
  }

  deleteOpenAiProfile(id: OpenAiCompatibleProviderId): boolean {
    const profiles = this.settings.openAiCompatibleProviders ?? []
    const next = profiles.filter((profile) => profile.id !== id)
    if (next.length === profiles.length) return false
    const settings = { ...this.settings, openAiCompatibleProviders: next }
    if (settings.backgroundAiChoice?.provider === id) delete settings.backgroundAiChoice
    this.replace(settings)
    return true
  }

  backgroundChoice(): AiChoice | null {
    const choice = this.settings.backgroundAiChoice
    return choice ? { ...choice } : null
  }

  setBackgroundChoice(choice: AiChoice | null): void {
    const settings = { ...this.settings }
    if (choice) settings.backgroundAiChoice = { ...choice }
    else delete settings.backgroundAiChoice
    this.replace(settings)
  }

  updateOpenAiModels(id: OpenAiCompatibleProviderId, models: string[]): OpenAiCompatibleProfile {
    const profiles = [...(this.settings.openAiCompatibleProviders ?? [])]
    const index = profiles.findIndex((profile) => profile.id === id)
    if (index === -1) throw new Error('That API profile no longer exists.')
    profiles[index] = { ...profiles[index], models: cleanModels(models, profiles[index].defaultModel) }
    this.replace({ ...this.settings, openAiCompatibleProviders: profiles })
    return this.publicProfile(profiles[index])
  }

  private storedOpenAiProfile(id: string): StoredOpenAiCompatibleProfile | undefined {
    return (this.settings.openAiCompatibleProviders ?? []).find((profile) => profile.id === id)
  }

  private publicProfile(profile: StoredOpenAiCompatibleProfile): OpenAiCompatibleProfile {
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      defaultModel: profile.defaultModel,
      models: [...profile.models],
      hasApiKey: Boolean(profile.encryptedApiKey),
      credentialProtection: this.credentialCodec.protection(),
    }
  }

  private load(): StoredSettings {
    try {
      return parseSettings(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.warn(`Could not read settings; using defaults: ${String(error)}`)
      return {}
    }
  }

  private validateExecutable(path: string): void {
    if (!isAbsolute(path)) throw new Error('Enter an absolute path to the executable.')
    let stats
    try {
      stats = statSync(path)
    } catch {
      throw new Error('The selected executable does not exist.')
    }
    if (!stats.isFile()) throw new Error('The selected path is not a file.')
    if (this.platform !== 'win32') {
      try {
        accessSync(path, constants.X_OK)
      } catch {
        throw new Error('The selected file is not executable.')
      }
    }
  }

  private replace(settings: StoredSettings): void {
    this.persist(settings)
    this.settings = settings
  }

  private persist(settings: StoredSettings): void {
    const cliExecutables = Object.fromEntries(
      PROVIDERS.flatMap((provider) => settings.cliExecutables?.[provider]
        ? [[provider, settings.cliExecutables[provider]]]
        : []),
    )
    const profiles = settings.openAiCompatibleProviders ?? []
    const serialized = {
      ...(Object.keys(cliExecutables).length ? { cliExecutables } : {}),
      ...(profiles.length ? { openAiCompatibleProviders: profiles } : {}),
      ...(settings.backgroundAiChoice ? { backgroundAiChoice: settings.backgroundAiChoice } : {}),
    }
    const contents = JSON.stringify(serialized, null, 2) + '\n'
    const directory = dirname(this.filePath)
    mkdirSync(directory, { recursive: true })
    const temporaryPath = join(directory, `.${basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`)
    try {
      writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try { unlinkSync(temporaryPath) } catch { /* nothing to clean up */ }
      throw error
    }
  }
}
