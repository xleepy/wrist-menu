/** Session features a Host Application may request for Wrist Menu support. */
export const wristMenuSessionFeatures = {
  optionalFeatures: ['hand-tracking', 'local-floor'],
} as const

export type WristMenuSessionFeatures = typeof wristMenuSessionFeatures

export type Handedness = 'left' | 'right'

export type ActionItem = Readonly<{
  type: 'action'
  id: string
  label: string
}>

/**
 * Complete Host Application-owned input for the first controller tracer.
 * Later menu item families extend this portable data boundary.
 */
export type HostSnapshot = Readonly<{
  activationMode: 'forced-open'
  wrist: Handedness
  menuDefinition: readonly ActionItem[]
}>

export type ControllerSelectionSourceSample = Readonly<{
  id: string
  kind: 'controller'
  handedness: Handedness
  selectPressed: boolean
}>

/** One renderer-neutral sample of controller input for the current XR frame. */
export type FrameSample = Readonly<{
  sequence: number
  time: number
  visibility: 'visible' | 'visible-blurred' | 'hidden'
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
  if (snapshot.activationMode !== 'forced-open') {
    throw new TypeError('Host Snapshot activationMode must be "forced-open"')
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

  return Object.freeze({
    activationMode: 'forced-open' as const,
    wrist: snapshot.wrist,
    menuDefinition: Object.freeze(menuDefinition),
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

      if (pendingSnapshot !== undefined) {
        cancelOwnership('host-snapshot-changed', frameSample.time)
        snapshot = pendingSnapshot
        pendingSnapshot = undefined
        revision += 1
        targetableAfterSequence = frameSample.sequence
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

      const itemsById = new Map(snapshot.menuDefinition.map((item) => [item.id, item]))
      const observationsBySource = new Map<string, TargetObservation>()
      if (targetable) {
        for (const observation of targetObservations) {
          if (
            observation.kind === 'controller-target-ray' &&
            itemsById.has(observation.itemId) &&
            !observationsBySource.has(observation.sourceId)
          ) {
            observationsBySource.set(observation.sourceId, observation)
          }
        }
      }

      for (const source of frameSample.selectionSources) {
        if (source.kind !== 'controller') continue
        const wasPressed = previousPressed.get(source.id) ?? false
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

          if (observation?.itemId === committed.itemId) {
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
