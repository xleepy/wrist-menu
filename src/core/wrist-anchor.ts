import {
  resolveControllerWristOffset,
  type ControllerWristConfiguration,
  type Vector3Tuple,
} from './activation-config.js'
import type { Handedness } from './index.js'

export type QuaternionTuple = readonly [number, number, number, number]

export type PoseSample = Readonly<{
  position: Vector3Tuple
  orientation: QuaternionTuple
  emulatedPosition: boolean
}>

export type WristSourceSample = Readonly<{
  id: string
  kind: 'hand' | 'controller'
  handedness: Handedness
  pose: PoseSample | null
}>

export type WristAnchorPose = Readonly<{
  position: Vector3Tuple
  orientation: QuaternionTuple
}>

export type ResolvedWristAnchor = Readonly<{
  sourceId: string
  kind: 'hand' | 'controller'
  handedness: Handedness
  anchorPose: WristAnchorPose
  facingAngleDegrees: number | null
  automaticEligible: boolean
}>

export function resolveWristAnchor(
  source: WristSourceSample,
  viewerPosition: Vector3Tuple | null,
  controllerWrist: ControllerWristConfiguration | undefined,
): ResolvedWristAnchor | undefined {
  if (source.pose === null) return undefined
  const pose = source.pose
  const offset =
    source.kind === 'hand'
      ? {
          translationMeters: [0, 0, 0] as const,
          rotationDegrees: [0, 0, 0] as const,
        }
      : resolveControllerWristOffset(controllerWrist, source.handedness)
  const sourceOrientation = normalizeQuaternion(pose.orientation)
  const offsetOrientation = quaternionFromEulerDegrees(offset.rotationDegrees)
  const surfaceBasis =
    source.kind === 'hand'
      ? quaternionFromEulerDegrees([90, 0, 0])
      : quaternionFromEulerDegrees([
          0,
          source.handedness === 'left' ? 90 : -90,
          0,
        ])
  const orientation = normalizeQuaternion(
    multiplyQuaternions(
      multiplyQuaternions(sourceOrientation, offsetOrientation),
      surfaceBasis,
    ),
  )
  const translated = rotateVector(sourceOrientation, offset.translationMeters)
  const position = Object.freeze([
    pose.position[0] + translated[0],
    pose.position[1] + translated[1],
    pose.position[2] + translated[2],
  ]) satisfies Vector3Tuple

  let facingAngleDegrees: number | null = null
  if (viewerPosition !== null) {
    const localPalmNormal: Vector3Tuple =
      source.kind === 'hand'
        ? [0, -1, 0]
        : source.handedness === 'left'
          ? [1, 0, 0]
          : [-1, 0, 0]
    const palmNormal = normalizeVector(rotateVector(sourceOrientation, localPalmNormal))
    const towardViewer = normalizeVector([
      viewerPosition[0] - pose.position[0],
      viewerPosition[1] - pose.position[1],
      viewerPosition[2] - pose.position[2],
    ])
    const cosine = clamp(dot(palmNormal, towardViewer), -1, 1)
    facingAngleDegrees = (Math.acos(cosine) * 180) / Math.PI
  }

  return Object.freeze({
    sourceId: source.id,
    kind: source.kind,
    handedness: source.handedness,
    anchorPose: Object.freeze({ position, orientation }),
    facingAngleDegrees,
    automaticEligible: !pose.emulatedPosition && facingAngleDegrees !== null,
  })
}

function quaternionFromEulerDegrees(vector: Vector3Tuple): QuaternionTuple {
  const x = (vector[0] * Math.PI) / 180
  const y = (vector[1] * Math.PI) / 180
  const z = (vector[2] * Math.PI) / 180
  const qx: QuaternionTuple = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)]
  const qy: QuaternionTuple = [0, Math.sin(y / 2), 0, Math.cos(y / 2)]
  const qz: QuaternionTuple = [0, 0, Math.sin(z / 2), Math.cos(z / 2)]
  return normalizeQuaternion(multiplyQuaternions(multiplyQuaternions(qx, qy), qz))
}

function multiplyQuaternions(
  left: QuaternionTuple,
  right: QuaternionTuple,
): QuaternionTuple {
  const [ax, ay, az, aw] = left
  const [bx, by, bz, bw] = right
  return Object.freeze([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ])
}

function normalizeQuaternion(quaternion: QuaternionTuple): QuaternionTuple {
  const length = Math.hypot(...quaternion)
  if (length === 0 || !Number.isFinite(length)) {
    throw new TypeError('Pose orientation must be a finite non-zero quaternion')
  }
  return Object.freeze([
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ])
}

function rotateVector(
  quaternion: QuaternionTuple,
  vector: Vector3Tuple,
): Vector3Tuple {
  const [x, y, z, w] = normalizeQuaternion(quaternion)
  const [vx, vy, vz] = vector
  const tx = 2 * (y * vz - z * vy)
  const ty = 2 * (z * vx - x * vz)
  const tz = 2 * (x * vy - y * vx)
  return Object.freeze([
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ])
}

function normalizeVector(vector: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(...vector)
  if (length === 0 || !Number.isFinite(length)) return Object.freeze([0, 0, 0])
  return Object.freeze([
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ])
}

function dot(left: Vector3Tuple, right: Vector3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
