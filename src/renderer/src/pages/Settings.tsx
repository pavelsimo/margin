import { useEffect, useRef, useState } from 'react'
import { MODE_LABELS, MODES, PROVIDER_ENV_VARS, PROVIDER_LABELS, PROVIDERS, type Mode, type Provider } from '@shared/constants'
import type { CliExecutableInfo, CliExecutableSettings, PromptInfo } from '@shared/ipc'
import { cleanIpcError } from '../state/libraryStore'
import { useReaderStore } from '../state/readerStore'

const EMPTY_EXECUTABLE_DRAFTS: Record<Provider, string> = { claude: '', codex: '', antigravity: '' }

function executableDescription(provider: Provider, info: CliExecutableInfo): string {
  if (info.source === 'custom') return `Using custom executable: ${info.effectiveCommand}`
  if (info.source === 'environment') {
    return `Using ${PROVIDER_ENV_VARS[provider]}: ${info.effectiveCommand}`
  }
  return `Using “${info.effectiveCommand}” from the system PATH.`
}

export default function Settings() {
  const [executables, setExecutables] = useState<CliExecutableSettings | null>(null)
  const [executableDrafts, setExecutableDrafts] = useState<Record<Provider, string>>(EMPTY_EXECUTABLE_DRAFTS)
  const [executableErrors, setExecutableErrors] = useState<Partial<Record<Provider, string>>>({})
  const [savedExecutable, setSavedExecutable] = useState<Provider | ''>('')
  const [busyExecutable, setBusyExecutable] = useState<Provider | ''>('')
  const [prompts, setPrompts] = useState<Record<Mode, PromptInfo> | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [savedMode, setSavedMode] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingHistory, setDeletingHistory] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deleteStatus, setDeleteStatus] = useState('')
  const deleteInFlight = useRef(false)

  useEffect(() => {
    void window.margin.invoke('settings:getExecutables').then((result) => {
      setExecutables(result)
      setExecutableDrafts(
        Object.fromEntries(PROVIDERS.map((provider) => [provider, result[provider].customPath])) as Record<Provider, string>,
      )
    })
    void window.margin.invoke('prompts:get').then((result) => {
      setPrompts(result)
      setDrafts(Object.fromEntries(MODES.map((mode) => [mode, result[mode].template])))
    })
  }, [])

  const saveExecutablePath = async (provider: Provider) => {
    setBusyExecutable(provider)
    setExecutableErrors((errors) => ({ ...errors, [provider]: '' }))
    try {
      const info = await window.margin.invoke('settings:setExecutable', {
        provider,
        path: executableDrafts[provider],
      })
      setExecutables((current) => current ? { ...current, [provider]: info } : current)
      setExecutableDrafts((drafts) => ({ ...drafts, [provider]: info.customPath }))
      setSavedExecutable(provider)
    } catch (error) {
      setExecutableErrors((errors) => ({ ...errors, [provider]: cleanIpcError(error) }))
      setSavedExecutable('')
    } finally {
      setBusyExecutable('')
    }
  }

  const resetExecutablePath = async (provider: Provider) => {
    setBusyExecutable(provider)
    setExecutableErrors((errors) => ({ ...errors, [provider]: '' }))
    try {
      const info = await window.margin.invoke('settings:resetExecutable', provider)
      setExecutables((current) => current ? { ...current, [provider]: info } : current)
      setExecutableDrafts((drafts) => ({ ...drafts, [provider]: '' }))
      setSavedExecutable(provider)
    } catch (error) {
      setExecutableErrors((errors) => ({ ...errors, [provider]: cleanIpcError(error) }))
      setSavedExecutable('')
    } finally {
      setBusyExecutable('')
    }
  }

  const chooseExecutablePath = async (provider: Provider) => {
    setBusyExecutable(provider)
    setExecutableErrors((errors) => ({ ...errors, [provider]: '' }))
    try {
      const path = await window.margin.invoke('settings:chooseExecutable', provider)
      if (path) {
        setExecutableDrafts((drafts) => ({ ...drafts, [provider]: path }))
        setSavedExecutable('')
      }
    } catch (error) {
      setExecutableErrors((errors) => ({ ...errors, [provider]: cleanIpcError(error) }))
    } finally {
      setBusyExecutable('')
    }
  }

  useEffect(() => {
    if (!deleteDialogOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleteInFlight.current) setDeleteDialogOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [deleteDialogOpen])

  const save = async (mode: Mode) => {
    const draft = drafts[mode]?.trim()
    if (!draft) return
    const info = await window.margin.invoke('prompts:set', { mode, template: draft })
    setPrompts((p) => (p ? { ...p, [mode]: info } : p))
    setSavedMode(mode)
  }

  const reset = async (mode: Mode) => {
    const info = await window.margin.invoke('prompts:reset', mode)
    setPrompts((p) => (p ? { ...p, [mode]: info } : p))
    setDrafts((d) => ({ ...d, [mode]: info.template }))
    setSavedMode('')
  }

  const openDeleteDialog = () => {
    setDeleteError('')
    setDeleteStatus('')
    setDeleteDialogOpen(true)
  }

  const closeDeleteDialog = () => {
    if (!deleteInFlight.current) setDeleteDialogOpen(false)
  }

  const deleteAllChatHistory = async () => {
    if (deleteInFlight.current) return
    deleteInFlight.current = true
    setDeletingHistory(true)
    setDeleteError('')
    try {
      const count = await window.margin.invoke('chat:clearAll')
      useReaderStore.getState().clearAllChatHistory()
      setDeleteStatus(`Deleted ${count} chat ${count === 1 ? 'message' : 'messages'} across all papers.`)
      setDeleteDialogOpen(false)
    } catch (err) {
      setDeleteError(cleanIpcError(err))
    } finally {
      deleteInFlight.current = false
      setDeletingHistory(false)
    }
  }

  return (
    <section className="route-page">
      <header className="route-header">
        <div className="route-title-group"><h1>Settings</h1></div>
      </header>
      <div className="route-scroll settings-scroll">
        <div className="settings-content">
          <div className="settings-section">
            <span className="settings-section-title">AI command-line tools</span>
            <span className="settings-section-copy">
              Choose an executable when a CLI is not available on the system PATH. Changes apply to
              new chats and automatic paper tagging immediately.
            </span>
            {executables && PROVIDERS.map((provider) => {
              const info = executables[provider]
              const busy = busyExecutable === provider
              return (
                <div key={provider} className="executable-card">
                  <div className="card-head">
                    <span className="executable-label">{PROVIDER_LABELS[provider]} CLI</span>
                    <span style={{ flex: 1 }} />
                    {savedExecutable === provider && <span className="settings-saved mono">saved ✓</span>}
                  </div>
                  <div className="executable-input-row">
                    <input
                      className="text-input mono executable-input"
                      value={executableDrafts[provider]}
                      placeholder={`Automatic (${provider})`}
                      spellCheck={false}
                      onChange={(event) => {
                        setExecutableDrafts((drafts) => ({ ...drafts, [provider]: event.target.value }))
                        setExecutableErrors((errors) => ({ ...errors, [provider]: '' }))
                        setSavedExecutable('')
                      }}
                    />
                    <button
                      className="btn btn-soft"
                      type="button"
                      disabled={busy}
                      onClick={() => void chooseExecutablePath(provider)}
                    >
                      Browse…
                    </button>
                  </div>
                  <span className="executable-source mono" title={info.effectiveCommand}>
                    {executableDescription(provider, info)}
                  </span>
                  {executableErrors[provider] && (
                    <span className="executable-error" role="alert">{executableErrors[provider]}</span>
                  )}
                  <div className="executable-actions">
                    <button
                      className="btn"
                      type="button"
                      disabled={busy || !executableDrafts[provider].trim()}
                      onClick={() => void saveExecutablePath(provider)}
                    >
                      Save
                    </button>
                    {info.customPath && (
                      <button
                        className="btn-ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void resetExecutablePath(provider)}
                      >
                        Use automatic default
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="settings-section">
            <span className="settings-section-title">Mode prompts</span>
            <span className="settings-section-copy">
              Templates for each assistant mode. Placeholders: {'{context}'} — the selected block, page, or paper
              text; {'{question}'} — what you typed; {'{scope}'} — where the excerpt came from.
            </span>
            {prompts &&
              MODES.map((mode) => (
                <div key={mode} className="prompt-card">
                  <div className="card-head">
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--m-ink)' }}>{MODE_LABELS[mode]}</span>
                    {prompts[mode].customized && (
                      <span className="mono" style={{ color: 'var(--m-accent-text)', fontSize: 10.5 }}>
                        customized
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {savedMode === mode && (
                      <span className="mono" style={{ color: 'var(--m-accent-text)', fontSize: 10.5 }}>
                        saved ✓
                      </span>
                    )}
                  </div>
                  <textarea
                    rows={6}
                    value={drafts[mode] ?? ''}
                    onChange={(e) => {
                      setDrafts((d) => ({ ...d, [mode]: e.target.value }))
                      setSavedMode('')
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn"
                      style={{ background: 'var(--m-accent)', color: 'var(--m-inv-text)', border: 'none' }}
                      onClick={() => void save(mode)}
                    >
                      Save
                    </button>
                    {prompts[mode].customized && (
                      <button className="btn-ghost" onClick={() => void reset(mode)}>
                        Reset to default
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
          <div className="settings-section">
            <span className="settings-section-title">Data</span>
            <div className="danger-card">
              <div className="danger-card-copy">
                <span className="danger-card-title">Delete all chat histories</span>
                <span id="delete-chat-setting-description">
                  Permanently remove every assistant conversation across all papers. Your papers, PDFs, and
                  settings will be preserved.
                </span>
              </div>
              <button
                className="btn btn-danger"
                type="button"
                aria-describedby="delete-chat-setting-description"
                onClick={openDeleteDialog}
              >
                Delete all chat histories
              </button>
              {deleteStatus && <span className="settings-success" role="status">{deleteStatus}</span>}
            </div>
          </div>
        </div>
      </div>
      {deleteDialogOpen && (
        <div className="dialog-overlay" onClick={closeDeleteDialog}>
          <div
            className="dialog dialog-small"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-chat-title"
            aria-describedby="delete-chat-description"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-chat-title">Delete all chat histories?</h2>
            <p className="dialog-copy" id="delete-chat-description">
              This permanently deletes every conversation across all of your papers. Your papers and settings
              will not be affected.
            </p>
            {deleteError && <div className="error-text dialog-error">{deleteError}</div>}
            <div className="dialog-actions">
              <button className="btn btn-soft" type="button" disabled={deletingHistory} onClick={closeDeleteDialog}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={deletingHistory}
                onClick={() => void deleteAllChatHistory()}
              >
                {deletingHistory ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
