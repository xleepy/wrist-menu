export const automaticHandSnapshot = Object.freeze({
  activationMode: 'automatic',
  wrist: 'left',
  menuDefinition: Object.freeze([
    Object.freeze({ type: 'action', id: 'spawn-cube', label: 'Spawn cube' }),
  ]),
})

export const identityPose = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  orientation: Object.freeze([0, 0, 0, 1]),
  emulatedPosition: false,
})

export function wristFrame({
  sequence,
  time,
  wrist = 'left',
  sourceId = `${wrist}-hand`,
  kind = 'hand',
  pose = identityPose,
  viewerPosition = [0, -1, 0],
  visibility = 'visible',
  lifecycleRevision = 0,
  selectionSources = [],
}) {
  return {
    sequence,
    time,
    visibility,
    viewerPosition,
    lifecycleRevision,
    wristSources:
      pose === null
        ? []
        : [
            {
              id: sourceId,
              kind,
              handedness: wrist,
              profiles: kind === 'hand' ? ['generic-hand-select'] : ['unknown'],
              pose,
            },
          ],
    selectionSources,
  }
}

