// Pure reader block-selection rules. 1:1 port of margin/selection.py.

export interface SelectableBlock {
  id: number
  kind: string
  text: string
}

export interface SelectionResult {
  blockIds: number[]
  anchorId: number
}

export interface BlockSelectionRequest {
  kind: 'blocks'
  ids: number[]
  additive: boolean
}

export interface RegionSelectionRequest {
  kind: 'region'
  x0: number
  y0: number
  x1: number
  y1: number
}

export type SelectionRequest = BlockSelectionRequest | RegionSelectionRequest

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate an untrusted selection payload without accepting coerced IDs. */
export function parseRegionPayload(payload: unknown): SelectionRequest | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = payload as Record<string, unknown>
  if (data.kind === 'blocks') {
    const rawIds = data.ids
    if (!Array.isArray(rawIds) || !rawIds.every((id) => Number.isInteger(id))) return null
    return { kind: 'blocks', ids: rawIds as number[], additive: data.additive === true }
  }
  if (data.kind !== 'region') return null
  const coords: number[] = []
  for (const name of ['x0', 'y0', 'x1', 'y1'] as const) {
    const value = data[name]
    if (!isFiniteNumber(value)) return null
    coords.push(value)
  }
  const [x0, y0, x1, y1] = coords
  if (!(x0 >= 0 && x0 < x1 && x1 <= 1 && y0 >= 0 && y0 < y1 && y1 <= 1)) return null
  return { kind: 'region', x0, y0, x1, y1 }
}

function orderedIds(blocks: SelectableBlock[], blockIds: number[], allowImages: boolean): number[] {
  const requested = new Set(blockIds)
  return blocks
    .filter((block) => requested.has(block.id) && (allowImages || block.kind !== 'image'))
    .map((block) => block.id)
}

/** Drop stale IDs and return the remaining IDs in page reading order. */
export function normalizeSelection(blocks: SelectableBlock[], blockIds: number[]): number[] {
  return orderedIds(blocks, blockIds, true)
}

/** Apply desktop click-selection conventions to one page of blocks. */
export function clickSelection(
  blocks: SelectableBlock[],
  selectedIds: number[],
  anchorId: number,
  clickedId: number,
  opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): SelectionResult {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const clicked = byId.get(clickedId)
  const current = normalizeSelection(blocks, selectedIds)
  if (!clicked) {
    return { blockIds: current, anchorId: byId.has(anchorId) ? anchorId : 0 }
  }

  const additive = !!(opts.ctrl || opts.meta)
  if (clicked.kind === 'image') {
    if (additive && current.length === 1 && current[0] === clickedId) {
      return { blockIds: [], anchorId: clickedId }
    }
    return { blockIds: [clickedId], anchorId: clickedId }
  }

  const selectableIds = blocks.filter((block) => block.kind !== 'image').map((block) => block.id)
  const currentTextIds = current.filter((id) => selectableIds.includes(id))

  let chosen: number[]
  if (opts.shift && selectableIds.includes(anchorId)) {
    const start = selectableIds.indexOf(anchorId)
    const end = selectableIds.indexOf(clickedId)
    const [low, high] = start <= end ? [start, end] : [end, start]
    const rangeIds = selectableIds.slice(low, high + 1)
    chosen = additive ? [...currentTextIds, ...rangeIds] : rangeIds
  } else if (additive) {
    chosen = currentTextIds.filter((id) => id !== clickedId)
    if (!currentTextIds.includes(clickedId)) chosen.push(clickedId)
  } else {
    chosen = [clickedId]
  }

  return { blockIds: orderedIds(blocks, chosen, false), anchorId: clickedId }
}

/** Replace or extend a selection with text/table blocks from a drag region. */
export function regionSelection(
  blocks: SelectableBlock[],
  selectedIds: number[],
  anchorId: number,
  candidateIds: number[],
  additive: boolean,
): SelectionResult {
  const current = normalizeSelection(blocks, selectedIds)
  const candidates = orderedIds(blocks, candidateIds, false)
  const validIds = new Set(blocks.map((block) => block.id))
  const validAnchor = validIds.has(anchorId) ? anchorId : 0

  if (!candidates.length) {
    return { blockIds: additive ? current : [], anchorId: additive ? validAnchor : 0 }
  }

  const currentTextIds = orderedIds(blocks, current, false)
  const chosen = additive ? [...currentTextIds, ...candidates] : candidates
  return { blockIds: orderedIds(blocks, chosen, false), anchorId: candidates[candidates.length - 1] }
}

/** Join selected extractable text in page reading order. */
export function selectionText(blocks: SelectableBlock[], blockIds: number[]): string {
  const requested = new Set(blockIds)
  return blocks
    .filter((block) => requested.has(block.id) && block.kind !== 'image' && block.text.trim())
    .map((block) => block.text.trim())
    .join('\n\n')
}
