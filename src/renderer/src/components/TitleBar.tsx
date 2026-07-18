import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AppCommand } from '@shared/ipc'
import { APP_ZOOM_LEVELS, DEFAULT_APP_ZOOM } from '@shared/constants'
import Icon from './Icon'
import { useLibraryStore } from '../state/libraryStore'
import { isReaderRoute, useUiStore } from '../state/uiStore'

type MenuName = 'File' | 'Edit' | 'View' | 'Help'
interface MenuEntry {
  label?: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  checked?: boolean
  separator?: boolean
}

const MENU_NAMES: MenuName[] = ['File', 'Edit', 'View', 'Help']

function invoke(command: AppCommand): void {
  void window.margin.invoke('app:command', command)
}

export default function TitleBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const library = useLibraryStore()
  const ui = useUiStore()
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuButtons = useRef<Partial<Record<MenuName, HTMLButtonElement | null>>>({})
  const isReader = isReaderRoute(location.pathname)
  const isMac = ui.windowState?.platform === 'darwin'
  const mod = isMac ? '⌘' : 'Ctrl+'

  useEffect(() => {
    if (!openMenu) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [openMenu])

  const entries = useMemo<Record<MenuName, MenuEntry[]>>(() => ({
    File: [
      { label: 'Add Paper…', shortcut: `${mod}N`, action: () => { navigate('/'); library.requestAddFocus() } },
      { label: 'Home', action: () => navigate('/') },
      { label: 'Settings', shortcut: `${mod},`, action: () => navigate('/settings') },
      { separator: true },
      { label: 'Close Window', shortcut: `${mod}W`, action: () => invoke('close-window') },
      { label: 'Quit Margin', shortcut: `${mod}Q`, action: () => invoke('quit') },
    ],
    Edit: [
      { label: 'Undo', shortcut: `${mod}Z`, action: () => invoke('undo') },
      { label: 'Redo', shortcut: isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z', action: () => invoke('redo') },
      { separator: true },
      { label: 'Cut', shortcut: `${mod}X`, action: () => invoke('cut') },
      { label: 'Copy', shortcut: `${mod}C`, action: () => invoke('copy') },
      { label: 'Paste', shortcut: `${mod}V`, action: () => invoke('paste') },
      { label: 'Select All', shortcut: `${mod}A`, action: () => invoke('select-all') },
    ],
    View: [
      { label: 'Papers Sidebar', shortcut: `${mod}B`, checked: ui.leftSidebarOpen, action: ui.toggleLeftSidebar },
      { label: 'Assistant', shortcut: isMac ? '⇧⌘B' : 'Ctrl+Shift+B', checked: ui.assistantOpen && isReader, disabled: !isReader, action: ui.toggleAssistant },
      { separator: true },
      { label: 'Zoom In', shortcut: `${mod}+`, disabled: ui.appZoom >= APP_ZOOM_LEVELS[APP_ZOOM_LEVELS.length - 1], action: ui.zoomIn },
      { label: 'Zoom Out', shortcut: `${mod}-`, disabled: ui.appZoom <= APP_ZOOM_LEVELS[0], action: ui.zoomOut },
      { label: 'Reset Zoom', shortcut: `${mod}0`, disabled: ui.appZoom === DEFAULT_APP_ZOOM, action: ui.resetZoom },
      { separator: true },
      { label: ui.theme === 'dark' ? 'Use Light Theme' : 'Use Dark Theme', action: ui.toggleTheme },
      { separator: true },
      { label: 'Reload', shortcut: `${mod}R`, action: () => invoke('reload') },
      { label: 'Full Screen', shortcut: 'F11', checked: ui.windowState?.fullScreen, action: () => invoke('toggle-full-screen') },
    ],
    Help: [
      { label: 'About Margin', action: ui.openAbout },
    ],
  }), [isMac, isReader, library.requestAddFocus, mod, navigate, ui])

  const focusMenuItem = (menu: MenuName, index: number) => {
    requestAnimationFrame(() => {
      const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>(`[data-menu="${menu}"] .menu-entry:not(:disabled)`)
      if (!buttons?.length) return
      buttons[(index + buttons.length) % buttons.length]?.focus()
    })
  }

  const switchMenu = (direction: number) => {
    if (!openMenu) return
    const index = MENU_NAMES.indexOf(openMenu)
    const next = MENU_NAMES[(index + direction + MENU_NAMES.length) % MENU_NAMES.length]
    setOpenMenu(next)
    menuButtons.current[next]?.focus()
  }

  const handleMenuKey = (event: React.KeyboardEvent, menu: MenuName) => {
    const buttons = [...(event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu-entry:not(:disabled)'))]
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      buttons[(current + 1) % buttons.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      buttons[(current - 1 + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault(); buttons[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault(); buttons.at(-1)?.focus()
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault(); switchMenu(event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'Escape') {
      event.preventDefault(); setOpenMenu(null); menuButtons.current[menu]?.focus()
    }
  }

  const runEntry = (entry: MenuEntry) => {
    if (entry.disabled) return
    setOpenMenu(null)
    entry.action?.()
  }

  return (
    <header
      className={`titlebar ${isMac ? 'titlebar-mac' : ''}`}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest('.titlebar-no-drag')) invoke('toggle-maximize')
      }}
    >
      <div className="titlebar-nav titlebar-no-drag">
        <button className="titlebar-icon" aria-label="Toggle papers sidebar" title="Toggle papers sidebar" onClick={ui.toggleLeftSidebar}>
          <Icon name="panel" />
        </button>
        <button className="titlebar-icon" aria-label="Back" disabled={!ui.windowState?.canGoBack} onClick={() => invoke('go-back')}>
          <Icon name="back" />
        </button>
        <button className="titlebar-icon" aria-label="Forward" disabled={!ui.windowState?.canGoForward} onClick={() => invoke('go-forward')}>
          <Icon name="forward" />
        </button>
      </div>
      <div className="app-menubar titlebar-no-drag" role="menubar" ref={rootRef}>
        {MENU_NAMES.map((name) => (
          <div className="app-menu" data-menu={name} key={name}>
            <button
              ref={(node) => { menuButtons.current[name] = node }}
              className={`menu-trigger ${openMenu === name ? 'open' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openMenu === name}
              onClick={() => {
                const opening = openMenu !== name
                setOpenMenu(opening ? name : null)
                if (opening) focusMenuItem(name, 0)
              }}
              onMouseEnter={() => { if (openMenu && openMenu !== name) setOpenMenu(name) }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); setOpenMenu(name); focusMenuItem(name, 0)
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  const index = MENU_NAMES.indexOf(name)
                  const next = MENU_NAMES[(index + (event.key === 'ArrowRight' ? 1 : -1) + MENU_NAMES.length) % MENU_NAMES.length]
                  menuButtons.current[next]?.focus()
                }
              }}
            >
              {name}
            </button>
            {openMenu === name && (
              <div className="menu-popover" role="menu" onKeyDown={(event) => handleMenuKey(event, name)}>
                {entries[name].map((entry, index) => entry.separator ? (
                  <div className="menu-divider" role="separator" key={`sep-${index}`} />
                ) : (
                  <button
                    className="menu-entry"
                    role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={entry.checked}
                    disabled={entry.disabled}
                    key={entry.label}
                    onClick={() => runEntry(entry)}
                  >
                    <span className="menu-check">{entry.checked && <Icon name="check" />}</span>
                    <span>{entry.label}</span>
                    {entry.shortcut && <span className="menu-shortcut">{entry.shortcut}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="titlebar-drag" />
      {!isMac && (
        <div className="window-controls titlebar-no-drag">
          <button aria-label="Minimize" onClick={() => invoke('minimize')}><Icon name="minimize" /></button>
          <button aria-label={ui.windowState?.maximized ? 'Restore' : 'Maximize'} onClick={() => invoke('toggle-maximize')}>
            <Icon name={ui.windowState?.maximized ? 'restore' : 'maximize'} />
          </button>
          <button className="window-close" aria-label="Close" onClick={() => invoke('close-window')}><Icon name="close" /></button>
        </div>
      )}
    </header>
  )
}
