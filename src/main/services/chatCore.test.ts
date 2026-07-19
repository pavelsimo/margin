import { describe, expect, it } from 'vitest'
import type { AiProviderInfo } from '@shared/ipc'
import {
  clearAllChatsForUser,
  fallbackChatTitle,
  resolveBackgroundChoice,
  sanitizeGeneratedTitle,
} from './chatCore'
import { sqliteTestDatabase } from './sqliteTestDatabase'

describe('resolveBackgroundChoice', () => {
  const providers: AiProviderInfo[] = [
    {
      id: 'claude',
      label: 'Claude',
      kind: 'cli',
      models: ['', 'fable', 'opus'],
      defaultModel: '',
      efforts: ['', 'low', 'high'],
      available: true,
    },
    {
      id: 'codex',
      label: 'Codex',
      kind: 'cli',
      models: ['', 'gpt-5.6-sol'],
      defaultModel: '',
      efforts: ['', 'low'],
      available: false,
    },
    {
      id: 'openai-compatible:profile-1',
      label: 'Ollama',
      kind: 'openai-compatible',
      models: ['llama3.2'],
      defaultModel: 'llama3.2',
      efforts: [''],
      available: true,
    },
  ]

  it('returns null when no choice is stored', () => {
    expect(resolveBackgroundChoice(null, providers)).toBeNull()
  })

  it('returns the stored choice for an available CLI provider with valid model and effort', () => {
    const stored = { provider: 'claude' as const, model: 'fable', effort: 'low' }
    expect(resolveBackgroundChoice(stored, providers)).toBe(stored)
    expect(resolveBackgroundChoice({ provider: 'claude', model: '', effort: '' }, providers))
      .toEqual({ provider: 'claude', model: '', effort: '' })
  })

  it('returns null when the CLI provider is undetected', () => {
    expect(resolveBackgroundChoice({ provider: 'codex', model: '', effort: '' }, providers)).toBeNull()
  })

  it('returns null when the provider no longer exists', () => {
    expect(resolveBackgroundChoice({ provider: 'openai-compatible:deleted', model: 'llama3.2', effort: '' }, providers))
      .toBeNull()
  })

  it('returns null for an unknown CLI model or effort', () => {
    expect(resolveBackgroundChoice({ provider: 'claude', model: 'unknown', effort: '' }, providers)).toBeNull()
    expect(resolveBackgroundChoice({ provider: 'claude', model: 'fable', effort: 'xhigh' }, providers)).toBeNull()
  })

  it('accepts an OpenAI-compatible choice with a model, rejecting empty models and efforts', () => {
    const stored = { provider: 'openai-compatible:profile-1' as const, model: 'anything', effort: '' }
    expect(resolveBackgroundChoice(stored, providers)).toBe(stored)
    expect(resolveBackgroundChoice({ ...stored, model: ' ' }, providers)).toBeNull()
    expect(resolveBackgroundChoice({ ...stored, effort: 'low' }, providers)).toBeNull()
  })
})

describe('clearAllChatsForUser', () => {
  it("removes chats across the user's papers without changing other users or paper data", () => {
    const { database, close } = sqliteTestDatabase()
    database.exec(`
      CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL);
      CREATE TABLE chatthread (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
      CREATE TABLE chatmessage (id INTEGER PRIMARY KEY, thread_id INTEGER NOT NULL, document_id INTEGER NOT NULL, user_id INTEGER NOT NULL);
      CREATE TABLE page (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
      CREATE TABLE prompttemplate (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, template TEXT NOT NULL);

      INSERT INTO document VALUES (10, 1, 'First'), (11, 1, 'Second'), (20, 2, 'Other user');
      INSERT INTO chatthread VALUES (100, 10, 1), (110, 11, 1), (200, 20, 2);
      INSERT INTO chatmessage VALUES (1, 100, 10, 1), (2, 100, 10, 1), (3, 110, 11, 1), (4, 200, 20, 2);
      INSERT INTO page VALUES (100, 10), (110, 11), (200, 20);
      INSERT INTO prompttemplate VALUES (1, 1, 'custom prompt');
    `)

    expect(clearAllChatsForUser(database, 1)).toEqual({ threadsDeleted: 2, messagesDeleted: 3 })
    const ids = (sql: string) => (database.prepare(sql).all() as { id: number }[]).map((row) => row.id)
    expect(ids('SELECT id FROM chatmessage ORDER BY id')).toEqual([4])
    expect(ids('SELECT id FROM chatthread ORDER BY id')).toEqual([200])
    expect(ids('SELECT id FROM document ORDER BY id')).toEqual([10, 11, 20])
    expect(ids('SELECT id FROM page ORDER BY id')).toEqual([100, 110, 200])
    expect((database.prepare('SELECT template FROM prompttemplate').get() as { template: string }).template).toBe('custom prompt')

    close()
  })

  it('reports zero when the user has no chats', () => {
    const { database, close } = sqliteTestDatabase()
    database.exec(`
      CREATE TABLE document (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
      CREATE TABLE chatthread (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
      CREATE TABLE chatmessage (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL);
    `)

    expect(clearAllChatsForUser(database, 1)).toEqual({ threadsDeleted: 0, messagesDeleted: 0 })
    close()
  })
})

describe('chat titles', () => {
  it('sanitizes provider output to one plain-text line and at most seven words', () => {
    expect(sanitizeGeneratedTitle('**Chat title:** "Understanding Sparse Transformer Attention Today"\nExtra')).toBe(
      'Understanding Sparse Transformer Attention Today',
    )
    expect(sanitizeGeneratedTitle('one two three four five six seven eight nine')).toBe(
      'one two three four five six seven',
    )
  })

  it('derives a bounded fallback and handles empty questions', () => {
    expect(fallbackChatTitle('Why does the attention mechanism use scaling?')).toBe(
      'Why does the attention mechanism use scaling',
    )
    expect(fallbackChatTitle('', 'Previous chat')).toBe('Previous chat')
  })
})
