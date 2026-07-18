import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import type { AppCommand, AppWindowState } from '@shared/ipc'
import { installMarginProtocol, registerMarginScheme } from './protocol'

registerMarginScheme()

// The ingest worker bundle sits next to this entry chunk; shared modules land in
// chunks/, so resolve it here where import.meta.dirname is the main output dir.
process.env.MARGIN_WORKER_PATH = join(import.meta.dirname, 'ingestWorker.js')

function windowState(win: BrowserWindow): AppWindowState {
  const history = win.webContents.navigationHistory
  return {
    platform: process.platform,
    version: app.getVersion(),
    maximized: win.isMaximized(),
    fullScreen: win.isFullScreen(),
    canGoBack: history.canGoBack(),
    canGoForward: history.canGoForward(),
  }
}

function publishWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send('app:window-state', windowState(win))
  }
}

function registerAppIpc(): void {
  ipcMain.handle('app:getWindowState', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error('window not found')
    return windowState(win)
  })

  ipcMain.handle('app:command', (event, command: AppCommand) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const contents = win.webContents
    const history = contents.navigationHistory
    switch (command) {
      case 'minimize':
        win.minimize()
        break
      case 'toggle-maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize()
        break
      case 'close-window':
        win.close()
        break
      case 'quit':
        app.quit()
        break
      case 'reload':
        contents.reload()
        break
      case 'toggle-full-screen':
        win.setFullScreen(!win.isFullScreen())
        break
      case 'go-back':
        if (history.canGoBack()) history.goBack()
        break
      case 'go-forward':
        if (history.canGoForward()) history.goForward()
        break
      case 'undo':
        contents.undo()
        break
      case 'redo':
        contents.redo()
        break
      case 'cut':
        contents.cut()
        break
      case 'copy':
        contents.copy()
        break
      case 'paste':
        contents.paste()
        break
      case 'select-all':
        contents.selectAll()
        break
    }
    publishWindowState(win)
  })
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const } : { frame: false }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const publish = () => publishWindowState(win)
  win.on('maximize', publish)
  win.on('unmaximize', publish)
  win.on('enter-full-screen', publish)
  win.on('leave-full-screen', publish)
  win.webContents.on('did-navigate', publish)
  win.webContents.on('did-navigate-in-page', publish)

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is a hash-routed SPA; block navigations away from it (e.g. a file
  // drop loading the PDF as file://) while still allowing same-URL reloads.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const route = process.env.MARGIN_ROUTE ? `#${process.env.MARGIN_ROUTE}` : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL + route)
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash: process.env.MARGIN_ROUTE })
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  registerAppIpc()
  installMarginProtocol()
  // DB opens lazily here so a missing data dir fails with a clear message.
  const { registerLibraryIpc } = await import('./ipc/library')
  const { registerDocumentIpc } = await import('./ipc/documents')
  const { registerChatIpc } = await import('./ipc/chat')
  const { registerSettingsIpc } = await import('./ipc/settings')
  const { registerIngestIpc } = await import('./ipc/ingest')
  registerLibraryIpc()
  registerDocumentIpc()
  registerChatIpc()
  registerSettingsIpc()
  registerIngestIpc()

  // Headless smoke test: MARGIN_TEST_PROMPTS=1 exercises template CRUD and exits.
  if (process.env.MARGIN_TEST_PROMPTS) {
    const p = await import('./services/prompts')
    try {
      const stock = p.effectiveTemplate('explain')
      p.setTemplate('explain', 'My custom {context} prompt about {scope}')
      const customized = p.findTemplate('explain') !== undefined && p.effectiveTemplate('explain').startsWith('My custom')
      p.setTemplate('explain', p.DEFAULT_PROMPTS.explain) // saving stock text deletes the row
      const backToStock = p.findTemplate('explain') === undefined && p.effectiveTemplate('explain') === stock
      p.setTemplate('explain', 'Another custom')
      p.resetTemplate('explain')
      const resetWorks = p.findTemplate('explain') === undefined
      console.log(`PROMPTS-TEST customized=${customized} backToStock=${backToStock} resetWorks=${resetWorks}`)
    } catch (err) {
      console.log('PROMPTS-TEST-ERROR ' + String(err))
    }
    app.quit()
    return
  }

  // Headless smoke test: MARGIN_TEST_INGEST=<url> ingests one paper and exits.
  if (process.env.MARGIN_TEST_INGEST) {
    const { fetchPdfFromUrl } = await import('./services/fetchPdf')
    const { createDocument } = await import('./services/ingest')
    const { runIngestForTest } = await import('./ipc/ingest')
    try {
      const url = process.env.MARGIN_TEST_INGEST
      const pdfBytes = await fetchPdfFromUrl(url)
      const docId = createDocument(pdfBytes, url)
      console.log(`INGEST-TEST-CREATED doc=${docId} bytes=${pdfBytes.length}`)
      await runIngestForTest(docId)
      console.log('INGEST-TEST-DONE')
    } catch (err) {
      console.log('INGEST-TEST-ERROR ' + String(err))
    }
    app.quit()
    return
  }

  // Headless smoke test: MARGIN_TEST_CHAT=1 runs one real chat round-trip and exits.
  if (process.env.MARGIN_TEST_CHAT) {
    const { sendChat } = await import('./ipc/chat')
    const { aiChoice, setAiChoice } = await import('./services/chat')
    const saved = aiChoice()
    try {
      setAiChoice({ provider: 'claude', model: 'haiku', effort: 'low' })
      const reply = await sendChat({
        requestId: 'headless-smoke-test',
        docId: 1,
        question: 'In one sentence, what is this passage about?',
        mode: 'ask',
        scope: 'page',
        pageNumber: 1,
        contextText:
          'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.',
      })
      console.log('CHAT-TEST-RESULT ' + JSON.stringify(reply))
    } catch (err) {
      console.log('CHAT-TEST-ERROR ' + String(err))
    } finally {
      setAiChoice(saved)
    }
    app.quit()
    return
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
