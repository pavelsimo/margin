import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import {
  detectExecutable,
  ExecutableSettingsStore,
  isExecutableFile,
  normalizeOpenAiBaseUrl,
  resolveCommandOnPath,
  type CredentialCodec,
} from './executableSettingsCore'

const temporaryDirectories: string[] = []

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'margin-executable-settings-'))
  temporaryDirectories.push(directory)
  return directory
}

function executable(directory: string, name: string): string {
  const path = join(directory, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function store(settingsPath: string, env: NodeJS.ProcessEnv = {}, searchPath = ''): ExecutableSettingsStore {
  return new ExecutableSettingsStore(settingsPath, env, process.platform, undefined, () => searchPath)
}

describe('isExecutableFile', () => {
  it('accepts files, rejects missing paths and directories, and honors host executable semantics', () => {
    const directory = tempDirectory()
    const nonExecutable = join(directory, 'plain')
    writeFileSync(nonExecutable, 'plain text')
    chmodSync(nonExecutable, 0o644)

    expect(isExecutableFile(executable(directory, 'claude'), process.platform)).toBe(true)
    expect(isExecutableFile(join(directory, 'missing'), process.platform)).toBe(false)
    expect(isExecutableFile(directory, process.platform)).toBe(false)
    expect(isExecutableFile(nonExecutable, process.platform)).toBe(process.platform === 'win32')
  })

  it('skips the executable-bit check on Windows', () => {
    const directory = tempDirectory()
    const nonExecutable = join(directory, 'plain')
    writeFileSync(nonExecutable, 'plain text')
    chmodSync(nonExecutable, 0o644)

    expect(isExecutableFile(nonExecutable, 'win32')).toBe(true)
  })
})

describe('resolveCommandOnPath', () => {
  it('returns the first matching executable across PATH entries', () => {
    const first = tempDirectory()
    const second = tempDirectory()
    const firstPath = executable(first, 'claude')
    executable(second, 'claude')

    const searchPath = [join(first, 'missing'), first, second].join(delimiter)
    expect(resolveCommandOnPath('claude', searchPath, (path) => path === firstPath)).toBe(firstPath)
  })

  it('skips candidates rejected by the executable check and returns empty when nothing is found', () => {
    const directory = tempDirectory()
    writeFileSync(join(directory, 'claude'), 'plain text')
    const isExecutable = () => false

    expect(resolveCommandOnPath('claude', directory, isExecutable)).toBe('')
    expect(resolveCommandOnPath('claude', '', isExecutable)).toBe('')
  })
})

describe('detectExecutable', () => {
  const isExecutable = (path: string) => isExecutableFile(path, process.platform)

  it('checks absolute commands directly, ignoring the search path', () => {
    const directory = tempDirectory()
    const claudePath = executable(directory, 'claude')
    const onPath = tempDirectory()
    executable(onPath, 'claude')

    expect(detectExecutable({ effectiveCommand: claudePath, source: 'custom' }, '', isExecutable))
      .toEqual({ detected: true, resolvedPath: claudePath })
    expect(detectExecutable({ effectiveCommand: join(directory, 'missing'), source: 'environment' }, onPath, isExecutable))
      .toEqual({ detected: false, resolvedPath: '' })
  })

  it('resolves bare commands against the search path', () => {
    const directory = tempDirectory()
    const claudePath = executable(directory, 'claude')

    expect(detectExecutable({ effectiveCommand: 'claude', source: 'path' }, directory, isExecutable))
      .toEqual({ detected: true, resolvedPath: claudePath })
    expect(detectExecutable({ effectiveCommand: 'claude', source: 'environment' }, directory, isExecutable))
      .toEqual({ detected: true, resolvedPath: claudePath })
    expect(detectExecutable({ effectiveCommand: 'claude', source: 'path' }, '', isExecutable))
      .toEqual({ detected: false, resolvedPath: '' })
  })
})

describe('ExecutableSettingsStore', () => {
  it('defaults each provider to its command on the system PATH', () => {
    const settings = store(join(tempDirectory(), 'settings.json'))

    expect(settings.get('claude')).toEqual({ customPath: '', effectiveCommand: 'claude', source: 'path', detected: false, resolvedPath: '' })
    expect(settings.get('codex')).toEqual({ customPath: '', effectiveCommand: 'codex', source: 'path', detected: false, resolvedPath: '' })
    expect(settings.get('antigravity')).toEqual({ customPath: '', effectiveCommand: 'agy', source: 'path', detected: false, resolvedPath: '' })
  })

  it('detects commands found on the injected search path', () => {
    const binDirectory = tempDirectory()
    const claudePath = executable(binDirectory, 'claude')
    const settings = store(join(tempDirectory(), 'settings.json'), {}, binDirectory)

    expect(settings.get('claude')).toMatchObject({ source: 'path', detected: true, resolvedPath: claudePath })
    expect(settings.get('codex')).toMatchObject({ source: 'path', detected: false, resolvedPath: '' })
  })

  it('detects custom executables without consulting the search path', () => {
    const directory = tempDirectory()
    const claudePath = executable(directory, 'claude-custom')
    const settings = store(join(directory, 'settings.json'))

    settings.set('claude', claudePath)

    expect(settings.get('claude')).toMatchObject({ source: 'custom', detected: true, resolvedPath: claudePath })
  })

  it('uses provider environment variables when no custom path is saved', () => {
    const settings = store(
      join(tempDirectory(), 'settings.json'),
      { CLAUDE_BIN: '/environment/claude', CODEX_BIN: '/environment/codex', AGY_BIN: '/environment/agy' },
    )

    expect(settings.get('claude')).toMatchObject({ effectiveCommand: '/environment/claude', source: 'environment' })
    expect(settings.get('codex')).toMatchObject({ effectiveCommand: '/environment/codex', source: 'environment' })
    expect(settings.get('antigravity')).toMatchObject({ effectiveCommand: '/environment/agy', source: 'environment' })
  })

  it('persists independent custom paths and gives them precedence over the environment', () => {
    const directory = tempDirectory()
    const settingsPath = join(directory, 'settings.json')
    const claudePath = executable(directory, 'claude-custom')
    const codexPath = executable(directory, 'codex-custom')
    const env = { CLAUDE_BIN: '/environment/claude', CODEX_BIN: '/environment/codex' }
    const settings = store(settingsPath, env)

    settings.set('claude', claudePath)
    settings.set('codex', codexPath)

    expect(settings.get('claude')).toEqual({ customPath: claudePath, effectiveCommand: claudePath, source: 'custom', detected: true, resolvedPath: claudePath })
    expect(settings.get('codex')).toEqual({ customPath: codexPath, effectiveCommand: codexPath, source: 'custom', detected: true, resolvedPath: codexPath })
    const reloaded = store(settingsPath, env)
    expect(reloaded.get('claude').effectiveCommand).toBe(claudePath)
    expect(reloaded.get('codex').effectiveCommand).toBe(codexPath)
  })

  it('resets one provider without changing the other', () => {
    const directory = tempDirectory()
    const settingsPath = join(directory, 'settings.json')
    const settings = store(settingsPath)
    settings.set('claude', executable(directory, 'claude-custom'))
    const codexPath = executable(directory, 'codex-custom')
    settings.set('codex', codexPath)

    settings.reset('claude')

    expect(settings.get('claude').source).toBe('path')
    expect(settings.get('codex').effectiveCommand).toBe(codexPath)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ cliExecutables: { codex: codexPath } })
  })

  it('recovers from malformed settings and replaces them on the next successful save', () => {
    const directory = tempDirectory()
    const settingsPath = join(directory, 'settings.json')
    writeFileSync(settingsPath, '{bad json')
    const warnings: string[] = []
    const settings = new ExecutableSettingsStore(settingsPath, {}, 'linux', (message) => warnings.push(message), () => '')

    expect(settings.get('claude').source).toBe('path')
    expect(warnings).toHaveLength(1)
    const claudePath = executable(directory, 'claude-custom')
    settings.set('claude', claudePath)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ cliExecutables: { claude: claudePath } })
  })

  it('rejects relative, missing, and directory paths without replacing the saved value', () => {
    const directory = tempDirectory()
    const settings = store(join(directory, 'settings.json'))
    const savedPath = executable(directory, 'claude-custom')
    settings.set('claude', savedPath)

    expect(() => settings.set('claude', 'relative/claude')).toThrow('absolute path')
    expect(() => settings.set('claude', join(directory, 'missing'))).toThrow('does not exist')
    expect(() => settings.set('claude', directory)).toThrow('not a file')
    expect(settings.get('claude').effectiveCommand).toBe(savedPath)
  })

  it.skipIf(process.platform === 'win32')('rejects non-executable Unix files without replacing the saved value', () => {
    const directory = tempDirectory()
    const settings = store(join(directory, 'settings.json'))
    const savedPath = executable(directory, 'claude-custom')
    settings.set('claude', savedPath)
    const nonExecutable = join(directory, 'not-executable')
    writeFileSync(nonExecutable, 'plain text')
    chmodSync(nonExecutable, 0o644)

    expect(() => settings.set('claude', nonExecutable)).toThrow('not executable')
    expect(settings.get('claude').effectiveCommand).toBe(savedPath)
  })
})

