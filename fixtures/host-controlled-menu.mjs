export const hostControlledSnapshot = Object.freeze({
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
    Object.freeze({
      type: 'action',
      id: 'reset-workshop',
      label: 'Reset workshop',
      iconKey: 'reset',
    }),
    Object.freeze({
      type: 'separator',
      id: 'scene-controls',
      label: 'Scene',
    }),
    Object.freeze({
      type: 'toggle',
      id: 'show-grid',
      label: 'Show grid',
      value: true,
    }),
    Object.freeze({
      type: 'choice-group',
      id: 'primitive-shape',
      label: 'Primitive shape',
      selectedValue: 'cube',
      options: Object.freeze([
        Object.freeze({ id: 'shape-cube', label: 'Cube', value: 'cube' }),
        Object.freeze({ id: 'shape-sphere', label: 'Sphere', value: 'sphere' }),
      ]),
    }),
    Object.freeze({
      type: 'action',
      id: 'remove-selection',
      label: 'Remove selection',
      disabled: true,
      disabledReason: 'Select a Workshop Object first',
    }),
  ]),
})

export const rightController = Object.freeze({
  id: 'right-controller',
  kind: 'controller',
  handedness: 'right',
})

export function controlledFrame(
  sequence,
  selectPressed = false,
  selectCompleted = false,
) {
  return {
    sequence,
    time: sequence * 16,
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
    selectionSources: [
      { ...rightController, selectPressed, selectCompleted },
    ],
  }
}

export function observe(itemId) {
  return {
    sourceId: rightController.id,
    kind: 'controller-target-ray',
    itemId,
  }
}
