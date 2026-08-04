export const controllerActionSnapshot = Object.freeze({
  activationMode: 'forced-open',
  wrist: 'left',
  menuDefinition: Object.freeze([
    Object.freeze({
      type: 'action',
      id: 'spawn-cube',
      label: 'Spawn cube',
    }),
  ]),
})

export const controllerSource = Object.freeze({
  id: 'right-controller',
  kind: 'controller',
  handedness: 'right',
})

export const targetObservation = Object.freeze({
  sourceId: controllerSource.id,
  kind: 'controller-target-ray',
  itemId: 'spawn-cube',
})

export function frameSample(sequence, selectPressed) {
  return {
    sequence,
    time: sequence * 16,
    visibility: 'visible',
    selectionSources: [{ ...controllerSource, selectPressed }],
  }
}
