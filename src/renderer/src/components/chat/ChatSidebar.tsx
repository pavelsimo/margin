import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import {
  CHIP_PREVIEW_CHARS,
  PROVIDER_EFFORTS,
  PROVIDER_LABELS,
  PROVIDER_MODELS,
  PROVIDERS,
  type Provider,
} from '@shared/constants'
import { ctxShort, useReaderStore, type DisplayMessage } from '../../state/readerStore'

function AiAvatar() {
  return <span className="ai-avatar">✦</span>
}

function MessageRow({ m }: { m: DisplayMessage }) {
  if (m.role === 'user') {
    return (
      <div className="msg-user">
        {m.ctx && <span className="msg-ctx">{ctxShort(m.ctx)}</span>}
        <span className="msg-bubble">{m.content}</span>
      </div>
    )
  }
  if (!m.content) return null
  return (
    <div className="msg-ai">
      <AiAvatar />
      {m.isError ? (
        <span className="msg-error">{m.content}</span>
      ) : (
        <div className="chat-md">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {m.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="msg-ai">
      <AiAvatar />
      <span className="typing-dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  )
}

const COMPOSER_SEND_WIDTH = 30
const COMPOSER_ROW_GAP = 8

function AiPicker() {
  const store = useReaderStore()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    void store.refreshDetectedProviders()
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const { provider, model, effort } = store.ai
  // Fail open while detection is unknown so options aren't hidden on a race.
  const availableProviders = store.detectedProviders ?? PROVIDERS
  const label = [PROVIDER_LABELS[provider], model, effort].filter(Boolean).join(' · ')

  useLayoutEffect(() => {
    const row = rootRef.current?.parentElement
    const measure = measureRef.current
    if (!row || !measure) return
    const update = () => {
      const available = row.clientWidth - COMPOSER_SEND_WIDTH - COMPOSER_ROW_GAP
      setCollapsed(measure.offsetWidth > available)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    return () => observer.disconnect()
  }, [label])

  return (
    <div className="ai-picker" ref={rootRef}>
      <button
        type="button"
        className={`ai-picker-trigger${collapsed ? ' collapsed' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? label : undefined}
        aria-label={label}
      >
        {collapsed ? '✦' : <span className="ai-picker-label">{label}</span>}
        <span style={{ fontSize: 9, color: 'var(--m-faint)' }}>⌄</span>
      </button>
      <span className="ai-picker-measure" aria-hidden="true" ref={measureRef}>
        {label}
        <span style={{ fontSize: 9 }}>⌄</span>
      </span>
      {open && availableProviders.length === 0 && (
        <div className="ai-picker-menu">
          <div className="menu-section">Provider</div>
          <div className="menu-empty">
            No AI CLI tools were found on this system.{' '}
            <Link to="/settings">Open Settings</Link>
          </div>
        </div>
      )}
      {open && availableProviders.length > 0 && (
        <div className="ai-picker-menu">
          <div className="menu-section">Provider</div>
          {availableProviders.map((p: Provider) => (
            <button key={p} className="menu-item" onClick={() => void store.chooseAiProvider(p)}>
              {PROVIDER_LABELS[p]}
              {provider === p && <span className="check">✓</span>}
            </button>
          ))}
          <div className="menu-separator" />
          <div className="menu-section">Effort</div>
          {PROVIDER_EFFORTS[provider].map((option) => (
            <button key={option || 'default'} className="menu-item" onClick={() => void store.chooseAiEffort(option)}>
              {option === '' ? 'Default' : option}
              {effort === option && <span className="check">✓</span>}
            </button>
          ))}
          <div className="menu-separator" />
          <div className="menu-section">Model</div>
          {PROVIDER_MODELS[provider].map((option) => (
            <button key={option || 'default'} className="menu-item" onClick={() => void store.chooseAiModel(option)}>
              {option === '' ? 'Default' : option}
              {model === option && <span className="check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function selectionLabel(store: ReturnType<typeof useReaderStore.getState>): string {
  if (store.selectedRegion.length === 4) return `Region · page ${store.selectedRegionPage}`
  return `${store.selectedKind === 'table' ? 'Table' : 'Figure'} · page ${store.currentPage}`
}

function chipShort(store: ReturnType<typeof useReaderStore.getState>): string {
  if (store.chipRegion.length === 4 || store.chipBlockId) return store.chipLabel
  const chip = store.chipText.trim()
  const prefix = store.chipBlockCount > 1 ? `${store.chipBlockCount} blocks · ` : ''
  const previewChars = Math.max(CHIP_PREVIEW_CHARS - prefix.length, 1)
  return prefix + chip.slice(0, previewChars) + (chip.length > previewChars ? '…' : '')
}

function inputPlaceholder(store: ReturnType<typeof useReaderStore.getState>): string {
  if (store.chipRegion.length === 4) return 'Ask about the selected region…'
  if (store.chipBlockId) return 'Ask about the selected figure…'
  if (store.chipText.trim()) {
    return store.chipBlockCount > 1 ? 'Ask about the highlighted passages…' : 'Ask about the highlighted passage…'
  }
  if (store.scope === 'page') return `Ask about page ${store.currentPage}…`
  return 'Ask about the paper…'
}

export default function ChatSidebar() {
  const store = useReaderStore()
  const messagesRef = useRef<HTMLDivElement>(null)
  const followOutputRef = useRef(true)
  const previousMessageCountRef = useRef(0)
  const streamingTextLength = store.messages.find((message) => message.requestId === store.activeRequestId)?.content.length ?? 0

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    if (store.messages.length > previousMessageCountRef.current) followOutputRef.current = true
    previousMessageCountRef.current = store.messages.length
    if (followOutputRef.current) el.scrollTop = el.scrollHeight
  }, [store.messages.length, store.typing, streamingTextLength])

  const hasChip = store.chipText.trim() !== '' || store.chipBlockId !== 0 || store.chipRegion.length === 4
  // A live figure/region selection previews above the input even before it is pinned with Ask.
  const hasSelectionPreview =
    store.selectedRegion.length === 4 || (store.selectedBlockIds.length > 0 && !store.selectedText.trim())
  const canSend = store.inputText.trim() !== '' && !store.typing
  const hasStreamingText = store.typing && streamingTextLength > 0
  const suggestions =
    store.scope === 'document'
      ? ['Summarize the paper', 'What are the contributions?', 'ELI12 this paper', 'What are the limitations?']
      : [`Summarize page ${store.currentPage}`, 'What problem does this solve?', 'Explain the key idea here']

  return (
    <div className="chat-sidebar">
      <div className="chat-title">
        <span style={{ color: 'var(--m-accent)', fontSize: 13 }}>✦</span>
        Assistant
      </div>
      <div className="scope-toggle">
        <button className={store.scope === 'page' ? 'active' : ''} onClick={() => store.setScope('page')}>
          Page {store.currentPage}
        </button>
        <button className={store.scope === 'document' ? 'active' : ''} onClick={() => store.setScope('document')}>
          Full Document
        </button>
      </div>
      <div
        className="chat-messages"
        ref={messagesRef}
        onScroll={(event) => {
          const el = event.currentTarget
          followOutputRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72
        }}
      >
        {store.messages.length === 0 && (
          <div className="chat-empty">
            <span className="ai-avatar" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 16 }}>
              ✦
            </span>
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--m-ink)' }}>Ask about this paper</span>
            <span style={{ fontSize: 12.5, color: 'var(--m-muted)' }}>
              Questions use the current scope. Drag to select blocks, or Shift-drag to send an exact visual region.
            </span>
          </div>
        )}
        {store.messages.map((m) => (
          <MessageRow key={m.key} m={m} />
        ))}
        {store.typing && !hasStreamingText && <TypingIndicator />}
        {store.messages.length === 0 && !store.typing && (
          <div className="suggestion-row">
            {suggestions.map((text) => (
              <button key={text} className="suggestion-pill" onClick={() => store.sendSuggestion(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="chat-input-area">
        {hasSelectionPreview ? (
          <div className="chat-chip chip-preview">
            {store.selectionThumb && <img className="chip-thumb" src={store.selectionThumb} alt="Selection preview" />}
            <span className="chip-text">{selectionLabel(store)}</span>
          </div>
        ) : (
          hasChip && (
            <div className="chat-chip">
              {store.chipThumb && <img className="chip-thumb" src={store.chipThumb} alt="Selection preview" />}
              <span className="chip-text">{chipShort(store)}</span>
              <button onClick={store.clearChip}>✕</button>
            </div>
          )
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            store.send()
          }}
        >
          <div className="chat-composer">
            <textarea
              placeholder={inputPlaceholder(store)}
              value={store.inputText}
              onChange={(e) => store.setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  store.send()
                }
              }}
              rows={3}
            />
            <div className="composer-row">
              <AiPicker />
              {store.typing ? (
                <button
                  type="button"
                  className="composer-send stop"
                  onClick={store.stop}
                  title="Stop generating"
                  aria-label="Stop generating"
                >
                  <span className="stop-square" />
                </button>
              ) : (
                <button type="submit" className={`composer-send ${canSend ? 'ready' : ''}`} disabled={!canSend}>
                  ↑
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
