import {
  anchoringSettingsEqual,
  copyHostSnapshot,
  createPresentationItems,
  findInteractiveItem,
  type Handedness,
  type HostSnapshot,
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
  createSelectionStateMachine,
  type SelectionCancellation,
  type SelectionCancellationReason,
  type SelectionSourceSample,
  type TargetObservation,
} from './selection-state.js'
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
}>

export type WristMenuRuntime = Readonly<{
  sync(nextSnapshot: HostSnapshot): void
  step(
    frameSample: FrameSample,
    targetObservations: readonly TargetObservation[],
  ): PresentationModel
  blocksSceneInput(sourceId: string): boolean
  dispose(): void
}>

export type CreateWristMenuRuntimeOptions = Readonly<{
  snapshot: HostSnapshot
  onEvent: (event: WristMenuEvent) => void
}>

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

/** Create the framework-neutral behavior runtime used by every integration. */
export function createWristMenuRuntime(
  options: CreateWristMenuRuntimeOptions,
): WristMenuRuntime {
  let snapshot = copyHostSnapshot(options.snapshot)
  let revealConfiguration = resolveRevealConfiguration(snapshot.comfort)
  let pendingSnapshot: HostSnapshot | undefined
  let disposed = false
  let revision = 1
  let targetableAfterSequence: number | undefined
  let lastTime = 0
  const revealState = createRevealState()
  let revealWasInteractive = false
  let lastReportedVisible = false
  let lastLifecycleRevision: number | undefined
  const selection = createSelectionStateMachine()

  const assertActive = () => {
    if (disposed) throw new Error('Wrist Menu Instance is disposed')
  }

  const emitCancellation = (
    cancellation: SelectionCancellation,
    time: number,
  ) => {
    options.onEvent({
      type: 'selection-cancellation',
      itemId: cancellation.itemId,
      sourceId: cancellation.sourceId,
      reason: cancellation.reason,
      time,
    })
  }

  const cancelSelection = (
    reason: SelectionCancellationReason,
    time: number,
  ) => {
    for (const cancellation of selection.cancel(reason)) {
      emitCancellation(cancellation, time)
    }
  }

  return Object.freeze({
    sync(nextSnapshot) {
      assertActive()
      pendingSnapshot = copyHostSnapshot(nextSnapshot)
    },

    step(frameSample, targetObservations) {
      assertActive()
      if (!Number.isFinite(frameSample.sequence) || !Number.isFinite(frameSample.time)) {
        throw new TypeError('Frame Sample sequence and time must be finite')
      }
      lastTime = frameSample.time

      let resetReveal = false

      if (pendingSnapshot !== undefined) {
        const snapshotToApply = pendingSnapshot
        pendingSnapshot = undefined
        const activationModeChanged =
          snapshot.activationMode !== snapshotToApply.activationMode
        resetReveal =
          !anchoringSettingsEqual(snapshot, snapshotToApply) ||
          (activationModeChanged && snapshotToApply.activationMode === 'automatic')
        snapshot = snapshotToApply
        revealConfiguration = resolveRevealConfiguration(snapshot.comfort)
        revision += 1
        targetableAfterSequence = frameSample.sequence
        cancelSelection('host-snapshot-changed', frameSample.time)
      }

      if (!Array.isArray(frameSample.wristSources)) {
        throw new TypeError('Frame Sample wristSources must be an array')
      }

      const wristSource = selectWristSource(
        frameSample.wristSources,
        snapshot.wrist,
      )
      const anchor =
        wristSource === undefined
          ? undefined
          : resolveWristAnchor(
              wristSource,
              frameSample.viewerPosition,
              snapshot.controllerWrist,
            )
      const lifecycleReset =
        revealState.initialized &&
        frameSample.lifecycleRevision !== lastLifecycleRevision
      const reveal = advanceRevealState(revealState, {
        time: frameSample.time,
        visibility: frameSample.visibility,
        activationMode: snapshot.activationMode,
        hasContent: snapshot.menuDefinition.length > 0,
        resetReason: lifecycleReset
          ? 'lifecycle-interrupted'
          : resetReveal
            ? 'host-snapshot-changed'
            : null,
        sourcePresent: wristSource !== undefined,
        anchor,
        configuration: revealConfiguration,
      })
      lastLifecycleRevision = frameSample.lifecycleRevision

      if (reveal.interactive && !revealWasInteractive) {
        targetableAfterSequence = frameSample.sequence
      }
      revealWasInteractive = reveal.interactive
      const visible = reveal.visible
      const targetable =
        reveal.interactive &&
        targetableAfterSequence !== undefined &&
        frameSample.sequence > targetableAfterSequence

      if (!targetable) {
        cancelSelection('lifecycle-interrupted', frameSample.time)
      }

      if (visible !== lastReportedVisible) {
        lastReportedVisible = visible
        options.onEvent({
          type: 'visibility-change',
          visible,
          reason: reveal.visibilityReason,
          time: frameSample.time,
        })
      }

      const disabledItemIds = new Set<string>()
      const validObservations = targetObservations.filter((observation) => {
        const located = findInteractiveItem(
          snapshot.menuDefinition,
          observation.itemId,
        )
        if (located?.item.disabled === true) {
          disabledItemIds.add(observation.itemId)
        }
        return located !== undefined
      })
      const selectionResult = selection.step({
        targetable,
        menuWrist: snapshot.wrist,
        sources: frameSample.selectionSources,
        observations: validObservations,
        disabledItemIds,
      })
      for (const transition of selectionResult.transitions) {
        if (transition.type === 'cancel') {
          emitCancellation(transition, frameSample.time)
        } else {
          options.onEvent({
            type: 'selection-intent',
            intent: selectionIntentFor(snapshot, transition.itemId),
            source: {
              id: transition.source.id,
              kind: transition.source.kind,
              handedness: transition.source.handedness,
            },
            menuWrist: snapshot.wrist,
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
        revision,
        items: createPresentationItems(snapshot.menuDefinition, (itemId) =>
          selectionResult.armedItemId === itemId
            ? 'armed'
            : selectionResult.hoveredItemIds.has(itemId)
              ? 'hovered'
              : 'idle',
        ),
      })
    },

    blocksSceneInput(sourceId) {
      assertActive()
      return selection.blocksSceneInput(sourceId)
    },

    dispose() {
      if (disposed) return
      disposed = true
      try {
        cancelSelection('disposed', lastTime)
      } finally {
        selection.clear()
      }
    },
  })
}
