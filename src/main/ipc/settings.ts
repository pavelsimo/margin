import { BrowserWindow, dialog, ipcMain, net, type OpenDialogOptions } from 'electron'
import {
  MODES,
  PROVIDER_LABELS,
  PROVIDERS,
  isOpenAiCompatibleProvider,
  type Mode,
  type OpenAiCompatibleProviderId,
  type Provider,
} from '@shared/constants'
import type { OpenAiCompatibleProfileDraft, PromptInfo } from '@shared/ipc'
import * as executables from '../services/executableSettings'
import * as prompts from '../services/prompts'
import * as chat from '../services/chat'
import { normalizeOpenAiBaseUrl } from '../services/executableSettingsCore'
import { fetchOpenAiModels, type FetchLike } from '../services/openAiCompatibleCore'

const CONNECTION_TIMEOUT_MS = 15_000

function promptInfo(mode: Mode): PromptInfo {
  return { template: prompts.effectiveTemplate(mode), customized: prompts.findTemplate(mode) !== undefined }
}

export function registerSettingsIpc(): void {
  ipcMain.handle('prompts:get', () =>
    Object.fromEntries(MODES.map((mode) => [mode, promptInfo(mode)])),
  )
  ipcMain.handle('prompts:set', (_e, req: { mode: Mode; template: string }) => {
    const draft = req.template.trim()
    if (draft) prompts.setTemplate(req.mode, draft)
    return promptInfo(req.mode)
  })
  ipcMain.handle('prompts:reset', (_e, mode: Mode) => {
    prompts.resetTemplate(mode)
    return promptInfo(mode)
  })
  ipcMain.handle('settings:getExecutables', () => executables.executableSettings())
  ipcMain.handle('settings:setExecutable', (_e, req: { provider: Provider; path: string }) => {
    assertProvider(req.provider)
    return executables.setExecutable(req.provider, req.path)
  })
  ipcMain.handle('settings:resetExecutable', (_e, provider: Provider) => {
    assertProvider(provider)
    return executables.resetExecutable(provider)
  })
  ipcMain.handle('settings:chooseExecutable', async (event, provider: Provider) => {
    assertProvider(provider)
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      title: `Choose ${PROVIDER_LABELS[provider]} executable`,
      properties: ['openFile'],
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('settings:getOpenAiProviders', () => executables.openAiProfiles())
  ipcMain.handle('settings:upsertOpenAiProvider', async (_event, draft: OpenAiCompatibleProfileDraft) =>
    executables.upsertOpenAiProfile(draft),
  )
  ipcMain.handle('settings:testOpenAiProvider', async (_event, draft: OpenAiCompatibleProfileDraft) => ({
    models: await discoverModels(draft),
  }))
  ipcMain.handle('settings:refreshOpenAiModels', async (_event, id: OpenAiCompatibleProviderId) => {
    assertOpenAiProviderId(id)
    const profile = executables.openAiProfile(id)
    if (!profile) throw new Error('That API provider no longer exists.')
    const models = await discoverModels({
      id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      defaultModel: profile.defaultModel,
    })
    return executables.updateOpenAiModels(id, models)
  })
  ipcMain.handle('settings:deleteOpenAiProvider', (_event, id: OpenAiCompatibleProviderId) => {
    assertOpenAiProviderId(id)
    const choice = chat.aiChoice()
    if (!executables.deleteOpenAiProfile(id)) throw new Error('That API provider no longer exists.')
    if (choice.provider === id) return chat.setAiChoice(chat.fallbackAiChoice(id))
    return chat.aiChoice()
  })
}

function assertProvider(provider: string): asserts provider is Provider {
  if (!PROVIDERS.includes(provider as Provider)) throw new Error(`Unknown AI provider: ${provider}`)
}

function assertOpenAiProviderId(id: string): asserts id is OpenAiCompatibleProviderId {
  if (!isOpenAiCompatibleProvider(id)) throw new Error('Unknown API provider.')
}

async function discoverModels(draft: OpenAiCompatibleProfileDraft): Promise<string[]> {
  const name = draft.name.trim() || 'Custom provider'
  const baseUrl = normalizeOpenAiBaseUrl(draft.baseUrl)
  const apiKey = await executables.draftApiKey(draft)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS)
  timer.unref()
  try {
    return await fetchOpenAiModels({ name, baseUrl, apiKey }, net.fetch as FetchLike, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${name} did not answer within ${CONNECTION_TIMEOUT_MS / 1_000}s.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
