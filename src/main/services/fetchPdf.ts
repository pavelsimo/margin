// PDF download and validation. Port of the URL handling in margin/ingest.py.

import { MAX_PDF_BYTES } from '@shared/constants'

const FETCH_TIMEOUT = 30_000

/** A user-facing problem with the supplied PDF or URL. */
export class PdfError extends Error {}

export function validatePdf(data: Buffer): void {
  if (data.length > MAX_PDF_BYTES) throw new PdfError('PDF is larger than 50 MB.')
  if (!data.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new PdfError("That file doesn't look like a PDF.")
}

export function normalizePdfUrl(url: string): string {
  url = url.trim()
  if (url.includes('arxiv.org/abs/')) url = url.replace('/abs/', '/pdf/')
  return url
}

/** Download a PDF with a size cap. Throws PdfError with a user-facing message. */
export async function fetchPdfFromUrl(url: string): Promise<Buffer> {
  url = normalizePdfUrl(url)
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new PdfError('Enter an http(s) link to a PDF or arXiv page.')
  }
  let data: Buffer
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'margin/0.1' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data = Buffer.from(await response.arrayBuffer())
  } catch (exc) {
    throw new PdfError(`Couldn't fetch that link: ${exc instanceof Error ? exc.message : exc}`)
  }
  validatePdf(data)
  return data
}
