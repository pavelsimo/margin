import { useEffect, useRef, useState } from 'react'
import { MODE_LABELS, MODES, PROVIDER_ENV_VARS, PROVIDER_LABELS, PROVIDERS, type Mode, type Provider } from '@shared/constants'
import type {
  CliExecutableInfo,
  CliExecutableSettings,
  OpenAiCompatibleProfile,
  OpenAiCompatibleProfileDraft,
  PromptInfo,
} from '@shared/ipc'
import { cleanIpcError } from '../state/libraryStore'
import { useReaderStore } from '../state/readerStore'

const EMPTY_EXECUTABLE_DRAFTS: Record<Provider, string> = { claude: '', codex: '', antigravity: '' }
const EMPTY_API_DRAFT: OpenAiCompatibleProfileDraft = {
  name: '',
  baseUrl: 'http://localhost:11434/v1',
  defaultModel: '',
  apiKey: '',
  models: [],
}

function executableDescription(provider: Provider, info: CliExecutableInfo): string {
  if (info.source === 'custom') return `Using custom executable: ${info.effectiveCommand}`
  if (info.source === 'environment') {
    return `Using ${PROVIDER_ENV_VARS[provider]}: ${info.effectiveCommand}`
  }
  return `Using “${info.effectiveCommand}” from the system PATH.`
}

function detectionStatus(info: CliExecutableInfo): string {
  if (info.detected) return `Detected at ${info.resolvedPath}`
  if (info.source === 'path') return `“${info.effectiveCommand}” was not found on the system PATH.`
  return `Executable not found at ${info.effectiveCommand}`
}

