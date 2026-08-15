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
  candidateSourceId: string | null
  candidateKind: 'hand' | 'controller' | null
  candidateStartY: number
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
    candidateSourceId: null,
    candidateKind: null,
    candidateStartY: 0,
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

function thresholdFor(kind: 'hand' | 'controller'): number {
  return kind === 'hand' ? HAND_THRESHOLD : CONTROLLER_THRESHOLD
}

function clearCandidate(state: ScrollState): void {
  state.candidateSourceId = null
  state.candidateKind = null
  state.candidateStartY = 0
}

function clearOwner(state: ScrollState): void {
  state.ownerSourceId = null
  state.ownerKind = null
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
    if (owner === undefined || !owner.targetingPanel) {
      clearOwner(state)
    } else {
      const deltaY = state.ownerStartY - owner.positionY
      const rawOffset = state.ownerStartOffset + deltaY / 0.0225
      state.offset = clampOffset(rawOffset, totalRows)
      scrollingSourceIds.add(owner.id)
    }
  }

  if (state.ownerSourceId === null && state.candidateSourceId !== null) {
    const candidate = sources.find((s) => s.id === state.candidateSourceId)
    if (
      candidate === undefined ||
      !candidate.targetingPanel ||
      candidate.kind !== state.candidateKind
    ) {
      clearCandidate(state)
    } else {
      const deltaY = state.candidateStartY - candidate.positionY
      if (Math.abs(deltaY) >= thresholdFor(candidate.kind)) {
        state.ownerSourceId = candidate.id
        state.ownerKind = candidate.kind
        state.ownerStartY = state.candidateStartY
        state.ownerStartOffset = state.offset
        clearCandidate(state)
        state.offset = clampOffset(
          state.ownerStartOffset + deltaY / 0.0225,
          totalRows,
        )
        scrollingSourceIds.add(candidate.id)
      }
    }
  }

  if (state.ownerSourceId === null && state.candidateSourceId === null) {
    for (const source of sources) {
      if (!source.targetingPanel) continue
      if (scrollingSourceIds.has(source.id)) continue
      state.candidateSourceId = source.id
      state.candidateKind = source.kind
      state.candidateStartY = source.positionY
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
    clearOwner(state)
    state.barrierActive = true
  }
  if (state.candidateSourceId === sourceId) clearCandidate(state)
}

export function resetScrollState(state: ScrollState): void {
  state.offset = 0
  state.ownerSourceId = null
  state.ownerKind = null
  state.ownerStartY = 0
  state.ownerStartOffset = 0
  clearCandidate(state)
  state.barrierActive = false
}

export function setScrollBarrier(state: ScrollState): void {
  state.barrierActive = true
}

export { VISIBLE_SLOTS }
