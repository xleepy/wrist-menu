import {
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

export type ControllerSelectionSourceSample = Readonly<{
  id: string
  kind: 'controller'
  handedness: Handedness
  selectPressed: boolean
  /** True only after this physical action emitted WebXR's successful `select`. */
  selectCompleted: boolean
}>

/** One renderer-neutral sample of controller input for the current XR frame. */
export type FrameSample = Readonly<{
  sequence: number
  time: number
  visibility: 'visible' | 'visible-blurred' | 'hidden'
  selectionSources: readonly ControllerSelectionSourceSample[]
}>

/** Evidence that a controller target ray currently intersects a Menu Item. */
export type TargetObservation = Readonly<{
  sourceId: string
  kind: 'controller-target-ray'
  itemId: string
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

/** Read-only output consumed by Renderer Integrations. */
export type PresentationModel = Readonly<{
  visible: boolean
  targetable: boolean
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
  let pendingSnapshot: HostSnapshot | undefined
  let disposed = false
  let revision = 1
  let targetableAfterSequence: number | undefined
  let ownedSelection: OwnedSelection | undefined
  let lastTime = 0
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
      pendingSnapshot = copyHostSnapshot(nextSnapshot)
    },

    step(frameSample, targetObservations) {
      assertActive()
      if (!Number.isFinite(frameSample.sequence) || !Number.isFinite(frameSample.time)) {
        throw new TypeError('Frame Sample sequence and time must be finite')
      }
      lastTime = frameSample.time

      if (pendingSnapshot !== undefined) {
        const snapshotToApply = pendingSnapshot
        pendingSnapshot = undefined
        snapshot = snapshotToApply
        revision += 1
        targetableAfterSequence = frameSample.sequence
        cancelOwnership('host-snapshot-changed', frameSample.time)
      }

      if (targetableAfterSequence === undefined) {
        targetableAfterSequence = frameSample.sequence
      }

      const visible =
        frameSample.visibility === 'visible' && snapshot.menuDefinition.length > 0
      const targetable =
        visible && frameSample.sequence > targetableAfterSequence

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

      const observationsBySource = new Map<string, TargetObservation>()
      if (targetable) {
        for (const observation of targetObservations) {
          const source = selectionSourcesById.get(observation.sourceId)
          if (
            observation.kind === 'controller-target-ray' &&
            source !== undefined &&
            source.handedness !== snapshot.wrist &&
            findInteractiveItem(snapshot.menuDefinition, observation.itemId) !==
              undefined &&
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
        const observedItem =
          observation === undefined
            ? undefined
            : findInteractiveItem(snapshot.menuDefinition, observation.itemId)

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
          observation !== undefined &&
          observedItem?.item.disabled !== true
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
              intent: selectionIntentFor(snapshot, committed.itemId),
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
        revision,
        items: createPresentationItems(snapshot.menuDefinition, (itemId) =>
          ownedSelection?.itemId === itemId
            ? 'armed'
            : hoveredItemIds.has(itemId)
              ? 'hovered'
              : 'idle',
        ),
      })
    },

    blocksSceneInput(sourceId) {
      assertActive()
      return claims.has(sourceId)
    },

    dispose() {
      if (disposed) return
      disposed = true
      try {
        cancelOwnership('disposed', lastTime)
      } finally {
        claims.clear()
        previousPressed.clear()
      }
    },
  })
}
