import type { Handedness } from './host-snapshot.js'

export type ControllerSelectionSourceSample = Readonly<{
  id: string
  kind: 'controller'
  handedness: Handedness
  selectPressed: boolean
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

export type SelectionState = {
  sourceStates: Map<string, SourceState>
  claims: Set<string>
  focus: FocusedSelection | undefined
  ownership: OwnedSelection | undefined
}

export type SelectionFrameResult = Readonly<{
  transitions: readonly SelectionTransition[]
  hoveredItemIds: ReadonlySet<string>
  armedItemId: string | undefined
}>

export type SelectionStepInput = Readonly<{
  targetable: boolean
  menuWrist: Handedness
  sources: readonly SelectionSourceSample[]
  observations: readonly TargetObservation[]
  disabledItemIds: ReadonlySet<string>
}>

export function createSelectionState(): SelectionState {
  return {
    sourceStates: new Map(),
    claims: new Set(),
    focus: undefined,
    ownership: undefined,
  }
}

function cancelFocus(
  state: SelectionState,
  reason: SelectionCancellationReason,
  transitions: SelectionTransition[],
  neutral: boolean,
): void {
  if (state.focus?.kind !== 'hand') return
  const cancelled = state.focus
  state.focus = undefined
  const sourceState = state.sourceStates.get(cancelled.sourceId)
  if (sourceState !== undefined) sourceState.neutral = neutral
  transitions.push({
    type: 'cancel',
    itemId: cancelled.itemId,
    sourceId: cancelled.sourceId,
    reason,
  })
}

function cancelOwnership(
  state: SelectionState,
  reason: SelectionCancellationReason,
  transitions: SelectionTransition[],
  neutral: boolean,
): void {
  if (state.ownership === undefined) return
  const cancelled = state.ownership
  state.ownership = undefined
  if (state.focus?.sourceId === cancelled.sourceId) state.focus = undefined
  const sourceState = state.sourceStates.get(cancelled.sourceId)
  if (sourceState !== undefined) sourceState.neutral = neutral
  transitions.push({
    type: 'cancel',
    itemId: cancelled.itemId,
    sourceId: cancelled.sourceId,
    reason,
  })
}

export function advanceSelectionState(
  state: SelectionState,
  input: SelectionStepInput,
): SelectionFrameResult {
  const transitions: SelectionTransition[] = []
  const sourceById = new Map(
    input.sources
      .filter(({ handedness }) => handedness !== input.menuWrist)
      .map((source) => [source.id, source]),
  )
  const observationBySource = new Map<string, TargetObservation>()
  for (const observation of input.observations) {
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

  for (const sourceId of [...state.sourceStates.keys()]) {
    if (sourceById.has(sourceId)) continue
    if (state.ownership?.sourceId === sourceId) {
      cancelOwnership(state, 'lifecycle-interrupted', transitions, false)
    } else if (state.focus?.sourceId === sourceId) {
      cancelFocus(state, 'lifecycle-interrupted', transitions, false)
      state.focus = undefined
    }
    state.claims.delete(sourceId)
    state.sourceStates.delete(sourceId)
  }

  for (const source of sourceById.values()) {
    const observation = observationBySource.get(source.id)
    if (!state.sourceStates.has(source.id)) {
      state.sourceStates.set(source.id, {
        neutral:
          source.kind === 'controller'
            ? !source.selectPressed
            : observation === undefined,
        wasPressed:
          source.kind === 'controller' ? source.selectPressed : false,
      })
    }
  }

  if (!input.targetable) {
    cancelOwnership(state, 'lifecycle-interrupted', transitions, false)
    cancelFocus(state, 'lifecycle-interrupted', transitions, false)
    state.focus = undefined
    state.claims.clear()
    return Object.freeze({
      transitions: Object.freeze(transitions),
      hoveredItemIds: new Set<string>(),
      armedItemId: undefined,
    })
  }

  if (state.ownership !== undefined) {
    const source = sourceById.get(state.ownership.sourceId)
    const observation = observationBySource.get(state.ownership.sourceId)
    if (source?.kind === 'controller') {
      if (source.selectPressed && observation?.itemId !== state.ownership.itemId) {
        cancelOwnership(
          state,
          observation === undefined ? 'released-away' : 'target-changed',
          transitions,
          false,
        )
      }
    }
  }

  if (state.focus !== undefined) {
    const observation = observationBySource.get(state.focus.sourceId)
    if (observation?.itemId !== state.focus.itemId) {
      if (state.focus.kind === 'hand') {
        cancelFocus(
          state,
          observation === undefined ? 'released-away' : 'target-changed',
          transitions,
          observation === undefined,
        )
      } else {
        state.focus = undefined
      }
    }
  }

  for (const source of sourceById.values()) {
    const sourceState = state.sourceStates.get(source.id)!
    const observation = observationBySource.get(source.id)

    if (source.kind === 'controller') {
      const pressed = source.selectPressed
      if (!pressed) {
        sourceState.neutral = true
        state.claims.delete(source.id)
      }

      if (
        state.focus === undefined &&
        sourceState.neutral &&
        observation !== undefined &&
        !input.disabledItemIds.has(observation.itemId)
      ) {
        state.focus = {
          sourceId: source.id,
          itemId: observation.itemId,
          kind: 'controller',
        }
      }

      if (
        !sourceState.wasPressed &&
        pressed &&
        sourceState.neutral &&
        state.ownership === undefined &&
        state.focus?.sourceId === source.id &&
        state.focus.itemId === observation?.itemId &&
        !input.disabledItemIds.has(state.focus.itemId)
      ) {
        state.ownership = { sourceId: source.id, itemId: state.focus.itemId }
        sourceState.neutral = false
        state.claims.add(source.id)
      }

      if (
        sourceState.wasPressed &&
        !pressed &&
        state.ownership?.sourceId === source.id
      ) {
        const completed = state.ownership
        state.ownership = undefined
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
      sourceState.wasPressed = pressed
      continue
    }

    if (observation === undefined) {
      sourceState.neutral = true
      state.claims.delete(source.id)
      continue
    }
    if (
      state.focus === undefined &&
      sourceState.neutral &&
      !input.disabledItemIds.has(observation.itemId)
    ) {
      state.focus = {
        sourceId: source.id,
        itemId: observation.itemId,
        kind: 'hand',
      }
      state.claims.add(source.id)
    }
    if (
      state.focus?.sourceId === source.id &&
      state.focus.itemId === observation.itemId &&
      observation.kind === 'hand-fingertip' &&
      observation.phase === 'pressed'
    ) {
      const committed = state.focus
      state.focus = undefined
      sourceState.neutral = false
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
    armedItemId: state.ownership?.itemId,
  })
}

export function cancelSelectionState(
  state: SelectionState,
  reason: SelectionCancellationReason,
): readonly SelectionCancellation[] {
  const transitions: SelectionTransition[] = []
  cancelOwnership(state, reason, transitions, false)
  cancelFocus(state, reason, transitions, false)
  state.focus = undefined
  state.claims.clear()
  return Object.freeze(transitions) as readonly SelectionCancellation[]
}

export function cancelSelectionForSource(
  state: SelectionState,
  sourceId: string,
  reason: SelectionCancellationReason,
): readonly SelectionCancellation[] {
  const transitions: SelectionTransition[] = []
  if (state.ownership?.sourceId === sourceId) {
    cancelOwnership(state, reason, transitions, false)
  }
  if (state.focus?.sourceId === sourceId) {
    cancelFocus(state, reason, transitions, false)
    state.focus = undefined
  }
  state.claims.delete(sourceId)
  return Object.freeze(transitions) as readonly SelectionCancellation[]
}

export function selectionBlocksSceneInput(
  state: SelectionState,
  sourceId: string,
): boolean {
  return state.claims.has(sourceId)
}

export function clearSelectionState(state: SelectionState): void {
  state.focus = undefined
  state.ownership = undefined
  state.claims.clear()
  state.sourceStates.clear()
}
