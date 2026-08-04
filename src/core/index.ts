import {
  anchoringSettingsEqual,
  copyHostSnapshot,
  createPresentationItems,
  findInteractiveItem,
  type Handedness,
  type HostSnapshot,
  type MenuDefinitionEntry,
  type PresentationItem,
} from './host-snapshot.js'

export type {
  ActionItem,
  ChoiceGroup,
  ChoiceOption,
  ChoiceValue,
  Handedness,
  HostSnapshot,
  MenuDefinitionEntry,
  MenuInteraction,
  MenuValue,
  PresentationActionItem,
  PresentationChoiceGroup,
  PresentationChoiceOption,
  PresentationItem,
  PresentationSeparatorItem,
  PresentationToggleItem,
  SeparatorItem,
  ToggleItem,
} from './host-snapshot.js'

/** Session features a Host Application may request for Wrist Menu support. */
export const wristMenuSessionFeatures = {
  optionalFeatures: ['hand-tracking', 'local-floor'],
} as const

export type WristMenuSessionFeatures = typeof wristMenuSessionFeatures

import {
  resolveRevealConfiguration,
  type Vector3Tuple,
} from './activation-config.js'
import {
  advanceRevealState,
  createRevealState,
  type RevealPhase,
  type VisibilityChangeReason,
} from './reveal-state.js'
import {
  advanceSelectionState,
  cancelSelectionForSource,
  cancelSelectionState,
  clearSelectionState,
  createSelectionState,
  selectionBlocksSceneInput,
  type SelectionCancellation,
  type SelectionCancellationReason,
  type SelectionSourceSample,
  type TargetObservation,
} from './selection-state.js'
import {
  advanceScrollState,
  createScrollState,
  resetScrollState,
  VISIBLE_SLOTS,
  type ScrollFrameResult,
  type ScrollSourceSample,
  type ScrollState,
} from './scroll-state.js'
import {
  resolveWristAnchor,
  selectWristSource,
  type PoseSample,
  type QuaternionTuple,
  type WristAnchorPose,
  type WristSourceSample,
} from './wrist-anchor.js'

export {
  defaultRevealConfiguration,
  resolveControllerWristOffset,
  resolveRevealConfiguration,
  type ActivationMode,
  type ControllerDeviceTarget,
  type ControllerWristConfiguration,
  type ControllerWristOffset,
  type ControllerWristPreset,
  type RevealConfiguration,
  type RevealConfigurationOverrides,
  type Vector3Tuple,
} from './activation-config.js'
export {
  resolveWristAnchor,
  type PoseSample,
  type QuaternionTuple,
  type WristAnchorPose,
  type WristSourceSample,
} from './wrist-anchor.js'
export type { RevealPhase, VisibilityChangeReason } from './reveal-state.js'
export type {
  ControllerSelectionSourceSample,
  ControllerTargetObservation,
  HandSelectionSourceSample,
  HandTargetObservation,
  SelectionCancellationReason,
  SelectionSourceSample,
  TargetObservation,
} from './selection-state.js'
export type {
  ScrollFrameResult,
  ScrollSourceSample,
} from './scroll-state.js'
export { VISIBLE_SLOTS } from './scroll-state.js'

/** One renderer-neutral sample of poses and input for the current XR frame. */
export type FrameSample = Readonly<{
  sequence: number
  time: number
  visibility: 'visible' | 'visible-blurred' | 'hidden'
  viewerPosition: Vector3Tuple | null
  wristSources: readonly WristSourceSample[]
  /** Changes after session, reference-space, recenter, or attachment resets. */
  lifecycleRevision: number
  selectionSources: readonly SelectionSourceSample[]
  scrollSources?: readonly ScrollSourceSample[]
}>

export type SelectionIntent =
  | Readonly<{
      type: 'action'
      itemId: string
    }>
  | Readonly<{
      type: 'toggle'
      itemId: string
      currentValue: boolean
      proposedValue: boolean
    }>
  | Readonly<{
      type: 'choice'
      groupId: string
      itemId: string
      currentValue: string | number
      proposedValue: string | number
    }>

export type WristMenuEvent =
  | Readonly<{
      type: 'selection-intent'
      intent: SelectionIntent
      source: Readonly<{
        id: string
        kind: 'hand' | 'controller'
        handedness: Handedness
      }>
      menuWrist: Handedness
      time: number
    }>
  | Readonly<{
      type: 'visibility-change'
      visible: boolean
      reason: VisibilityChangeReason
      time: number
    }>
  | Readonly<{
      type: 'selection-cancellation'
      itemId: string
      sourceId: string
      reason: SelectionCancellationReason
      time: number
    }>

/** Read-only output consumed by Renderer Integrations. */
export type PresentationModel = Readonly<{
  visible: boolean
  targetable: boolean
  opacity: number
  revealPhase: RevealPhase
  anchorPose: WristAnchorPose | null
  revision: number
  items: readonly PresentationItem[]
  scrollOffset: number
  totalRows: number
  visibleSlots: number
  scrollBarrierActive: boolean
}>

