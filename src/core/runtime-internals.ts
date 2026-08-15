import { createRevealState } from './reveal-state.js'
import { resetScrollState } from './scroll-state.js'
import {
  cancelSelectionState,
  type SelectionCancellation,
  type SelectionCancellationReason,
} from './selection-state.js'
import type { WristMenuRuntimeState } from './index.js'
import type { PresentationModel } from './presentation-model.js'

/**
 * Advance bookkeeping while reusing the last Presentation Model only when the
 * adapter has proved that every renderer-owned Frame Sample input is unchanged
 * and Core has no time-dependent Interaction State left to advance.
 */
export function advanceSettledRuntimeFrame(
  state: WristMenuRuntimeState,
  sequence: number,
  time: number,
  lifecycleRevision: number,
): PresentationModel | undefined {
  if (
    sequence !== sequence ||
    sequence === Infinity ||
    sequence === -Infinity ||
    time !== time ||
    time === Infinity ||
    time === -Infinity
  ) {
    throw new TypeError('Frame Sample sequence and time must be finite')
  }
  const model = state.lastPresentationModel
  const reveal = state.revealState
  const revealSettled =
    (reveal.phase === 'visible' || reveal.phase === 'hidden') &&
    reveal.transitionStartedAt === null &&
    reveal.dwellStartedAt === null &&
    reveal.lossStartedAt === null &&
    !reveal.trackingLost
  const modelMatchesReveal =
    model !== undefined &&
    (reveal.phase === 'visible'
      ? model.visible && model.targetable && model.opacity === 1
      : !model.visible && !model.targetable && model.opacity === 0)
  if (
    state.disposed ||
    state.pendingSnapshot !== undefined ||
    state.lastLifecycleRevision !== lifecycleRevision ||
    !revealSettled ||
    !modelMatchesReveal ||
    state.selectionState.ownership !== undefined ||
    state.selectionState.claims.size !== 0 ||
    state.selectionState.focus?.kind === 'hand' ||
    state.scrollState.ownerSourceId !== null ||
    state.scrollState.barrierActive
  ) {
    return undefined
  }

  state.lastTime = time
  state.lastLifecycleRevision = lifecycleRevision
  state.scrollState.lastSequence = sequence
  return model
}

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
    state.lastPresentationModel = undefined
    state.revision += 1
    resetScrollState(state.scrollState)
  }
}
