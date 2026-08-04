import type { Handedness } from './host-snapshot.js'

export type ControllerSelectionSourceSample = Readonly<{
  id: string
  kind: 'controller'
  handedness: Handedness
  selectPressed: boolean
  /** True only after this physical action emitted WebXR's successful `select`. */
  selectCompleted: boolean
}>

export type HandSelectionSourceSample = Readonly<{
  id: string
  kind: 'hand'
  handedness: Handedness
}>

export type SelectionSourceSample =
  | ControllerSelectionSourceSample
  | HandSelectionSourceSample

export type ControllerTargetObservation = Readonly<{
  sourceId: string
  kind: 'controller-target-ray'
  itemId: string
}>

export type HandTargetObservation = Readonly<{
  sourceId: string
  kind: 'hand-fingertip'
  itemId: string
  /** `pressed` means the fingertip sphere reached or crossed the press plane. */
  phase: 'hover' | 'pressed'
}>

export type TargetObservation =
  | ControllerTargetObservation
  | HandTargetObservation

export type SelectionCancellationReason =
  | 'released-away'
  | 'action-cancelled'
  | 'target-changed'
  | 'host-snapshot-changed'
  | 'lifecycle-interrupted'
  | 'disposed'

export type SelectionCommit = Readonly<{
  type: 'commit'
  itemId: string
  source: SelectionSourceSample
}>

export type SelectionCancellation = Readonly<{
  type: 'cancel'
  itemId: string
  sourceId: string
  reason: SelectionCancellationReason
}>

export type SelectionTransition = SelectionCommit | SelectionCancellation

type SourceState = {
  neutral: boolean
  wasPressed: boolean
}

type FocusedSelection = Readonly<{
  sourceId: string
  itemId: string
  kind: SelectionSourceSample['kind']
}>

type OwnedSelection = Readonly<{
  sourceId: string
  itemId: string
}>

export type SelectionFrameResult = Readonly<{
  transitions: readonly SelectionTransition[]
  hoveredItemIds: ReadonlySet<string>
  armedItemId: string | undefined
}>

export type SelectionStateMachine = Readonly<{
  step(options: Readonly<{
    targetable: boolean
    menuWrist: Handedness
    sources: readonly SelectionSourceSample[]
    observations: readonly TargetObservation[]
    disabledItemIds: ReadonlySet<string>
  }>): SelectionFrameResult
  cancel(reason: SelectionCancellationReason): readonly SelectionCancellation[]
  cancelForSource(sourceId: string, reason: SelectionCancellationReason): readonly SelectionCancellation[]
  blocksSceneInput(sourceId: string): boolean
  clear(): void
}>

/**
 * Renderer-neutral Selection State Machine shared by hand and controller
 * adapters. It deliberately knows nothing about rays, joints, or haptics.
 */
