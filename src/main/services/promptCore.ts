// Pure prompt assembly, no DB access. Port of margin/prompts.py.

import type { ChatMessageRow } from '@shared/models'
import type { Mode } from '@shared/constants'

export const MAX_CONTEXT_CHARS = 12_000
export const MAX_HISTORY_MESSAGES = 10
export const TRUNCATION_MARKER = '\n[… truncated …]'

export const DEFAULT_PROMPTS: Record<Mode, string> = {
  ask:
    'You are a research assistant helping someone read a paper. ' +
    "Ground your answer in the excerpt below from {scope}; say so when the excerpt doesn't contain the answer. " +
    'Be concise and precise.\n\n' +
    'Excerpt:\n{context}\n\n' +
    'Question: {question}',
  explain:
    'You are a research assistant. Explain the following passage from {scope} clearly and precisely, ' +
    'unpacking notation, jargon, and any implicit assumptions.\n\n' +
    'Passage:\n{context}',
  summarize:
    'You are a research assistant. Summarize the following excerpt from {scope} in a few tight sentences, ' +
    'keeping the key claims and numbers.\n\n' +
    'Excerpt:\n{context}',
  eli12:
    "Explain the following excerpt from {scope} like I'm 12 years old: plain words, a concrete analogy, " +
    "no jargon, but don't dumb down the core idea.\n\n" +
    'Excerpt:\n{context}',
}

// Appended to every assembled prompt (default and customized templates alike) so
// replies render in the chat panel: markdown, with math in remark-math delimiters.
export const FORMAT_SUFFIX =
  '\n\nFormat your reply as Markdown. Write math as $...$ (inline) ' +
  'or $$...$$ (display); never use \\(...\\) or \\[...\\].'

export function capText(text: string, limit = MAX_CONTEXT_CHARS): string {
  if (text.length <= limit) return text
  return text.slice(0, limit - TRUNCATION_MARKER.length) + TRUNCATION_MARKER
}

/**
 * Python str.format_map semantics with a defaultdict: {name} → value or "",
 * doubled braces are literals, and unbalanced braces throw (the caller falls
 * back to plain concatenation, same as the web app).
 */
export function formatMap(template: string, values: Record<string, string>): string {
  let out = ''
  let i = 0
  while (i < template.length) {
    const ch = template[i]
    if (ch === '{') {
      if (template[i + 1] === '{') {
        out += '{'
        i += 2
        continue
      }
      const end = template.indexOf('}', i)
      if (end === -1) throw new Error("Single '{' encountered in format string")
      const field = template.slice(i + 1, end)
      if (field.includes('{')) throw new Error('unexpected nested brace')
      const name = field.split(/[:!]/, 1)[0]
      out += values[name] ?? ''
      i = end + 1
      continue
    }
    if (ch === '}') {
      if (template[i + 1] === '}') {
        out += '}'
        i += 2
        continue
      }
      throw new Error("Single '}' encountered in format string")
    }
    out += ch
    i++
  }
  return out
}

export function assemblePrompt(
  template: string,
  args: { context: string; question: string; scopeLabel: string; history?: ChatMessageRow[] },
): string {
  const values = { context: capText(args.context), question: args.question, scope: args.scopeLabel }
  let body: string
  try {
    body = formatMap(template, values)
  } catch {
    // unbalanced braces in a user-edited template
    body = `${template}\n\nExcerpt from ${args.scopeLabel}:\n${values.context}\n\nQuestion: ${args.question}`
  }
  body += FORMAT_SUFFIX
  const recent = (args.history ?? []).slice(-MAX_HISTORY_MESSAGES)
  if (!recent.length) return body
  const lines = recent.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
  return 'Earlier conversation about this paper:\n' + lines.join('\n') + '\n\n---\n\n' + body
}
