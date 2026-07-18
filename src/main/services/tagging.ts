// AI-generated topic tags for papers. Port of margin/tagging.py.

import type { DocumentRow } from '@shared/models'
import { db, USER_ID } from '../db'
import * as ai from './ai'
import { aiChoice } from './chat'

import { parseTags } from './taggingCore'

export { parseTags }

const MAX_CONTEXT_CHARS = 12_000

export interface TaggingResult {
  ok: boolean
  tags: string[]
  error: string
  providerFailed: boolean
}

/** The user's existing tags with case-insensitive de-duplication. */
export function existingVocabulary(): string[] {
  const documents = db.prepare('SELECT tags FROM document WHERE user_id = ?').all(USER_ID) as { tags: string }[]
  const vocabulary = new Map<string, string>()
  for (const doc of documents) {
    for (const raw of doc.tags.split(',')) {
      const tag = raw.trim()
      if (tag && !vocabulary.has(tag.toLowerCase())) vocabulary.set(tag.toLowerCase(), tag)
    }
  }
  return [...vocabulary.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
}

/** Build a constrained topic-tagging prompt from the opening paper text. */
export function buildPrompt(document: DocumentRow): string {
  const pages = db
    .prepare('SELECT text FROM page WHERE document_id = ? ORDER BY number ASC')
    .all(document.id) as { text: string }[]
  const excerpt = pages.filter((p) => p.text).map((p) => p.text).join('\n\n').trim().slice(0, MAX_CONTEXT_CHARS)
  const vocabulary = existingVocabulary()
  const vocabularyHint = vocabulary.length ? vocabulary.join(', ') : '(none yet)'
  return `Identify 3 to 5 main technical topics in this research paper.

Return only a JSON array of strings, for example: ["MoE", "Sparse Attention", "Agentic Reasoning"].

Rules:
- Use concise topic tags of 1 to 4 words, never author names or the paper/model/product name.
- Prefer an established acronym by itself when one exists: use "MoE", "RAG", or "LLM", not its expanded phrase.
- Avoid generic tags such as "AI", "ML", "Machine Learning", "Research", or "Research Paper".
- Reuse the exact spelling and capitalization of an existing library tag when it describes the same concept.
- Return unique tags, with no commentary or Markdown.

Existing library tags: ${vocabularyHint}

Title: ${document.title}

Opening paper text:
${excerpt}
`
}

function splitTags(tags: string): string[] {
  return tags.split(',').map((t) => t.trim()).filter(Boolean)
}

/** Generate and persist tags unless the document was tagged or deleted concurrently. */
export async function generateDocumentTags(docId: number): Promise<TaggingResult> {
  const document = db.prepare('SELECT * FROM document WHERE id = ?').get(docId) as DocumentRow | undefined
  if (!document || document.user_id !== USER_ID) {
    return { ok: false, tags: [], error: 'This paper no longer exists.', providerFailed: false }
  }
  if (document.tags.trim()) return { ok: true, tags: splitTags(document.tags), error: '', providerFailed: false }

  const vocabulary = existingVocabulary()
  const prompt = buildPrompt(document)
  const choice = aiChoice()
  const response = await ai.runPrompt(choice.provider, prompt, { model: choice.model, effort: choice.effort })
  if (!response.ok) return { ok: false, tags: [], error: response.error, providerFailed: true }
  let tags: string[]
  try {
    tags = parseTags(response.text, vocabulary)
  } catch (exc) {
    return { ok: false, tags: [], error: exc instanceof Error ? exc.message : String(exc), providerFailed: false }
  }

  const stored = db.prepare('SELECT tags FROM document WHERE id = ?').get(docId) as { tags: string } | undefined
  if (!stored) {
    return { ok: false, tags: [], error: 'The paper was deleted while topics were being generated.', providerFailed: false }
  }
  if (stored.tags.trim()) return { ok: true, tags: splitTags(stored.tags), error: '', providerFailed: false }
  db.prepare('UPDATE document SET tags = ? WHERE id = ?').run(tags.join(','), docId)
  return { ok: true, tags, error: '', providerFailed: false }
}

/** Ready papers that still need topic tags, newest first. */
export function missingDocumentIds(): number[] {
  const rows = db
    .prepare(
      "SELECT id FROM document WHERE user_id = ? AND page_count > 0 AND TRIM(tags) = '' ORDER BY added_at DESC",
    )
    .all(USER_ID) as { id: number }[]
  return rows.map((r) => r.id)
}
