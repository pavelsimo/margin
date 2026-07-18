import { app } from 'electron'
import { existsSync } from 'node:fs'
import { isAbsolute, join, normalize, resolve } from 'node:path'

// Dev playground keeps data in ./data (inspectable with sqlite3); packaged
// builds fall back to the per-user data dir. MARGIN_DATA_DIR overrides both.
function findDataRoot(): string {
  if (process.env.MARGIN_DATA_DIR) return resolve(process.env.MARGIN_DATA_DIR)
  const local = resolve(app.getAppPath(), 'data')
  if (!app.isPackaged || existsSync(local)) return local
  return join(app.getPath('userData'), 'data')
}

export const DATA_ROOT = findDataRoot()
export const DB_PATH = join(DATA_ROOT, 'margin.db')
export const UPLOADS_ROOT = join(DATA_ROOT, 'uploaded_files')

/** Resolve a path relative to DATA_ROOT, rejecting escapes (protocol handler defense). */
export function safeResolve(base: string, relative: string): string {
  const abs = normalize(join(base, relative))
  if (!abs.startsWith(normalize(base) + '/') || isAbsolute(relative)) {
    throw new Error(`path escapes data root: ${relative}`)
  }
  return abs
}

// document.pdf_path already includes the "uploaded_files/" prefix (project-relative).
export function resolvePdf(pdfPath: string): string {
  return safeResolve(DATA_ROOT, pdfPath)
}

// page.image_path is relative to the uploads root (no prefix).
export function resolvePageImage(imagePath: string): string {
  return safeResolve(UPLOADS_ROOT, imagePath)
}

export function documentDir(documentId: number): string {
  return join(UPLOADS_ROOT, 'docs', String(documentId))
}
