import { describe, expect, it } from 'vitest'
import type { PaperRow } from '@shared/ipc'
import { filterPaperRows } from './libraryStore'

function row(title: string, tags: string[]): PaperRow {
  return {
    id: 1,
    title,
    tags,
    previewUrl: null,
    pagesLabel: '10 pp',
    added: 'Jul 17',
    isNew: false,
    isFailed: false,
    isIngesting: false,
    isTagging: false,
    isReady: true,
  }
}

const rows = [row('Attention Is All You Need', ['Transformers']), row('LFM2 Report', ['MoE', 'On-Device Inference'])]

describe('filterPaperRows', () => {
  it('returns everything for an empty query', () => {
    expect(filterPaperRows(rows, '')).toEqual(rows)
  })
  it('searches title case-insensitively', () => {
    expect(filterPaperRows(rows, 'attention')).toHaveLength(1)
  })
  it('searches tags case-insensitively', () => {
    expect(filterPaperRows(rows, 'ON-DEVICE')).toHaveLength(1)
  })
})
