// Extraction parity gate: run the mupdf.js extractor on an already-ingested
// PDF and diff text blocks/bboxes against the rows PyMuPDF produced.
// Usage: npx tsx scripts/parity-check.ts [docId]

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractBlocks, openPdf } from '../src/main/services/pdf'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docId = Number(process.argv[2] ?? 1)
const db = new DatabaseSync(join(root, 'data/margin.db'), { readOnly: true })

const doc = db.prepare('SELECT id, title, pdf_path, page_count FROM document WHERE id = ?').get(docId) as
  | { id: number; title: string; pdf_path: string; page_count: number }
  | undefined
if (!doc) throw new Error(`document ${docId} not found`)
console.log(`Doc ${doc.id}: "${doc.title}" (${doc.page_count} pages)`)

const pdf = openPdf(readFileSync(join(root, 'data', doc.pdf_path)))

const TOL = 0.01 // normalized units; ~0.6pt on a 612pt page — allow minor engine drift
let pagesChecked = 0
let matched = 0
let missing = 0
let extra = 0
let textMismatch = 0

for (let pageNo = 1; pageNo <= doc.page_count; pageNo++) {
  const pageRow = db.prepare('SELECT id FROM page WHERE document_id = ? AND number = ?').get(docId, pageNo) as
    | { id: number }
    | undefined
  if (!pageRow) continue
  const stored = db
    .prepare("SELECT kind, text, x0, y0, x1, y1 FROM block WHERE page_id = ? AND kind = 'text' ORDER BY order_index")
    .all(pageRow.id) as { kind: string; text: string; x0: number; y0: number; x1: number; y1: number }[]
  const page = pdf.loadPage(pageNo - 1)
  const ours = extractBlocks(page as never).filter((b) => b.kind === 'text')
  page.destroy()
  pagesChecked++

  const usedOurs = new Set<number>()
  for (const s of stored) {
    const idx = ours.findIndex(
      (o, i) =>
        !usedOurs.has(i) &&
        Math.abs(o.bbox[0] - s.x0) < TOL &&
        Math.abs(o.bbox[1] - s.y0) < TOL &&
        Math.abs(o.bbox[2] - s.x1) < TOL &&
        Math.abs(o.bbox[3] - s.y1) < TOL,
    )
    if (idx === -1) {
      missing++
      continue
    }
    usedOurs.add(idx)
    const normalize = (t: string) => t.replace(/\s+/g, ' ').trim()
    if (normalize(ours[idx].text) === normalize(s.text)) matched++
    else {
      textMismatch++
      if (textMismatch <= 3) {
        console.log(`  page ${pageNo} text diff:\n    stored: ${JSON.stringify(s.text.slice(0, 80))}\n    ours:   ${JSON.stringify(ours[idx].text.slice(0, 80))}`)
      }
    }
  }
  extra += ours.length - usedOurs.size
}

pdf.destroy()
const totalStored = matched + missing + textMismatch
console.log(`\nPages checked: ${pagesChecked}`)
console.log(`Stored text blocks: ${totalStored}`)
console.log(`  bbox+text match: ${matched} (${((matched / totalStored) * 100).toFixed(1)}%)`)
console.log(`  bbox match, text differs: ${textMismatch}`)
console.log(`  no bbox match (missing): ${missing}`)
console.log(`  extra blocks we found: ${extra}`)
