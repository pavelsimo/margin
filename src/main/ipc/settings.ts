import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { MODES, PROVIDER_LABELS, PROVIDERS, type Mode, type Provider } from '@shared/constants'
import type { PromptInfo } from '@shared/ipc'
import * as executables from '../services/executableSettings'
import * as prompts from '../services/prompts'

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
}

function assertProvider(provider: string): asserts provider is Provider {
  if (!PROVIDERS.includes(provider as Provider)) throw new Error(`Unknown AI provider: ${provider}`)
}
