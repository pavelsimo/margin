import { PROVIDER_ENV_VARS, type Provider } from '@shared/constants'
import type { CliExecutableInfo, OpenAiCompatibleProfileDraft } from '@shared/ipc'

export const API_PROVIDER_PRESETS = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Use models from OpenAI.',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Access models from multiple AI providers.',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Use models running locally with Ollama.',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    description: 'Use models served locally by LM Studio.',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    description: 'Connect any other OpenAI-compatible endpoint.',
    name: '',
    baseUrl: '',
  },
] as const

export type ApiProviderPresetId = (typeof API_PROVIDER_PRESETS)[number]['id']

export function apiProviderPreset(id: ApiProviderPresetId) {
  return API_PROVIDER_PRESETS.find((preset) => preset.id === id)!
}

export function createApiProviderDraft(id: ApiProviderPresetId): OpenAiCompatibleProfileDraft {
  const preset = apiProviderPreset(id)
  return {
    name: preset.name,
    baseUrl: preset.baseUrl,
    defaultModel: '',
    apiKey: '',
    models: [],
  }
}

export function cliDetectionStatus(provider: Provider, info: CliExecutableInfo): string {
  if (info.detected) {
    if (info.source === 'path') return `Detected automatically at ${info.resolvedPath}`
    if (info.source === 'environment') {
      return `Detected from ${PROVIDER_ENV_VARS[provider]} at ${info.resolvedPath}`
    }
    return `Using custom executable at ${info.resolvedPath}`
  }

  if (info.source === 'path') {
    return `Not detected on the system PATH (looked for “${info.effectiveCommand}”).`
  }
  if (info.source === 'environment') {
    return `${PROVIDER_ENV_VARS[provider]} points to an unavailable executable: ${info.effectiveCommand}`
  }
  return `Custom executable not found at ${info.effectiveCommand}`
}

export function cliExecutableDescription(provider: Provider, info: CliExecutableInfo): string {
  if (info.source === 'custom') return `Custom path: ${info.effectiveCommand}`
  if (info.source === 'environment') {
    return `Set by ${PROVIDER_ENV_VARS[provider]}: ${info.effectiveCommand}`
  }
  return `Automatic detection uses “${info.effectiveCommand}” from the system PATH.`
}
