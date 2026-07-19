import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppCommand } from '@shared/ipc'
import AppDialogs from './AppDialogs'
import GlobalDropOverlay from './GlobalDropOverlay'
import PrimarySidebar from './PrimarySidebar'
import TitleBar from './TitleBar'
import { usePanelResize } from '../hooks/usePanelResize'
import { useLibraryStore } from '../state/libraryStore'
import { useReaderStore } from '../state/readerStore'
import { appZoomShortcut, isReaderRoute, useUiStore } from '../state/uiStore'

const SIDEBAR_RESIZE = {
  cssVar: '--sidebar-width',
  storageKey: 'margin.sidebarWidth',
  min: 200,
  side: 'left',
  containerSelector: '.app-workspace',
  max: (w: number) => Math.min(420, Math.round(w * 0.5))
} as const

function invoke(command: AppCommand): void {
  void window.margin.invoke('app:command', command)
}

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const library = useLibraryStore()
  const ui = useUiStore()
  const sidebarHandleRef = usePanelResize(SIDEBAR_RESIZE)

  useEffect(() => {
    void library.refresh()
    const unsubscribeIngest = window.margin.onIngestUpdate(() => void library.refresh())
    const unsubscribeThreads = window.margin.onChatThreadUpdate((update) => {
      useLibraryStore.getState().upsertChatThread(update.thread)
      useReaderStore.getState().applyThreadUpdate(update)
    })
    return () => {
      unsubscribeIngest()
      unsubscribeThreads()
    }
    // Store actions are stable for the lifetime of the app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('light', ui.theme === 'light')
    document.documentElement.classList.toggle('dark', ui.theme === 'dark')
  }, [ui.theme])

  useLayoutEffect(() => {
    window.margin.setZoomFactor(ui.appZoom / 100)
  }, [ui.appZoom])

  useEffect(() => {
    void window.margin.invoke('app:getWindowState').then(ui.setWindowState)
    return window.margin.onWindowState(ui.setWindowState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const zoomShortcut = appZoomShortcut(event)
      if (zoomShortcut) {
        event.preventDefault()
        if (zoomShortcut === 'in') ui.zoomIn()
        else if (zoomShortcut === 'out') ui.zoomOut()
        else ui.resetZoom()
      } else if (mod && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        navigate('/')
        library.requestAddFocus()
      } else if (mod && !event.altKey && event.key === ',') {
        event.preventDefault(); navigate('/settings')
      } else if (mod && !event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        if (event.shiftKey) {
          if (isReaderRoute(location.pathname)) ui.toggleAssistant()
        } else {
          ui.toggleLeftSidebar()
        }
      } else if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
        event.preventDefault(); invoke('close-window')
      } else if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault(); invoke('quit')
      } else if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault(); invoke('reload')
      } else if (event.key === 'F11') {
        event.preventDefault(); invoke('toggle-full-screen')
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault(); invoke('go-back')
      } else if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault(); invoke('go-forward')
      } else if (event.key === 'Escape') {
        if (ui.aboutOpen) ui.closeAbout()
        else if (library.confirmDeleteId) library.cancelDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [library, location.pathname, navigate, ui])

  return (
    <div className="app-frame">
      <TitleBar />
      <div className="app-workspace">
        {ui.leftSidebarOpen && <><PrimarySidebar /><div ref={sidebarHandleRef} className="panel-resize-handle sidebar-resize-handle" /></>}
        <main className="app-main">{children}</main>
      </div>
      <AppDialogs />
      <GlobalDropOverlay />
    </div>
  )
}
