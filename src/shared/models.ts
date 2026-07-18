// Row types mirroring margin/models.py (snake_case columns kept verbatim).

export interface DocumentRow {
  id: number
  user_id: number
  title: string
  authors: string
  venue: string
  tags: string // comma-separated
  source_url: string
  pdf_path: string // e.g. "uploaded_files/docs/1/original.pdf" (project-relative)
  page_count: number
  added_at: string // naive UTC "YYYY-MM-DD HH:MM:SS.ffffff"
}

export interface PageRow {
  id: number
  document_id: number
  number: number // 1-based
  image_path: string // e.g. "docs/1/pages/3.png" (relative to uploads root)
  width: number // PDF points
  height: number
  text: string
}

export interface BlockRow {
  id: number
  page_id: number
  kind: 'text' | 'image' | 'table'
  text: string
  order_index: number
  x0: number // fractions of page size (0–1)
  y0: number
  x1: number
  y1: number
}

export interface ChatMessageRow {
  id: number
  document_id: number
  user_id: number
  role: 'user' | 'assistant'
  content: string
  context_text: string
  mode: string
  scope: 'page' | 'document'
  page_number: number | null
  created_at: string
}
