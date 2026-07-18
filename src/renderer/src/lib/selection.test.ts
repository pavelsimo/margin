import { describe, expect, it } from 'vitest'
import {
  clickSelection,
  normalizeSelection,
  parseRegionPayload,
  regionSelection,
  selectionText,
} from './selection'

// Oracle: margin/selection.py semantics.
const blocks = [
  { id: 1, kind: 'text', text: 'alpha' },
  { id: 2, kind: 'text', text: 'beta' },
  { id: 3, kind: 'image', text: '' },
  { id: 4, kind: 'table', text: 'gamma' },
  { id: 5, kind: 'text', text: 'delta' },
]

describe('parseRegionPayload', () => {
  it('accepts valid block payloads', () => {
    expect(parseRegionPayload({ kind: 'blocks', ids: [1, 2], additive: true })).toEqual({
      kind: 'blocks',
      ids: [1, 2],
      additive: true,
    })
  })
  it('rejects coerced ids', () => {
    expect(parseRegionPayload({ kind: 'blocks', ids: ['1'] })).toBeNull()
    expect(parseRegionPayload({ kind: 'blocks', ids: [1.5] })).toBeNull()
  })
  it('accepts valid regions and rejects degenerate ones', () => {
    expect(parseRegionPayload({ kind: 'region', x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 })).toMatchObject({
      kind: 'region',
      x0: 0.1,
    })
    expect(parseRegionPayload({ kind: 'region', x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.6 })).toBeNull()
    expect(parseRegionPayload({ kind: 'region', x0: -0.1, y0: 0.2, x1: 0.5, y1: 0.6 })).toBeNull()
    expect(parseRegionPayload({ kind: 'region', x0: NaN, y0: 0.2, x1: 0.5, y1: 0.6 })).toBeNull()
  })
  it('rejects junk', () => {
    expect(parseRegionPayload(null)).toBeNull()
    expect(parseRegionPayload('nope')).toBeNull()
    expect(parseRegionPayload({ kind: 'other' })).toBeNull()
  })
})

describe('normalizeSelection', () => {
  it('drops stale ids and keeps reading order', () => {
    expect(normalizeSelection(blocks, [5, 99, 1])).toEqual([1, 5])
  })
})

describe('clickSelection', () => {
  it('plain click selects one block', () => {
    expect(clickSelection(blocks, [], 0, 2)).toEqual({ blockIds: [2], anchorId: 2 })
  })
  it('plain click replaces an existing selection', () => {
    expect(clickSelection(blocks, [1, 2], 1, 5)).toEqual({ blockIds: [5], anchorId: 5 })
  })
  it('ctrl-click toggles membership', () => {
    expect(clickSelection(blocks, [1], 1, 2, { ctrl: true })).toEqual({ blockIds: [1, 2], anchorId: 2 })
    expect(clickSelection(blocks, [1, 2], 1, 1, { ctrl: true })).toEqual({ blockIds: [2], anchorId: 1 })
  })
  it('image blocks are exclusive single-selection', () => {
    expect(clickSelection(blocks, [1, 2], 1, 3)).toEqual({ blockIds: [3], anchorId: 3 })
    expect(clickSelection(blocks, [3], 3, 3, { ctrl: true })).toEqual({ blockIds: [], anchorId: 3 })
  })
  it('shift-click selects a range over non-image blocks', () => {
    expect(clickSelection(blocks, [1], 1, 5, { shift: true })).toEqual({ blockIds: [1, 2, 4, 5], anchorId: 5 })
  })
  it('shift-click backwards works', () => {
    expect(clickSelection(blocks, [5], 5, 1, { shift: true })).toEqual({ blockIds: [1, 2, 4, 5], anchorId: 1 })
  })
  it('ctrl+shift extends the current selection with the range', () => {
    expect(clickSelection(blocks, [1], 4, 5, { ctrl: true, shift: true })).toEqual({
      blockIds: [1, 4, 5],
      anchorId: 5,
    })
  })
  it('unknown clicked id normalizes and keeps anchor', () => {
    expect(clickSelection(blocks, [2, 99], 2, 42)).toEqual({ blockIds: [2], anchorId: 2 })
  })
})

describe('regionSelection', () => {
  it('replaces the selection with candidates', () => {
    expect(regionSelection(blocks, [1], 1, [2, 4], false)).toEqual({ blockIds: [2, 4], anchorId: 4 })
  })
  it('extends additively without duplicates', () => {
    expect(regionSelection(blocks, [1, 2], 1, [2, 5], true)).toEqual({ blockIds: [1, 2, 5], anchorId: 5 })
  })
  it('empty candidates clear a non-additive selection', () => {
    expect(regionSelection(blocks, [1, 2], 1, [], false)).toEqual({ blockIds: [], anchorId: 0 })
  })
  it('empty candidates keep an additive selection', () => {
    expect(regionSelection(blocks, [1, 2], 1, [], true)).toEqual({ blockIds: [1, 2], anchorId: 1 })
  })
  it('image blocks are never included from a drag', () => {
    expect(regionSelection(blocks, [], 0, [2, 3], false)).toEqual({ blockIds: [2], anchorId: 2 })
  })
})

describe('selectionText', () => {
  it('joins text in reading order, skipping images and empties', () => {
    expect(selectionText(blocks, [5, 3, 1])).toBe('alpha\n\ndelta')
  })
})
