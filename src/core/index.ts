/** Session features a Host Application may request for Wrist Menu support. */
export const wristMenuSessionFeatures = {
  optionalFeatures: ['hand-tracking', 'local-floor'],
} as const

export type WristMenuSessionFeatures = typeof wristMenuSessionFeatures

export type Handedness = 'left' | 'right'

import {
  copyControllerWristConfiguration,
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
import {
  advanceRevealState,
  createRevealState,
  type RevealPhase,
} from './reveal-state.js'
import {
  resolveWristAnchor,
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
export type { RevealPhase } from './reveal-state.js'

export type ActionItem = Readonly<{
  type: 'action'
  id: string
  label: string
}>

/**
 * Complete Host Application-owned input. Comfort values and controller
 * geometry are portable overrides; omitted values resolve to documented
 * package defaults.
 */
export type HostSnapshot = Readonly<{
  activationMode: ActivationMode
  wrist: Handedness
  menuDefinition: readonly ActionItem[]
  comfort?: RevealConfigurationOverrides
  controllerWrist?: ControllerWristConfiguration
}>

export type ControllerSelectionSourceSample = Readonly<{
  id: string
  kind: 'controller'
  handedness: Handedness
  selectPressed: boolean
  /** True only after this physical action emitted WebXR's successful `select`. */
  selectCompleted: boolean
}>

/** One renderer-neutral sample of poses and input for the current XR frame. */
export type FrameSample = Readonly<{
  sequence: number
  time: number
  visibility: 'visible' | 'visible-blurred' | 'hidden'
  viewerPosition: Vector3Tuple | null
  wristSources: readonly WristSourceSample[]
  /** Changes after session, reference-space, recenter, or attachment resets. */
  lifecycleRevision: number
  selectionSources: readonly ControllerSelectionSourceSample[]
}>

/** Evidence that a controller target ray currently intersects an Action Item. */
export type TargetObservation = Readonly<{
  sourceId: string
  kind: 'controller-target-ray'
  itemId: string
}>

export type SelectionIntent = Readonly<{
  type: 'action'
  itemId: string
}>

export type WristMenuEvent =
  | Readonly<{
      type: 'selection-intent'
      intent: SelectionIntent
      source: Readonly<{
        kind: 'controller'
        handedness: Handedness
      }>
      menuWrist: Handedness
      time: number
    }>
  | Readonly<{
      type: 'selection-cancellation'
      itemId: string
      sourceId: string
      reason:
        | 'released-away'
        | 'action-cancelled'
        | 'target-changed'
        | 'host-snapshot-changed'
        | 'lifecycle-interrupted'
        | 'disposed'
      time: number
    }>

export type PresentationItem = Readonly<{
  type: 'action'
  id: string
  label: string
  interaction: 'idle' | 'hovered' | 'armed'
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

type OwnedSelection = Readonly<{
  sourceId: string
  itemId: string
}>

function copySnapshot(snapshot: HostSnapshot): HostSnapshot {
  if (
    snapshot.activationMode !== 'automatic' &&
    snapshot.activationMode !== 'forced-open' &&
    snapshot.activationMode !== 'forced-closed' &&
    snapshot.activationMode !== 'disabled'
  ) {
    throw new TypeError('Host Snapshot activationMode is not supported')
  }
  if (snapshot.wrist !== 'left' && snapshot.wrist !== 'right') {
    throw new TypeError('Host Snapshot wrist must be "left" or "right"')
  }
  if (!Array.isArray(snapshot.menuDefinition)) {
    throw new TypeError('Host Snapshot menuDefinition must be an array')
  }

  const ids = new Set<string>()
  const menuDefinition = snapshot.menuDefinition.map((item) => {
    if (item.type !== 'action') {
      throw new TypeError('The controller tracer supports only Action Items')
    }
    if (item.id.trim() === '' || item.label.trim() === '') {
      throw new TypeError('Action Items require non-empty ids and labels')
    }
    if (ids.has(item.id)) {
      throw new TypeError(`Action Item id must be unique: ${item.id}`)
    }
    ids.add(item.id)
    return Object.freeze({ type: 'action' as const, id: item.id, label: item.label })
  })

  const controllerWrist = copyControllerWristConfiguration(
    snapshot.controllerWrist,
  )
  return Object.freeze({
    activationMode: snapshot.activationMode,
    wrist: snapshot.wrist,
    menuDefinition: Object.freeze(menuDefinition),
    ...(snapshot.comfort === undefined
      ? {}
      : { comfort: resolveRevealConfiguration(snapshot.comfort) }),
    ...(controllerWrist === undefined ? {} : { controllerWrist }),
  })
}

function activationSettingsKey(snapshot: HostSnapshot): string {
  return JSON.stringify({
    activationMode: snapshot.activationMode,
    wrist: snapshot.wrist,
    comfort: snapshot.comfort ?? null,
    controllerWrist: snapshot.controllerWrist ?? null,
  })
}

/** Create the framework-neutral behavior runtime used by every integration. */
export function createWristMenuRuntime(
  options: CreateWristMenuRuntimeOptions,
): WristMenuRuntime {
  let snapshot = copySnapshot(options.snapshot)
  let pendingSnapshot: HostSnapshot | undefined
  let disposed = false
  let revision = 1
  let targetableAfterSequence: number | undefined
  let ownedSelection: OwnedSelection | undefined
  let lastTime = 0
  const revealState = createRevealState()
  let revealWasInteractive = false
  let lastLifecycleRevision: number | undefined
  const previousPressed = new Map<string, boolean>()
  const claims = new Set<string>()

  const assertActive = () => {
    if (disposed) throw new Error('Wrist Menu Instance is disposed')
  }

  const cancelOwnership = (
    reason: Extract<WristMenuEvent, { type: 'selection-cancellation' }>['reason'],
    time: number,
  ) => {
    if (ownedSelection === undefined) return
    const cancelled = ownedSelection
    ownedSelection = undefined
    claims.delete(cancelled.sourceId)
    options.onEvent({
      type: 'selection-cancellation',
      itemId: cancelled.itemId,
      sourceId: cancelled.sourceId,
      reason,
      time,
    })
  }

  return Object.freeze({
    sync(nextSnapshot) {
      assertActive()
      pendingSnapshot = copySnapshot(nextSnapshot)
    },

    step(frameSample, targetObservations) {
      assertActive()
      if (!Number.isFinite(frameSample.sequence) || !Number.isFinite(frameSample.time)) {
        throw new TypeError('Frame Sample sequence and time must be finite')
      }
      lastTime = frameSample.time

      let resetReveal = false

      if (pendingSnapshot !== undefined) {
        cancelOwnership('host-snapshot-changed', frameSample.time)
        resetReveal =
          activationSettingsKey(snapshot) !== activationSettingsKey(pendingSnapshot)
        snapshot = pendingSnapshot
        pendingSnapshot = undefined
        revision += 1
        targetableAfterSequence = frameSample.sequence
      }

      if (!Array.isArray(frameSample.wristSources)) {
        throw new TypeError('Frame Sample wristSources must be an array')
      }

      const wristSource = frameSample.wristSources
        .filter((source) => source.handedness === snapshot.wrist)
        .sort((left, right) => Number(left.kind === 'controller') - Number(right.kind === 'controller'))[0]
      const anchor =
        wristSource === undefined
          ? undefined
          : resolveWristAnchor(
              wristSource,
              frameSample.viewerPosition,
              snapshot.controllerWrist,
            )
      const reveal = advanceRevealState(revealState, {
        time: frameSample.time,
        visibility: frameSample.visibility,
        activationMode: snapshot.activationMode,
        hasContent: snapshot.menuDefinition.length > 0,
        reset:
          resetReveal ||
          (revealState.initialized &&
            frameSample.lifecycleRevision !== lastLifecycleRevision),
        sourcePresent: wristSource !== undefined,
        anchor,
        configuration: resolveRevealConfiguration(snapshot.comfort),
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
        if (ownedSelection !== undefined) {
          cancelOwnership('lifecycle-interrupted', frameSample.time)
        }
        claims.clear()
      }

      const selectionSourcesById = new Map(
        frameSample.selectionSources
          .filter((source) => source.kind === 'controller')
          .map((source) => [source.id, source]),
      )
      if (
        ownedSelection !== undefined &&
        !selectionSourcesById.has(ownedSelection.sourceId)
      ) {
        cancelOwnership('lifecycle-interrupted', frameSample.time)
      }

      const itemsById = new Map(snapshot.menuDefinition.map((item) => [item.id, item]))
      const observationsBySource = new Map<string, TargetObservation>()
      if (targetable) {
        for (const observation of targetObservations) {
          const source = selectionSourcesById.get(observation.sourceId)
          if (
            observation.kind === 'controller-target-ray' &&
            source !== undefined &&
            source.handedness !== snapshot.wrist &&
            itemsById.has(observation.itemId) &&
            !observationsBySource.has(observation.sourceId)
          ) {
            observationsBySource.set(observation.sourceId, observation)
          }
        }
      }

      for (const source of frameSample.selectionSources) {
        if (source.kind !== 'controller') continue
        const wasPressed = previousPressed.get(source.id) ?? source.selectPressed
        const observation = observationsBySource.get(source.id)
        const eligible = source.handedness !== snapshot.wrist

        if (
          ownedSelection?.sourceId === source.id &&
          observation !== undefined &&
          observation.itemId !== ownedSelection.itemId
        ) {
          cancelOwnership('target-changed', frameSample.time)
        }

        if (
          !wasPressed &&
          source.selectPressed &&
          eligible &&
          ownedSelection === undefined &&
          observation !== undefined
        ) {
          ownedSelection = Object.freeze({
            sourceId: source.id,
            itemId: observation.itemId,
          })
          claims.add(source.id)
        }

        if (wasPressed && !source.selectPressed && ownedSelection?.sourceId === source.id) {
          const committed = ownedSelection
          ownedSelection = undefined
          claims.delete(source.id)

          if (!source.selectCompleted) {
            options.onEvent({
              type: 'selection-cancellation',
              itemId: committed.itemId,
              sourceId: committed.sourceId,
              reason: 'action-cancelled',
              time: frameSample.time,
            })
          } else if (observation?.itemId === committed.itemId) {
            options.onEvent({
              type: 'selection-intent',
              intent: { type: 'action', itemId: committed.itemId },
              source: { kind: 'controller', handedness: source.handedness },
              menuWrist: snapshot.wrist,
              time: frameSample.time,
            })
          } else {
            options.onEvent({
              type: 'selection-cancellation',
              itemId: committed.itemId,
              sourceId: committed.sourceId,
              reason: 'released-away',
              time: frameSample.time,
            })
          }
        }

        previousPressed.set(source.id, source.selectPressed)
      }

      const hoveredItemIds = new Set(
        [...observationsBySource.values()].map(({ itemId }) => itemId),
      )
      return Object.freeze({
        visible,
        targetable,
        opacity: reveal.opacity,
        revealPhase: reveal.phase,
        anchorPose: reveal.anchorPose,
        revision,
        items: Object.freeze(
          snapshot.menuDefinition.map((item) =>
            Object.freeze({
              ...item,
              interaction:
                ownedSelection?.itemId === item.id
                  ? ('armed' as const)
                  : hoveredItemIds.has(item.id)
                    ? ('hovered' as const)
                    : ('idle' as const),
            }),
          ),
        ),
      })
    },

    blocksSceneInput(sourceId) {
      assertActive()
      return claims.has(sourceId)
    },

    dispose() {
      if (disposed) return
      cancelOwnership('disposed', lastTime)
      disposed = true
      claims.clear()
      previousPressed.clear()
    },
  })
}
