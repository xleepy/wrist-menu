export const reachScrollSnapshot = Object.freeze({
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
  menuDefinition: Object.freeze(
    Array.from({ length: 18 }, (_, index) =>
      Object.freeze({
        type: 'action',
        id: `row-${index}`,
        label: `Row ${index}`,
      }),
    ),
  ),
})

export const ROW_SPACING = 0.0225

export function scrollSource(overrides = {}) {
  return {
    id: 'right-hand',
    kind: 'hand',
    handedness: 'right',
    positionY: 0,
    targetingPanel: true,
    ...overrides,
  }
}

export function scrollFrame(sequence, scrollSources = []) {
  return {
    sequence,
    time: sequence * 10,
    visibility: 'visible',
    viewerPosition: null,
    lifecycleRevision: 0,
    wristSources: [],
    selectionSources: [],
    scrollSources,
  }
}