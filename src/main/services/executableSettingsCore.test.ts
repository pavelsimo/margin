import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rmSync } from 'node:fs'
import { ExecutableSettingsStore } from './executableSettingsCore'

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

describe('ExecutableSettingsStore', () => {
  it('defaults each provider to its command on the system PATH', () => {
    const settings = new ExecutableSettingsStore(join(tempDirectory(), 'settings.json'), {}, 'linux')

    expect(settings.get('claude')).toEqual({ customPath: '', effectiveCommand: 'claude', source: 'path' })
    expect(settings.get('codex')).toEqual({ customPath: '', effectiveCommand: 'codex', source: 'path' })
    expect(settings.get('antigravity')).toEqual({ customPath: '', effectiveCommand: 'agy', source: 'path' })
  })

  it('uses provider environment variables when no custom path is saved', () => {
    const settings = new ExecutableSettingsStore(
      join(tempDirectory(), 'settings.json'),
      { CLAUDE_BIN: '/environment/claude', CODEX_BIN: '/environment/codex', AGY_BIN: '/environment/agy' },
      'linux',
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
    const settings = new ExecutableSettingsStore(settingsPath, env, 'linux')

    settings.set('claude', claudePath)
    settings.set('codex', codexPath)

    expect(settings.get('claude')).toEqual({ customPath: claudePath, effectiveCommand: claudePath, source: 'custom' })
    expect(settings.get('codex')).toEqual({ customPath: codexPath, effectiveCommand: codexPath, source: 'custom' })
    const reloaded = new ExecutableSettingsStore(settingsPath, env, 'linux')
    expect(reloaded.get('claude').effectiveCommand).toBe(claudePath)
    expect(reloaded.get('codex').effectiveCommand).toBe(codexPath)
  })

  it('resets one provider without changing the other', () => {
    const directory = tempDirectory()
    const settingsPath = join(directory, 'settings.json')
    const settings = new ExecutableSettingsStore(settingsPath, {}, 'linux')
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
    const settings = new ExecutableSettingsStore(settingsPath, {}, 'linux', (message) => warnings.push(message))

    expect(settings.get('claude').source).toBe('path')
    expect(warnings).toHaveLength(1)
    const claudePath = executable(directory, 'claude-custom')
    settings.set('claude', claudePath)
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({ cliExecutables: { claude: claudePath } })
  })

  it('rejects relative, missing, directory, and non-executable paths without replacing the saved value', () => {
    const directory = tempDirectory()
    const settings = new ExecutableSettingsStore(join(directory, 'settings.json'), {}, 'linux')
    const savedPath = executable(directory, 'claude-custom')
    settings.set('claude', savedPath)
    const nonExecutable = join(directory, 'not-executable')
    writeFileSync(nonExecutable, 'plain text')
    chmodSync(nonExecutable, 0o644)

    expect(() => settings.set('claude', 'relative/claude')).toThrow('absolute path')
    expect(() => settings.set('claude', join(directory, 'missing'))).toThrow('does not exist')
    expect(() => settings.set('claude', directory)).toThrow('not a file')
    expect(() => settings.set('claude', nonExecutable)).toThrow('not executable')
    expect(settings.get('claude').effectiveCommand).toBe(savedPath)
  })
})