export function createSelectionStateMachine(): SelectionStateMachine {
  const sourceStates = new Map<string, SourceState>()
  const claims = new Set<string>()
  let focus: FocusedSelection | undefined
  let ownership: OwnedSelection | undefined

  const cancelFocus = (
    reason: SelectionCancellationReason,
    transitions: SelectionTransition[],
    neutral: boolean,
  ) => {
    if (focus?.kind !== 'hand') return
    const cancelled = focus
    focus = undefined
    const state = sourceStates.get(cancelled.sourceId)
    if (state !== undefined) state.neutral = neutral
    transitions.push({
      type: 'cancel',
      itemId: cancelled.itemId,
      sourceId: cancelled.sourceId,
      reason,
    })
  }

  const cancelOwnership = (
    reason: SelectionCancellationReason,
    transitions: SelectionTransition[],
    neutral: boolean,
  ) => {
    if (ownership === undefined) return
    const cancelled = ownership
    ownership = undefined
    if (focus?.sourceId === cancelled.sourceId) focus = undefined
    const state = sourceStates.get(cancelled.sourceId)
    if (state !== undefined) state.neutral = neutral
    transitions.push({
      type: 'cancel',
      itemId: cancelled.itemId,
      sourceId: cancelled.sourceId,
      reason,
    })
  }

  return Object.freeze({
    step({
      targetable,
      menuWrist,
      sources,
      observations,
      disabledItemIds,
    }) {
      const transitions: SelectionTransition[] = []
      const sourceById = new Map(
        sources
          .filter(({ handedness }) => handedness !== menuWrist)
          .map((source) => [source.id, source]),
      )
      const observationBySource = new Map<string, TargetObservation>()
      for (const observation of observations) {
        const source = sourceById.get(observation.sourceId)
        if (
          source !== undefined &&
          ((source.kind === 'controller' &&
            observation.kind === 'controller-target-ray') ||
            (source.kind === 'hand' &&
              observation.kind === 'hand-fingertip')) &&
          !observationBySource.has(observation.sourceId)
        ) {
          observationBySource.set(observation.sourceId, observation)
        }
      }

      for (const sourceId of [...sourceStates.keys()]) {
        if (sourceById.has(sourceId)) continue
        if (ownership?.sourceId === sourceId) {
          cancelOwnership('lifecycle-interrupted', transitions, false)
        } else if (focus?.sourceId === sourceId) {
          cancelFocus('lifecycle-interrupted', transitions, false)
          focus = undefined
        }
        claims.delete(sourceId)
        sourceStates.delete(sourceId)
      }

      for (const source of sourceById.values()) {
        const observation = observationBySource.get(source.id)
        if (!sourceStates.has(source.id)) {
          sourceStates.set(source.id, {
            neutral:
              source.kind === 'controller'
                ? !source.selectPressed
                : observation === undefined,
            wasPressed:
              source.kind === 'controller' ? source.selectPressed : false,
          })
        }
      }

      if (!targetable) {
        cancelOwnership('lifecycle-interrupted', transitions, false)
        cancelFocus('lifecycle-interrupted', transitions, false)
        focus = undefined
        claims.clear()
        return Object.freeze({
          transitions: Object.freeze(transitions),
          hoveredItemIds: new Set<string>(),
          armedItemId: undefined,
        })
      }

      if (ownership !== undefined) {
        const source = sourceById.get(ownership.sourceId)
        const observation = observationBySource.get(ownership.sourceId)
        if (source?.kind === 'controller') {
          if (source.selectPressed && observation?.itemId !== ownership.itemId) {
            cancelOwnership(
              observation === undefined ? 'released-away' : 'target-changed',
              transitions,
              false,
            )
          }
        }
      }

      if (focus !== undefined) {
        const observation = observationBySource.get(focus.sourceId)
        if (observation?.itemId !== focus.itemId) {
          if (focus.kind === 'hand') {
            cancelFocus(
              observation === undefined ? 'released-away' : 'target-changed',
              transitions,
              observation === undefined,
            )
          } else {
            focus = undefined
          }
        }
      }

      for (const source of sourceById.values()) {
        const state = sourceStates.get(source.id)!
        const observation = observationBySource.get(source.id)

        if (source.kind === 'controller') {
          const pressed = source.selectPressed
          if (!pressed) {
            state.neutral = true
            claims.delete(source.id)
          }

          if (
            focus === undefined &&
            state.neutral &&
            observation !== undefined &&
            !disabledItemIds.has(observation.itemId)
          ) {
            focus = {
              sourceId: source.id,
              itemId: observation.itemId,
              kind: 'controller',
            }
          }

          if (
            !state.wasPressed &&
            pressed &&
            state.neutral &&
            ownership === undefined &&
            focus?.sourceId === source.id &&
            focus.itemId === observation?.itemId &&
            !disabledItemIds.has(focus.itemId)
          ) {
            ownership = { sourceId: source.id, itemId: focus.itemId }
            state.neutral = false
            claims.add(source.id)
          }

          if (
            state.wasPressed &&
            !pressed &&
            ownership?.sourceId === source.id
          ) {
            const completed = ownership
            ownership = undefined
            if (source.selectCompleted && observation?.itemId === completed.itemId) {
              transitions.push({
                type: 'commit',
                itemId: completed.itemId,
                source,
              })
            } else {
              transitions.push({
                type: 'cancel',
                itemId: completed.itemId,
                sourceId: completed.sourceId,
                reason:
                  observation?.itemId === completed.itemId
                    ? 'action-cancelled'
                    : observation === undefined
                      ? 'released-away'
                      : 'target-changed',
              })
            }
          }
          state.wasPressed = pressed
          continue
        }

        if (observation === undefined) {
          state.neutral = true
          claims.delete(source.id)
          continue
        }
        if (
          focus === undefined &&
          state.neutral &&
          !disabledItemIds.has(observation.itemId)
        ) {
          focus = {
            sourceId: source.id,
            itemId: observation.itemId,
            kind: 'hand',
          }
          claims.add(source.id)
        }
        if (
          focus?.sourceId === source.id &&
          focus.itemId === observation.itemId &&
          observation.kind === 'hand-fingertip' &&
          observation.phase === 'pressed'
        ) {
          const committed = focus
          focus = undefined
          state.neutral = false
          transitions.push({
            type: 'commit',
            itemId: committed.itemId,
            source,
          })
        }
      }

      return Object.freeze({
        transitions: Object.freeze(transitions),
        hoveredItemIds: new Set(
          [...observationBySource.values()].map(({ itemId }) => itemId),
        ),
        armedItemId: ownership?.itemId,
      })
    },

    cancel(reason) {
      const transitions: SelectionTransition[] = []
      cancelOwnership(reason, transitions, false)
      cancelFocus(reason, transitions, false)
      focus = undefined
      claims.clear()
      return Object.freeze(transitions) as readonly SelectionCancellation[]
    },

    cancelForSource(sourceId, reason) {
      const transitions: SelectionTransition[] = []
      if (ownership?.sourceId === sourceId) {
        cancelOwnership(reason, transitions, false)
      }
      if (focus?.sourceId === sourceId) {
        cancelFocus(reason, transitions, false)
        focus = undefined
      }
      claims.delete(sourceId)
      return Object.freeze(transitions) as readonly SelectionCancellation[]
    },

    blocksSceneInput(sourceId) {
      return claims.has(sourceId)
    },

    clear() {
      focus = undefined
      ownership = undefined
      claims.clear()
      sourceStates.clear()
    },
  })
}