describe('OpenAI-compatible profile settings', () => {
  const codec: CredentialCodec = {
    encrypt: async (value) => Buffer.from(`protected:${value}`, 'utf8').toString('base64'),
    decrypt: async (value) => Buffer.from(value, 'base64').toString('utf8').replace(/^protected:/, ''),
    protection: () => 'os',
  }

  function profileStore(settingsPath: string): ExecutableSettingsStore {
    let nextId = 0
    return new ExecutableSettingsStore(
      settingsPath,
      {},
      'linux',
      undefined,
      () => '',
      codec,
      () => `profile-${++nextId}`,
    )
  }

  it('normalizes standard and gateway base URLs', () => {
    expect(normalizeOpenAiBaseUrl('http://localhost:11434')).toBe('http://localhost:11434/v1')
    expect(normalizeOpenAiBaseUrl('https://example.com/gateway/v1/')).toBe('https://example.com/gateway/v1')
    expect(() => normalizeOpenAiBaseUrl('ftp://example.com')).toThrow('HTTP or HTTPS')
    expect(() => normalizeOpenAiBaseUrl('https://user:pass@example.com/v1')).toThrow('API key field')
    expect(() => normalizeOpenAiBaseUrl('https://example.com/v1?token=x')).toThrow('query or fragment')
  })

  it('preserves legacy executable settings while adding, updating, and deleting profiles', async () => {
    const directory = tempDirectory()
    const settingsPath = join(directory, 'settings.json')
    const claudePath = executable(directory, 'claude-custom')
    writeFileSync(settingsPath, JSON.stringify({ cliExecutables: { claude: claudePath } }))
    const settings = profileStore(settingsPath)

    const first = await settings.upsertOpenAiProfile({
      name: 'Ollama',
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3.2',
      models: ['qwen3', 'llama3.2', 'qwen3'],
    })
    const second = await settings.upsertOpenAiProfile({
      name: 'Lab gateway',
      baseUrl: 'https://models.example.test/openai/v1',
      defaultModel: 'research-model',
    })

    expect(first.id).toBe('openai-compatible:profile-1')
    expect(first.models).toEqual(['llama3.2', 'qwen3'])
    expect(settings.get('claude').effectiveCommand).toBe(claudePath)
    expect(settings.openAiProfiles()).toHaveLength(2)
    const codexPath = executable(directory, 'codex-custom')
    settings.set('codex', codexPath)
    expect(settings.openAiProfiles()).toHaveLength(2)
    settings.deleteOpenAiProfile(first.id)
    expect(settings.openAiProfiles().map((profile) => profile.id)).toEqual([second.id])
    expect(JSON.parse(readFileSync(settingsPath, 'utf8')).cliExecutables).toEqual({
      claude: claudePath,
      codex: codexPath,
    })
  })

  it('encrypts keys, redacts public metadata, preserves blank edits, and supports explicit removal', async () => {
    const settingsPath = join(tempDirectory(), 'settings.json')
    const settings = profileStore(settingsPath)
    const created = await settings.upsertOpenAiProfile({
      name: 'Remote',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'model-a',
      apiKey: 'super-secret-value',
    })

    expect(created).toMatchObject({ hasApiKey: true, credentialProtection: 'os' })
    expect(created).not.toHaveProperty('apiKey')
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('super-secret-value')
    expect(await settings.openAiApiKey(created.id)).toBe('super-secret-value')

    const preserved = await settings.upsertOpenAiProfile({
      id: created.id,
      name: 'Remote renamed',
      baseUrl: created.baseUrl,
      defaultModel: created.defaultModel,
      apiKey: '',
    })
    expect(preserved.hasApiKey).toBe(true)
    expect(await settings.openAiApiKey(created.id)).toBe('super-secret-value')

    const cleared = await settings.upsertOpenAiProfile({
      id: created.id,
      name: preserved.name,
      baseUrl: preserved.baseUrl,
      defaultModel: preserved.defaultModel,
      clearApiKey: true,
    })
    expect(cleared.hasApiKey).toBe(false)
    expect(await settings.openAiApiKey(created.id)).toBe('')
  })

  it('rejects duplicate names and invalid profile fields without replacing saved profiles', async () => {
    const settings = profileStore(join(tempDirectory(), 'settings.json'))
    await settings.upsertOpenAiProfile({
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.2',
    })

    await expect(settings.upsertOpenAiProfile({
      name: 'ollama',
      baseUrl: 'http://localhost:22434/v1',
      defaultModel: 'qwen3',
    })).rejects.toThrow('unique')
    await expect(settings.upsertOpenAiProfile({
      name: 'Missing model',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: ' ',
    })).rejects.toThrow('default model')
    expect(settings.openAiProfiles()).toHaveLength(1)
  })

  it('round-trips the background choice through persistence and clears it on request', () => {
    const settingsPath = join(tempDirectory(), 'settings.json')
    const settings = profileStore(settingsPath)
    expect(settings.backgroundChoice()).toBeNull()

    settings.setBackgroundChoice({ provider: 'claude', model: 'fable', effort: 'low' })
    expect(settings.backgroundChoice()).toEqual({ provider: 'claude', model: 'fable', effort: 'low' })
    expect(profileStore(settingsPath).backgroundChoice()).toEqual({ provider: 'claude', model: 'fable', effort: 'low' })

    settings.setBackgroundChoice(null)
    expect(settings.backgroundChoice()).toBeNull()
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('backgroundAiChoice')
  })

  it('drops a malformed background choice on load', () => {
    const settingsPath = join(tempDirectory(), 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ backgroundAiChoice: { provider: 'not-a-provider', model: '', effort: '' } }))
    expect(profileStore(settingsPath).backgroundChoice()).toBeNull()

    writeFileSync(settingsPath, JSON.stringify({ backgroundAiChoice: { provider: 'claude', model: 42, effort: '' } }))
    expect(profileStore(settingsPath).backgroundChoice()).toBeNull()
  })

  it('clears the background choice when its profile is deleted but not otherwise', async () => {
    const settingsPath = join(tempDirectory(), 'settings.json')
    const settings = profileStore(settingsPath)
    const first = await settings.upsertOpenAiProfile({
      name: 'Ollama',
      baseUrl: 'http://localhost:11434',
      defaultModel: 'llama3.2',
    })
    const second = await settings.upsertOpenAiProfile({
      name: 'Gateway',
      baseUrl: 'https://models.example.test/v1',
      defaultModel: 'research-model',
    })

    settings.setBackgroundChoice({ provider: first.id, model: 'llama3.2', effort: '' })
    settings.deleteOpenAiProfile(second.id)
    expect(settings.backgroundChoice()).toEqual({ provider: first.id, model: 'llama3.2', effort: '' })

    settings.deleteOpenAiProfile(first.id)
    expect(settings.backgroundChoice()).toBeNull()
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).not.toHaveProperty('backgroundAiChoice')
  })
})
