import { accessSync, constants, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { PROVIDER_COMMANDS, PROVIDER_ENV_VARS, PROVIDERS, type Provider } from '@shared/constants'
import type { CliExecutableInfo, CliExecutableSettings } from '@shared/ipc'

interface StoredSettings {
  cliExecutables?: Partial<Record<Provider, string>>
}

function parseSettings(raw: string): StoredSettings {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const candidate = (parsed as StoredSettings).cliExecutables
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {}

  const cliExecutables: Partial<Record<Provider, string>> = {}
  for (const provider of PROVIDERS) {
    const value = candidate[provider]
    if (typeof value === 'string' && value.trim()) cliExecutables[provider] = value.trim()
  }
  return { cliExecutables }
}

export class ExecutableSettingsStore {
  private customPaths: Partial<Record<Provider, string>>

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly warn: (message: string) => void = console.warn,
  ) {
    this.customPaths = this.load()
  }

  all(): CliExecutableSettings {
    return Object.fromEntries(PROVIDERS.map((provider) => [provider, this.get(provider)])) as CliExecutableSettings
  }

  get(provider: Provider): CliExecutableInfo {
    const customPath = this.customPaths[provider] ?? ''
    if (customPath) return { customPath, effectiveCommand: customPath, source: 'custom' }

    const environmentPath = this.env[PROVIDER_ENV_VARS[provider]]?.trim() ?? ''
    if (environmentPath) return { customPath: '', effectiveCommand: environmentPath, source: 'environment' }

    return { customPath: '', effectiveCommand: PROVIDER_COMMANDS[provider], source: 'path' }
  }

  set(provider: Provider, path: string): CliExecutableInfo {
    const normalized = path.trim()
    if (!normalized) throw new Error('Choose an executable file or use the automatic default.')
    this.validate(normalized)

    const next = { ...this.customPaths, [provider]: normalized }
    this.persist(next)
    this.customPaths = next
    return this.get(provider)
  }

  reset(provider: Provider): CliExecutableInfo {
    const next = { ...this.customPaths }
    delete next[provider]
    this.persist(next)
    this.customPaths = next
    return this.get(provider)
  }

  private load(): Partial<Record<Provider, string>> {
    try {
      const settings = parseSettings(readFileSync(this.filePath, 'utf8'))
      return settings.cliExecutables ?? {}
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') this.warn(`Could not read executable settings; using defaults: ${String(error)}`)
      return {}
    }
  }

  private validate(path: string): void {
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

  private persist(customPaths: Partial<Record<Provider, string>>): void {
    const cliExecutables = Object.fromEntries(
      PROVIDERS.flatMap((provider) => customPaths[provider] ? [[provider, customPaths[provider]]] : []),
    )
    const contents = JSON.stringify(
      Object.keys(cliExecutables).length ? { cliExecutables } : {},
      null,
      2,
    ) + '\n'

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
