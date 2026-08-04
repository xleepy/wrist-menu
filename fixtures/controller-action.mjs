export const controllerActionSnapshot = Object.freeze({
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
    viewerPosition: null,
    lifecycleRevision: 0,
    wristSources: [
      {
        id: 'left-controller',
        kind: 'controller',
        handedness: 'left',
        profiles: ['unknown'],
        pose: {
          position: [0, 0, 0],
          orientation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
          emulatedPosition: false,
        },
      },
    ],
    selectionSources: [{ ...controllerSource, selectPressed, selectCompleted }],
  }
}

export class FakeXrSession {
  constructor(inputSource) {
    this.inputSources = Array.isArray(inputSource) ? inputSource : [inputSource]
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

export class FakeReferenceSpace {
  constructor() {
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

  dispatchReset() {
    for (const listener of this.listeners.get('reset') ?? []) {
      listener({ type: 'reset', referenceSpace: this })
    }
  }
}