export default function Settings() {
  const [executables, setExecutables] = useState<CliExecutableSettings | null>(null)
  const [executableDrafts, setExecutableDrafts] = useState<Record<Provider, string>>(EMPTY_EXECUTABLE_DRAFTS)
  const [executableErrors, setExecutableErrors] = useState<Partial<Record<Provider, string>>>({})
  const [savedExecutable, setSavedExecutable] = useState<Provider | ''>('')
  const [busyExecutable, setBusyExecutable] = useState<Provider | ''>('')
  const [apiProfiles, setApiProfiles] = useState<OpenAiCompatibleProfile[] | null>(null)
  const [apiDraft, setApiDraft] = useState<OpenAiCompatibleProfileDraft | null>(null)
  const [apiBusy, setApiBusy] = useState(false)
  const [apiError, setApiError] = useState('')
  const [apiStatus, setApiStatus] = useState('')
  const [deleteApiProfile, setDeleteApiProfile] = useState<OpenAiCompatibleProfile | null>(null)
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
    void window.margin.invoke('settings:getOpenAiProviders').then(setApiProfiles)
  }, [])

  const beginAddApi = () => {
    setApiDraft({ ...EMPTY_API_DRAFT, models: [] })
    setApiError('')
    setApiStatus('')
  }

  const beginEditApi = (profile: OpenAiCompatibleProfile) => {
    setApiDraft({
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      defaultModel: profile.defaultModel,
      models: [...profile.models],
      apiKey: '',
    })
    setApiError('')
    setApiStatus('')
  }

  const testApiConnection = async () => {
    if (!apiDraft) return
    setApiBusy(true)
    setApiError('')
    setApiStatus('')
    try {
      const result = await window.margin.invoke('settings:testOpenAiProvider', apiDraft)
      const defaultModel = apiDraft.defaultModel || result.models[0] || ''
      setApiDraft((draft) => draft ? { ...draft, defaultModel, models: result.models } : draft)
      setApiStatus(`Connected · ${result.models.length} ${result.models.length === 1 ? 'model' : 'models'} found`)
    } catch (error) {
      setApiError(cleanIpcError(error))
    } finally {
      setApiBusy(false)
    }
  }

  const saveApiProfile = async () => {
    if (!apiDraft) return
    setApiBusy(true)
    setApiError('')
    setApiStatus('')
    try {
      const saved = await window.margin.invoke('settings:upsertOpenAiProvider', apiDraft)
      setApiProfiles((profiles) => {
        const next = [...(profiles ?? [])]
        const index = next.findIndex((profile) => profile.id === saved.id)
        if (index === -1) next.push(saved)
        else next[index] = saved
        return next
      })
      setApiDraft(null)
    } catch (error) {
      setApiError(cleanIpcError(error))
    } finally {
      setApiBusy(false)
    }
  }

  const refreshApiModels = async (profile: OpenAiCompatibleProfile) => {
    setApiBusy(true)
    setApiError('')
    setApiStatus('')
    try {
      const refreshed = await window.margin.invoke('settings:refreshOpenAiModels', profile.id)
      setApiProfiles((profiles) => profiles?.map((item) => item.id === refreshed.id ? refreshed : item) ?? null)
      setApiStatus(`${profile.name}: refreshed ${refreshed.models.length} ${refreshed.models.length === 1 ? 'model' : 'models'}`)
    } catch (error) {
      setApiError(cleanIpcError(error))
    } finally {
      setApiBusy(false)
    }
  }

  const confirmDeleteApiProfile = async () => {
    if (!deleteApiProfile) return
    setApiBusy(true)
    setApiError('')
    try {
      await window.margin.invoke('settings:deleteOpenAiProvider', deleteApiProfile.id)
      setApiProfiles((profiles) => profiles?.filter((profile) => profile.id !== deleteApiProfile.id) ?? null)
      setApiDraft((draft) => draft?.id === deleteApiProfile.id ? null : draft)
      setDeleteApiProfile(null)
    } catch (error) {
      setApiError(cleanIpcError(error))
    } finally {
      setApiBusy(false)
    }
  }

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

  const editingApiProfile = apiDraft?.id
    ? apiProfiles?.find((profile) => profile.id === apiDraft.id)
    : undefined
  const weakCredentialStorage = apiProfiles?.some((profile) => profile.credentialProtection === 'basic')

  return (
    <section className="route-page">
      <header className="route-header">
        <div className="route-title-group"><h1>Settings</h1></div>
      </header>
      <div className="route-scroll settings-scroll">
        <div className="settings-content">
          <div className="settings-section">
            <div className="settings-section-heading">
              <div>
                <span className="settings-section-title">OpenAI-compatible APIs</span>
                <span className="settings-section-copy">
                  Add Ollama or another compatible endpoint. Profiles are available to chats and automatic paper tagging.
                </span>
              </div>
              {!apiDraft && (
                <button className="btn" type="button" onClick={beginAddApi}>Add API</button>
              )}
            </div>
            {weakCredentialStorage && (
              <span className="credential-warning" role="status">
                Your Linux session does not provide an OS secret store. Saved API keys receive only basic local protection.
              </span>
            )}
            {apiProfiles?.map((profile) => (
              <div className="api-profile-card" key={profile.id}>
                <div className="card-head">
                  <span className="executable-label">{profile.name}</span>
                  <span className="api-profile-model mono">{profile.defaultModel}</span>
                  <span style={{ flex: 1 }} />
                  <button className="btn-ghost" type="button" disabled={apiBusy} onClick={() => beginEditApi(profile)}>
                    Edit
                  </button>
                </div>
                <span className="executable-source mono" title={profile.baseUrl}>{profile.baseUrl}</span>
                <span className="api-profile-meta mono">
                  {profile.models.length} cached {profile.models.length === 1 ? 'model' : 'models'} · {profile.hasApiKey ? 'API key saved' : 'No API key'}
                </span>
                <div className="executable-actions">
                  <button className="btn btn-soft" type="button" disabled={apiBusy} onClick={() => void refreshApiModels(profile)}>
                    Refresh models
                  </button>
                  <button className="btn-ghost danger-link" type="button" disabled={apiBusy} onClick={() => setDeleteApiProfile(profile)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {apiProfiles?.length === 0 && !apiDraft && (
              <span className="settings-empty">No API profiles yet. For local Ollama, use http://localhost:11434/v1.</span>
            )}
            {apiDraft && (
              <div className="api-profile-editor">
                <div className="card-head">
                  <span className="executable-label">{apiDraft.id ? 'Edit API profile' : 'Add API profile'}</span>
                </div>
                <label className="settings-field">
                  <span>Name</span>
                  <input
                    className="text-input"
                    value={apiDraft.name}
                    placeholder="Ollama"
                    maxLength={64}
                    onChange={(event) => setApiDraft({ ...apiDraft, name: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>Base URL</span>
                  <input
                    className="text-input mono"
                    value={apiDraft.baseUrl}
                    placeholder="http://localhost:11434/v1"
                    spellCheck={false}
                    onChange={(event) => setApiDraft({ ...apiDraft, baseUrl: event.target.value })}
                  />
                </label>
                <label className="settings-field">
                  <span>API key <span className="field-optional">optional</span></span>
                  <input
                    className="text-input mono"
                    type="password"
                    autoComplete="off"
                    value={apiDraft.apiKey ?? ''}
                    disabled={apiDraft.clearApiKey}
                    placeholder={editingApiProfile?.hasApiKey ? 'Leave blank to keep the saved key' : 'Not required by local Ollama'}
                    onChange={(event) => setApiDraft({ ...apiDraft, apiKey: event.target.value, clearApiKey: false })}
                  />
                </label>
                {editingApiProfile?.hasApiKey && (
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={Boolean(apiDraft.clearApiKey)}
                      onChange={(event) => setApiDraft({ ...apiDraft, clearApiKey: event.target.checked, apiKey: '' })}
                    />
                    Remove saved API key
                  </label>
                )}
                <label className="settings-field">
                  <span>Default model</span>
                  <input
                    className="text-input mono"
                    value={apiDraft.defaultModel}
                    list="openai-compatible-models"
                    placeholder="llama3.2"
                    spellCheck={false}
                    onChange={(event) => setApiDraft({ ...apiDraft, defaultModel: event.target.value })}
                  />
                  <datalist id="openai-compatible-models">
                    {(apiDraft.models ?? []).map((model) => <option value={model} key={model} />)}
                  </datalist>
                </label>
                <span className="settings-field-help">
                  Test the connection to load models, or enter one manually to save an offline endpoint.
                </span>
                {apiError && <span className="executable-error" role="alert">{apiError}</span>}
                {apiStatus && <span className="settings-success" role="status">{apiStatus}</span>}
                <div className="executable-actions">
                  <button className="btn btn-soft" type="button" disabled={apiBusy || !apiDraft.baseUrl.trim()} onClick={() => void testApiConnection()}>
                    {apiBusy ? 'Working…' : 'Test connection'}
                  </button>
                  <button
                    className="btn"
                    type="button"
                    disabled={apiBusy || !apiDraft.name.trim() || !apiDraft.baseUrl.trim() || !apiDraft.defaultModel.trim()}
                    onClick={() => void saveApiProfile()}
                  >
                    Save
                  </button>
                  <button className="btn-ghost" type="button" disabled={apiBusy} onClick={() => setApiDraft(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {!apiDraft && apiError && <span className="executable-error" role="alert">{apiError}</span>}
            {!apiDraft && apiStatus && <span className="settings-success" role="status">{apiStatus}</span>}
          </div>
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
                  <span
                    className={`executable-status mono${info.detected ? ' detected' : ''}`}
                    title={info.detected ? info.resolvedPath : info.effectiveCommand}
                  >
                    {detectionStatus(info)}
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
              Templates for each assistant mode. Placeholders: {'{context}'} is the selected block, page, or paper
              text; {'{question}'} is what you typed; {'{scope}'} is where the excerpt came from.
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
      {deleteApiProfile && (
        <div className="dialog-overlay" onClick={() => !apiBusy && setDeleteApiProfile(null)}>
          <div
            className="dialog dialog-small"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-api-title"
            aria-describedby="delete-api-description"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-api-title">Delete {deleteApiProfile.name}?</h2>
            <p className="dialog-copy" id="delete-api-description">
              This removes the endpoint, cached model list, and saved API key. Your chat history is unchanged.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-soft" type="button" disabled={apiBusy} onClick={() => setDeleteApiProfile(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" type="button" disabled={apiBusy} onClick={() => void confirmDeleteApiProfile()}>
                {apiBusy ? 'Deleting…' : 'Delete API'}
              </button>
            </div>
          </div>
        </div>
      )}
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
