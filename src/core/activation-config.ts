import type { Handedness } from './host-snapshot.js'

export type ActivationMode =
  | 'automatic'
  | 'forced-open'
  | 'forced-closed'
  | 'disabled'

export type RevealConfiguration = Readonly<{
  enterAngleDegrees: number
  exitAngleDegrees: number
  initialDwellMs: number
  reacquireDwellMs: number
  visualGraceMs: number
  transitionMs: number
}>

export type RevealConfigurationOverrides = Readonly<
  Partial<RevealConfiguration>
>

export type ControllerDeviceTarget =
  | 'quest-2'
  | 'quest-3'
  | 'quest-3s'
  | 'unknown'

export type ControllerWristPreset = 'neutral' | 'quest-2-candidate-a'

export type Vector3Tuple = readonly [number, number, number]

export type ControllerWristOffset = Readonly<{
  translationMeters: Vector3Tuple
  rotationDegrees: Vector3Tuple
}>

export type ControllerWristConfiguration = Readonly<{
  deviceTarget?: ControllerDeviceTarget
  preset?: ControllerWristPreset
  offsets?: Readonly<Partial<Record<Handedness, ControllerWristOffset>>>
}>

export const defaultRevealConfiguration: RevealConfiguration = Object.freeze({
  enterAngleDegrees: 35,
  exitAngleDegrees: 50,
  initialDwellMs: 300,
  reacquireDwellMs: 200,
  visualGraceMs: 250,
  transitionMs: 150,
})

const neutralOffset: ControllerWristOffset = Object.freeze({
  translationMeters: Object.freeze([0, 0.09, 0]) as Vector3Tuple,
  rotationDegrees: Object.freeze([0, 0, 0]) as Vector3Tuple,
})

function quest2Offset(handedness: Handedness): ControllerWristOffset {
  const sign = handedness === 'left' ? 1 : -1
  return Object.freeze({
    translationMeters: Object.freeze([0.02 * sign, 0.096, 0.008]) as Vector3Tuple,
    rotationDegrees: Object.freeze([0, 0, 8 * sign]) as Vector3Tuple,
  })
}

function finiteInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function copyVector(name: string, vector: Vector3Tuple): Vector3Tuple {
  if (!Array.isArray(vector) || vector.length !== 3) {
    throw new TypeError(`${name} must contain exactly three finite numbers`)
  }
  const [x, y, z] = vector
  if (![x, y, z].every(Number.isFinite)) {
    throw new TypeError(`${name} must contain exactly three finite numbers`)
  }
  return Object.freeze([x, y, z])
}

export function resolveRevealConfiguration(
  overrides: RevealConfigurationOverrides | undefined,
): RevealConfiguration {
  const resolved = {
    ...defaultRevealConfiguration,
    ...overrides,
  }
  finiteInRange('comfort.enterAngleDegrees', resolved.enterAngleDegrees, 0, 180)
  finiteInRange('comfort.exitAngleDegrees', resolved.exitAngleDegrees, 0, 180)
  if (resolved.exitAngleDegrees < resolved.enterAngleDegrees) {
    throw new TypeError(
      'comfort.exitAngleDegrees must be greater than or equal to enterAngleDegrees',
    )
  }
  finiteInRange('comfort.initialDwellMs', resolved.initialDwellMs, 0, 60_000)
  finiteInRange('comfort.reacquireDwellMs', resolved.reacquireDwellMs, 0, 60_000)
  finiteInRange('comfort.visualGraceMs', resolved.visualGraceMs, 0, 60_000)
  finiteInRange('comfort.transitionMs', resolved.transitionMs, 0, 60_000)
  return Object.freeze(resolved)
}

export function copyControllerWristConfiguration(
  configuration: ControllerWristConfiguration | undefined,
): ControllerWristConfiguration | undefined {
  if (configuration === undefined) return undefined
  const deviceTarget = configuration.deviceTarget ?? 'unknown'
  if (!['quest-2', 'quest-3', 'quest-3s', 'unknown'].includes(deviceTarget)) {
    throw new TypeError('controllerWrist.deviceTarget is not supported')
  }
  if (
    configuration.preset !== undefined &&
    configuration.preset !== 'neutral' &&
    configuration.preset !== 'quest-2-candidate-a'
  ) {
    throw new TypeError('controllerWrist.preset is not supported')
  }

  const offsets: Partial<Record<Handedness, ControllerWristOffset>> = {}
  for (const handedness of ['left', 'right'] as const) {
    const offset = configuration.offsets?.[handedness]
    if (offset !== undefined) {
      offsets[handedness] = Object.freeze({
        translationMeters: copyVector(
          `controllerWrist.offsets.${handedness}.translationMeters`,
          offset.translationMeters,
        ),
        rotationDegrees: copyVector(
          `controllerWrist.offsets.${handedness}.rotationDegrees`,
          offset.rotationDegrees,
        ),
      })
    }
  }

  return Object.freeze({
    deviceTarget,
    ...(configuration.preset === undefined ? {} : { preset: configuration.preset }),
    ...(Object.keys(offsets).length === 0 ? {} : { offsets: Object.freeze(offsets) }),
  })
}

export function resolveControllerWristOffset(
  configuration: ControllerWristConfiguration | undefined,
  handedness: Handedness,
): ControllerWristOffset {
  const explicit = configuration?.offsets?.[handedness]
  if (explicit !== undefined) return explicit
  if (configuration?.preset === 'quest-2-candidate-a') return quest2Offset(handedness)
  if (configuration?.preset === 'neutral') return neutralOffset
  if (configuration?.deviceTarget === 'quest-2') return quest2Offset(handedness)
  return neutralOffset
}
