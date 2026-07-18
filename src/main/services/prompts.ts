// Mode prompt templates and prompt assembly. Port of margin/prompts.py.
//
// A prompttemplate row exists only when the user customized a mode; otherwise
// the code default applies. Templates use {context}, {question}, and {scope}.

import type { Mode } from '@shared/constants'
import { db, utcnowSql, USER_ID } from '../db'
import { DEFAULT_PROMPTS } from './promptCore'

export * from './promptCore'

export function findTemplate(mode: string): { id: number; template: string } | undefined {
  return db
    .prepare('SELECT id, template FROM prompttemplate WHERE user_id = ? AND mode = ?')
    .get(USER_ID, mode) as { id: number; template: string } | undefined
}

export function effectiveTemplate(mode: string): string {
  const row = findTemplate(mode)
  if (row) return row.template
  return DEFAULT_PROMPTS[mode as Mode] ?? DEFAULT_PROMPTS.ask
}

export function setTemplate(mode: Mode, template: string): void {
  const row = findTemplate(mode)
  if (template.trim() === (DEFAULT_PROMPTS[mode] ?? '').trim()) {
    if (row) db.prepare('DELETE FROM prompttemplate WHERE id = ?').run(row.id) // back to stock — the record's existence means "customized"
    return
  }
  if (!row) {
    db.prepare('INSERT INTO prompttemplate (user_id, mode, template, updated_at) VALUES (?, ?, ?, ?)').run(
      USER_ID,
      mode,
      template,
      utcnowSql(),
    )
  } else {
    db.prepare('UPDATE prompttemplate SET template = ?, updated_at = ? WHERE id = ?').run(
      template,
      utcnowSql(),
      row.id,
    )
  }
}

export function resetTemplate(mode: Mode): void {
  const row = findTemplate(mode)
  if (row) db.prepare('DELETE FROM prompttemplate WHERE id = ?').run(row.id)
}

