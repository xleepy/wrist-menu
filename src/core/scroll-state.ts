import type { Handedness } from './host-snapshot.js'

export type ScrollSourceSample = Readonly<{
  id: string
  kind: 'hand' | 'controller'
  handedness: Handedness
  positionY: number
  targetingPanel: boolean
}>

export type ScrollState = {
  offset: number
  ownerSourceId: string | null
  ownerKind: 'hand' | 'controller' | null
  ownerStartY: number
  ownerStartOffset: number
  barrierActive: boolean
  lastSequence: number
}

export type ScrollFrameResult = Readonly<{
  offset: number
  totalRows: number
  visibleSlots: number
  barrierActive: boolean
  scrollOwned: boolean
  scrollingSourceIds: ReadonlySet<string>
}>

export function createScrollState(): ScrollState {
  return {
    offset: 0,
    ownerSourceId: null,
    ownerKind: null,
    ownerStartY: 0,
    ownerStartOffset: 0,
    barrierActive: false,
    lastSequence: 0,
  }
}

const VISIBLE_SLOTS = 12
const HAND_THRESHOLD = 0.009
const CONTROLLER_THRESHOLD = 0.013

function maxOffset(totalRows: number): number {
  return Math.max(0, totalRows - VISIBLE_SLOTS)
}

function clampOffset(offset: number, totalRows: number): number {
  return Math.min(maxOffset(totalRows), Math.max(0, offset))
}

export function advanceScrollState(
  state: ScrollState,
  sequence: number,
  totalRows: number,
  sources: readonly ScrollSourceSample[],
): ScrollFrameResult {
  const scrollingSourceIds = new Set<string>()

  if (state.barrierActive && state.lastSequence !== sequence) {
    state.barrierActive = false
  }

  if (state.ownerSourceId !== null) {
    const owner = sources.find((s) => s.id === state.ownerSourceId)
    if (owner === undefined) {
      state.ownerSourceId = null
      state.ownerKind = null
    } else {
      const threshold =
        state.ownerKind === 'hand' ? HAND_THRESHOLD : CONTROLLER_THRESHOLD
      const deltaY = state.ownerStartY - owner.positionY
      const rawOffset = state.ownerStartOffset + deltaY / 0.0225
      state.offset = clampOffset(rawOffset, totalRows)
      scrollingSourceIds.add(owner.id)
    }
  }

  if (state.ownerSourceId === null) {
    for (const source of sources) {
      if (!source.targetingPanel) continue
      if (scrollingSourceIds.has(source.id)) continue
      const threshold =
        source.kind === 'hand' ? HAND_THRESHOLD : CONTROLLER_THRESHOLD
      state.ownerSourceId = source.id
      state.ownerKind = source.kind
      state.ownerStartY = source.positionY
      state.ownerStartOffset = state.offset
      scrollingSourceIds.add(source.id)
      break
    }
  }

  state.offset = clampOffset(state.offset, totalRows)
  state.lastSequence = sequence

  return Object.freeze({
    offset: state.offset,
    totalRows,
    visibleSlots: VISIBLE_SLOTS,
    barrierActive: state.barrierActive,
    scrollOwned: state.ownerSourceId !== null,
    scrollingSourceIds,
  })
}

export function releaseScrollOwnership(
  state: ScrollState,
  sourceId: string,
): void {
  if (state.ownerSourceId === sourceId) {
    state.ownerSourceId = null
    state.ownerKind = null
    state.barrierActive = true
  }
}

export function resetScrollState(state: ScrollState): void {
  state.offset = 0
  state.ownerSourceId = null
  state.ownerKind = null
  state.ownerStartY = 0
  state.ownerStartOffset = 0
  state.barrierActive = false
}

export function setScrollBarrier(state: ScrollState): void {
  state.barrierActive = true
}

export { VISIBLE_SLOTS }
