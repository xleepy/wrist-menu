export const crossInputSnapshot = Object.freeze({
  activationMode: 'forced-open',
  wrist: 'left',
  comfort: Object.freeze({ transitionMs: 0 }),
  controllerWrist: Object.freeze({
    offsets: Object.freeze({
      left: Object.freeze({
        translationMeters: Object.freeze([0, 0, 0]),
        rotationDegrees: Object.freeze([0, 0, 0]),
      }),
    }),
  }),
  menuDefinition: Object.freeze([
    Object.freeze({ type: 'action', id: 'first', label: 'First action' }),
    Object.freeze({ type: 'action', id: 'second', label: 'Second action' }),
    Object.freeze({
      type: 'action',
      id: 'disabled',
      label: 'Unavailable action',
      disabled: true,
    }),
  ]),
})

export const controllerSelectionSource = Object.freeze({
  id: 'right-controller',
  kind: 'controller',
  handedness: 'right',
})

export const handSelectionSource = Object.freeze({
  id: 'right-hand',
  kind: 'hand',
  handedness: 'right',
})

export function controllerSample({ pressed = false, completed = false } = {}) {
  return {
    ...controllerSelectionSource,
    selectPressed: pressed,
    selectCompleted: completed,
  }
}

export function handSample(id = handSelectionSource.id) {
  return { ...handSelectionSource, id }
}

export function selectionFrame(sequence, selectionSources) {
  return {
    sequence,
    time: sequence * 10,
    visibility: 'visible',
    viewerPosition: null,
    lifecycleRevision: 0,
    wristSources: [
      {
        id: 'left-controller',
        kind: 'controller',
        handedness: 'left',
        pose: {
          position: [0, 0, 0],
          orientation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
          emulatedPosition: false,
        },
      },
    ],
    selectionSources,
  }
}

export function controllerTarget(itemId, sourceId = controllerSelectionSource.id) {
  return {
    sourceId,
    kind: 'controller-target-ray',
    itemId,
  }
}

export function handTarget(
  itemId,
  phase,
  sourceId = handSelectionSource.id,
) {
  return {
    sourceId,
    kind: 'hand-fingertip',
    itemId,
    phase,
  }
}
