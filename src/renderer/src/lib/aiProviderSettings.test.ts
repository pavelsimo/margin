import { describe, expect, it } from 'vitest'
import type { CliExecutableInfo } from '@shared/ipc'
import {
  API_PROVIDER_PRESETS,
  cliDetectionStatus,
  cliExecutableDescription,
  createApiProviderDraft,
} from './aiProviderSettings'

function executable(overrides: Partial<CliExecutableInfo>): CliExecutableInfo {
  return {
    customPath: '',
    effectiveCommand: 'claude',
    source: 'path',
    detected: false,
    resolvedPath: '',
    ...overrides,
  }
}

describe('API provider presets', () => {
  it('defines the supported provider choices and their connection URLs', () => {
    expect(API_PROVIDER_PRESETS.map(({ id, name, baseUrl }) => ({ id, name, baseUrl }))).toEqual([
      { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
      { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
      { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
      { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
      { id: 'custom', name: '', baseUrl: '' },
    ])
  })

  it('creates a clean draft without persisting preset metadata', () => {
    expect(createApiProviderDraft('ollama')).toEqual({
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: '',
      apiKey: '',
      models: [],
    })
  })
})

describe('CLI provider copy', () => {
  it('describes automatic PATH detection and a missing PATH command', () => {
    expect(cliDetectionStatus('claude', executable({ detected: true, resolvedPath: '/usr/bin/claude' })))
      .toBe('Detected automatically at /usr/bin/claude')
    expect(cliDetectionStatus('claude', executable({})))
      .toBe('Not detected on the system PATH (looked for “claude”).')
    expect(cliExecutableDescription('claude', executable({})))
      .toBe('Automatic detection uses “claude” from the system PATH.')
  })

  it('describes detected and unavailable environment overrides', () => {
    const detected = executable({
      source: 'environment',
      effectiveCommand: '/opt/claude',
      detected: true,
      resolvedPath: '/opt/claude',
    })
    const missing = executable({ source: 'environment', effectiveCommand: '/missing/claude' })

    expect(cliDetectionStatus('claude', detected)).toBe('Detected from CLAUDE_BIN at /opt/claude')
    expect(cliDetectionStatus('claude', missing))
      .toBe('CLAUDE_BIN points to an unavailable executable: /missing/claude')
    expect(cliExecutableDescription('claude', detected)).toBe('Set by CLAUDE_BIN: /opt/claude')
  })

  it('describes detected and missing custom executables', () => {
    const detected = executable({
      customPath: '/opt/claude',
      source: 'custom',
      effectiveCommand: '/opt/claude',
      detected: true,
      resolvedPath: '/opt/claude',
    })
    const missing = executable({ source: 'custom', effectiveCommand: '/missing/claude' })

    expect(cliDetectionStatus('claude', detected)).toBe('Using custom executable at /opt/claude')
    expect(cliDetectionStatus('claude', missing)).toBe('Custom executable not found at /missing/claude')
    expect(cliExecutableDescription('claude', detected)).toBe('Custom path: /opt/claude')
  })
})
