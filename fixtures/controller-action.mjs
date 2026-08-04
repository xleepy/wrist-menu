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

export function frameSample(sequence, selectPressed, selectCompleted = false) {
  return {
    sequence,
    time: sequence * 16,
    visibility: 'visible',
    selectionSources: [{ ...controllerSource, selectPressed, selectCompleted }],
  }
}

export class FakeXrSession {
  constructor(inputSource) {
    this.inputSources = [inputSource]
    this.visibilityState = 'visible'
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, inputSource) {
    const event = { type, inputSource }
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
