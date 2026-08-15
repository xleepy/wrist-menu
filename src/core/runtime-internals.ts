import { createRevealState } from './reveal-state.js'
import { resetScrollState } from './scroll-state.js'
import {
  cancelSelectionState,
  type SelectionCancellation,
  type SelectionCancellationReason,
} from './selection-state.js'
import type { WristMenuRuntimeState } from './index.js'

export function emitRuntimeCancellation(
  state: WristMenuRuntimeState,
  cancellation: SelectionCancellation,
  time: number,
): void {
  state.onEvent({
    type: 'selection-cancellation',
    itemId: cancellation.itemId,
    sourceId: cancellation.sourceId,
    reason: cancellation.reason,
    time,
  })
}

export function cancelAllRuntimeSelection(
  state: WristMenuRuntimeState,
  reason: SelectionCancellationReason,
  time: number,
): void {
  for (const cancellation of cancelSelectionState(state.selectionState, reason)) {
    emitRuntimeCancellation(state, cancellation, time)
  }
}

/** Package-internal lifecycle reset used only by presentation replacement. */
export function resetRuntimeForPresentationReplacement(
  state: WristMenuRuntimeState,
): void {
  if (state.disposed) throw new Error('Wrist Menu Instance is disposed')
  try {
    cancelAllRuntimeSelection(state, 'lifecycle-interrupted', state.lastTime)
  } finally {
    state.revealState = createRevealState()
    state.revealWasInteractive = false
    state.lastLifecycleRevision = undefined
    state.targetableAfterSequence = undefined
    state.revision += 1
    resetScrollState(state.scrollState)
  }
}
