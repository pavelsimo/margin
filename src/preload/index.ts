import { contextBridge, ipcRenderer, webFrame } from 'electron'
import type { AppWindowState, ChatDelta, ChatThreadUpdate, IngestUpdate, MarginApi } from '@shared/ipc'
import { isValidAppZoomFactor } from '@shared/constants'

const api: MarginApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onIngestUpdate: (listener: (update: IngestUpdate) => void) => {
    const wrapped = (_event: unknown, update: IngestUpdate) => listener(update)
    ipcRenderer.on('ingest:update', wrapped)
    return () => ipcRenderer.removeListener('ingest:update', wrapped)
  },
  onWindowState: (listener: (state: AppWindowState) => void) => {
    const wrapped = (_event: unknown, state: AppWindowState) => listener(state)
    ipcRenderer.on('app:window-state', wrapped)
    return () => ipcRenderer.removeListener('app:window-state', wrapped)
  },
  onChatDelta: (listener: (delta: ChatDelta) => void) => {
    const wrapped = (_event: unknown, delta: ChatDelta) => listener(delta)
    ipcRenderer.on('chat:delta', wrapped)
    return () => ipcRenderer.removeListener('chat:delta', wrapped)
  },
  onChatThreadUpdate: (listener: (update: ChatThreadUpdate) => void) => {
    const wrapped = (_event: unknown, update: ChatThreadUpdate) => listener(update)
    ipcRenderer.on('chat:thread-update', wrapped)
    return () => ipcRenderer.removeListener('chat:thread-update', wrapped)
  },
  setZoomFactor: (factor: number) => {
    if (!isValidAppZoomFactor(factor)) {
      throw new RangeError('Zoom factor must be between 0.5 and 3')
    }
    webFrame.setZoomFactor(factor)
  },
}

contextBridge.exposeInMainWorld('margin', api)