export type CreateWristMenuRuntimeOptions = Readonly<{
  snapshot: HostSnapshot
  onEvent: (event: WristMenuEvent) => void
}>

export type WristMenuRuntimeState = {
  onEvent: (event: WristMenuEvent) => void
  snapshot: HostSnapshot
  revealConfiguration: ReturnType<typeof resolveRevealConfiguration>
  pendingSnapshot: HostSnapshot | undefined
  disposed: boolean
  revision: number
  targetableAfterSequence: number | undefined
  lastTime: number
  revealState: ReturnType<typeof createRevealState>
  revealWasInteractive: boolean
  lastReportedVisible: boolean
  lastLifecycleRevision: number | undefined
  selectionState: ReturnType<typeof createSelectionState>
  scrollState: ScrollState
}

function countMenuRows(
  menuDefinition: readonly MenuDefinitionEntry[],
): number {
  let count = 0
  for (const entry of menuDefinition) {
    if (entry.type === 'choice-group') {
      count += 1 + entry.options.length
    } else {
      count += 1
    }
  }
  return count
}

function selectionIntentFor(
  snapshot: HostSnapshot,
  itemId: string,
): SelectionIntent {
  const located = findInteractiveItem(snapshot.menuDefinition, itemId)
  if (located === undefined) {
    throw new Error(`Selection-owned Menu Item disappeared: ${itemId}`)
  }
  if (located.group !== undefined) {
    const option = located.group.options.find(({ id }) => id === itemId)
    if (option === undefined) {
      throw new Error(`Selection-owned Choice Option disappeared: ${itemId}`)
    }
    return Object.freeze({
      type: 'choice',
      groupId: located.group.id,
      itemId: option.id,
      currentValue: located.group.selectedValue,
      proposedValue: option.value,
    })
  }
  if ('type' in located.item && located.item.type === 'toggle') {
    return Object.freeze({
      type: 'toggle',
      itemId: located.item.id,
      currentValue: located.item.value,
      proposedValue: !located.item.value,
    })
  }
  if ('type' in located.item && located.item.type === 'action') {
    return Object.freeze({ type: 'action', itemId: located.item.id })
  }
  throw new Error(`Selection-owned Menu Item has no intent: ${itemId}`)
}

