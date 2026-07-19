import { describe, expect, it } from 'vitest'
import type { ChatMessageRow } from '@shared/models'
import {
  assemblePrompt,
  capText,
  DEFAULT_PROMPTS,
  FORMAT_SUFFIX,
  formatMap,
  MAX_CONTEXT_CHARS,
  TRUNCATION_MARKER,
} from './promptCore'

// Oracle: margin/prompts.py semantics.

function msg(role: 'user' | 'assistant', content: string): ChatMessageRow {
  return {
    id: 1,
    thread_id: 1,
    document_id: 1,
    user_id: 1,
    role,
    content,
    context_text: '',
    mode: '',
    scope: 'page',
    page_number: null,
    created_at: '2026-01-01 00:00:00.000000',
  }
}

describe('capText', () => {
  it('leaves short text alone', () => {
    expect(capText('hello')).toBe('hello')
  })
  it('truncates with the marker, keeping total length at the limit', () => {
    const long = 'x'.repeat(MAX_CONTEXT_CHARS + 100)
    const capped = capText(long)
    expect(capped.length).toBe(MAX_CONTEXT_CHARS)
    expect(capped.endsWith(TRUNCATION_MARKER)).toBe(true)
  })
})

describe('formatMap', () => {
  it('substitutes known placeholders', () => {
    expect(formatMap('a {x} b {y}', { x: '1', y: '2' })).toBe('a 1 b 2')
  })
  it('unknown placeholders become empty (defaultdict behavior)', () => {
    expect(formatMap('a {nope} b', {})).toBe('a  b')
  })
  it('doubled braces are literals', () => {
    expect(formatMap('{{literal}} {x}', { x: 'v' })).toBe('{literal} v')
  })
  it('unbalanced braces throw', () => {
    expect(() => formatMap('broken {', {})).toThrow()
    expect(() => formatMap('broken }', {})).toThrow()
  })
})

describe('assemblePrompt', () => {
  it('renders the default ask template with the format suffix', () => {
    const prompt = assemblePrompt(DEFAULT_PROMPTS.ask, {
      context: 'CTX',
      question: 'Q?',
      scopeLabel: 'page 3 of the paper',
    })
    expect(prompt).toContain('Excerpt:\nCTX')
    expect(prompt).toContain('Question: Q?')
    expect(prompt).toContain('page 3 of the paper')
    expect(prompt.endsWith(FORMAT_SUFFIX)).toBe(true)
  })
  it('falls back to concatenation for malformed templates', () => {
    const prompt = assemblePrompt('bad {template', { context: 'CTX', question: 'Q?', scopeLabel: 'the paper "T"' })
    expect(prompt).toContain('bad {template')
    expect(prompt).toContain('Excerpt from the paper "T":\nCTX')
    expect(prompt).toContain('Question: Q?')
  })
  it('prefixes recent history, capped at 10 messages', () => {
    const history = Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`))
    const prompt = assemblePrompt(DEFAULT_PROMPTS.ask, {
      context: 'c',
      question: 'q',
      scopeLabel: 's',
      history,
    })
    expect(prompt.startsWith('Earlier conversation about this paper:\n')).toBe(true)
    expect(prompt).not.toContain('User: m0')
    expect(prompt).not.toContain('Assistant: m1\n')
    expect(prompt).toContain('User: m2')
    expect(prompt).toContain('Assistant: m11')
    expect(prompt).toContain('\n\n---\n\n')
  })
  it('omits the history prefix when history is empty', () => {
    const prompt = assemblePrompt(DEFAULT_PROMPTS.explain, { context: 'c', question: '', scopeLabel: 's' })
    expect(prompt.startsWith('You are a research assistant.')).toBe(true)
  })
})
