export const hostControlledSnapshot = Object.freeze({
  activationMode: 'forced-open',
  wrist: 'left',
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