function emitCancellation(
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

function cancelAllSelection(
  state: WristMenuRuntimeState,
  reason: SelectionCancellationReason,
  time: number,
): void {
  for (const cancellation of cancelSelectionState(state.selectionState, reason)) {
    emitCancellation(state, cancellation, time)
  }
}

/** Create the framework-neutral behavior state used by every Renderer Integration. */
export function createWristMenuRuntimeState(
  options: CreateWristMenuRuntimeOptions,
): WristMenuRuntimeState {
  return {
    onEvent: options.onEvent,
    snapshot: copyHostSnapshot(options.snapshot),
    revealConfiguration: resolveRevealConfiguration(options.snapshot.comfort),
    pendingSnapshot: undefined,
    disposed: false,
    revision: 1,
    targetableAfterSequence: undefined,
    lastTime: 0,
    revealState: createRevealState(),
    revealWasInteractive: false,
    lastReportedVisible: false,
    lastLifecycleRevision: undefined,
    selectionState: createSelectionState(),
    scrollState: createScrollState(),
  }
}

function assertActive(state: WristMenuRuntimeState): void {
  if (state.disposed) throw new Error('Wrist Menu Instance is disposed')
}

export function syncWristMenuRuntime(
  state: WristMenuRuntimeState,
  nextSnapshot: HostSnapshot,
): void {
  assertActive(state)
  state.pendingSnapshot = copyHostSnapshot(nextSnapshot)
}

export function stepWristMenuRuntime(
  state: WristMenuRuntimeState,
  frameSample: FrameSample,
  targetObservations: readonly TargetObservation[],
): PresentationModel {
  assertActive(state)
  if (!Number.isFinite(frameSample.sequence) || !Number.isFinite(frameSample.time)) {
    throw new TypeError('Frame Sample sequence and time must be finite')
  }
  state.lastTime = frameSample.time

  let resetReveal = false

  if (state.pendingSnapshot !== undefined) {
    const snapshotToApply = state.pendingSnapshot
    state.pendingSnapshot = undefined
    const activationModeChanged =
      state.snapshot.activationMode !== snapshotToApply.activationMode
    resetReveal =
      !anchoringSettingsEqual(state.snapshot, snapshotToApply) ||
      (activationModeChanged && snapshotToApply.activationMode === 'automatic')
    state.snapshot = snapshotToApply
    state.revealConfiguration = resolveRevealConfiguration(state.snapshot.comfort)
    state.revision += 1
    state.targetableAfterSequence = frameSample.sequence
    cancelAllSelection(state, 'host-snapshot-changed', frameSample.time)
    resetScrollState(state.scrollState)
  }

  if (!Array.isArray(frameSample.wristSources)) {
    throw new TypeError('Frame Sample wristSources must be an array')
  }

  const wristSource = selectWristSource(
    frameSample.wristSources,
    state.snapshot.wrist,
  )
  const anchor =
    wristSource === undefined
      ? undefined
      : resolveWristAnchor(
          wristSource,
          frameSample.viewerPosition,
          state.snapshot.controllerWrist,
        )
  const lifecycleReset =
    state.revealState.initialized &&
    frameSample.lifecycleRevision !== state.lastLifecycleRevision
  const reveal = advanceRevealState(state.revealState, {
    time: frameSample.time,
    visibility: frameSample.visibility,
    activationMode: state.snapshot.activationMode,
    hasContent: state.snapshot.menuDefinition.length > 0,
    resetReason: lifecycleReset
      ? 'lifecycle-interrupted'
      : resetReveal
        ? 'host-snapshot-changed'
        : null,
    sourcePresent: wristSource !== undefined,
    anchor,
    configuration: state.revealConfiguration,
  })
  state.lastLifecycleRevision = frameSample.lifecycleRevision

  if (reveal.interactive && !state.revealWasInteractive) {
    state.targetableAfterSequence = frameSample.sequence
  }
  state.revealWasInteractive = reveal.interactive
  const visible = reveal.visible
  const targetable =
    reveal.interactive &&
    state.targetableAfterSequence !== undefined &&
    frameSample.sequence > state.targetableAfterSequence

  if (!targetable) {
    cancelAllSelection(state, 'lifecycle-interrupted', frameSample.time)
  }

  if (visible !== state.lastReportedVisible) {
    state.lastReportedVisible = visible
    state.onEvent({
      type: 'visibility-change',
      visible,
      reason: reveal.visibilityReason,
      time: frameSample.time,
    })
  }

  const disabledItemIds = new Set<string>()
  const validObservations = targetObservations.filter((observation) => {
    const located = findInteractiveItem(
      state.snapshot.menuDefinition,
      observation.itemId,
    )
    if (located?.item.disabled === true) {
      disabledItemIds.add(observation.itemId)
    }
    return located !== undefined
  })

  const totalRows = countMenuRows(state.snapshot.menuDefinition)
  const scrollSources = frameSample.scrollSources ?? []
  const scrollResult = advanceScrollState(
    state.scrollState,
    frameSample.sequence,
    totalRows,
    scrollSources,
  )

  if (scrollResult.scrollingSourceIds.size > 0) {
    for (const sourceId of scrollResult.scrollingSourceIds) {
      for (const cancellation of cancelSelectionForSource(
        state.selectionState,
        sourceId,
        'lifecycle-interrupted',
      )) {
        emitCancellation(state, cancellation, frameSample.time)
      }
    }
  }

  const selectionResult = advanceSelectionState(state.selectionState, {
    targetable,
    menuWrist: state.snapshot.wrist,
    sources: frameSample.selectionSources,
    observations: validObservations,
    disabledItemIds,
  })
  for (const transition of selectionResult.transitions) {
    if (transition.type === 'cancel') {
      emitCancellation(state, transition, frameSample.time)
    } else {
      state.onEvent({
        type: 'selection-intent',
        intent: selectionIntentFor(state.snapshot, transition.itemId),
        source: {
          id: transition.source.id,
          kind: transition.source.kind,
          handedness: transition.source.handedness,
        },
        menuWrist: state.snapshot.wrist,
        time: frameSample.time,
      })
    }
  }

  return Object.freeze({
    visible,
    targetable,
    opacity: reveal.opacity,
    revealPhase: reveal.phase,
    anchorPose: reveal.anchorPose,
    revision: state.revision,
    items: createPresentationItems(state.snapshot.menuDefinition, (itemId) =>
      selectionResult.armedItemId === itemId
        ? 'armed'
        : selectionResult.hoveredItemIds.has(itemId)
          ? 'hovered'
          : 'idle',
    ),
    scrollOffset: scrollResult.offset,
    totalRows: scrollResult.totalRows,
    visibleSlots: scrollResult.visibleSlots,
    scrollBarrierActive: scrollResult.barrierActive,
  })
}

export function wristMenuRuntimeBlocksSceneInput(
  state: WristMenuRuntimeState,
  sourceId: string,
): boolean {
  assertActive(state)
  return selectionBlocksSceneInput(state.selectionState, sourceId)
}

export function disposeWristMenuRuntime(
  state: WristMenuRuntimeState,
): void {
  if (state.disposed) return
  state.disposed = true
  try {
    cancelAllSelection(state, 'disposed', state.lastTime)
  } finally {
    clearSelectionState(state.selectionState)
    resetScrollState(state.scrollState)
  }
}
