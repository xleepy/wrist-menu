import type { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import type { Mesh } from 'three/src/objects/Mesh.js'

export type OrientedBoxScratch = Readonly<{
  localPosition: Vector3
  worldScale: Vector3
}>

export function createOrientedBoxScratch(): OrientedBoxScratch {
  return {
    localPosition: new Vector3(),
    worldScale: new Vector3(),
  }
}

export function isOrientedBoxMesh(value: unknown): value is Mesh<BoxGeometry> {
  const candidate = value as {
    isObject3D?: unknown
    isMesh?: unknown
    geometry?: {
      type?: unknown
      parameters?: { width?: unknown; height?: unknown; depth?: unknown }
    }
  } | null
  const dimensions = candidate?.geometry?.parameters
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.isObject3D === true &&
    candidate.isMesh === true &&
    candidate.geometry?.type === 'BoxGeometry' &&
    dimensions !== undefined &&
    [dimensions.width, dimensions.height, dimensions.depth].every(
      (dimension) =>
        typeof dimension === 'number' &&
        Number.isFinite(dimension) &&
        dimension > 0,
    )
  )
}

export function observeFingertipInOrientedBox(
  object: Mesh<BoxGeometry>,
  worldPosition: Vector3,
  radius: number,
  scratch: OrientedBoxScratch,
): 'hover' | 'pressed' | undefined {
  if (!Number.isFinite(radius) || radius <= 0 || !object.visible) {
    return undefined
  }
  object.updateWorldMatrix(true, false)
  object.getWorldScale(scratch.worldScale)
  if (
    scratch.worldScale.x === 0 ||
    scratch.worldScale.y === 0 ||
    scratch.worldScale.z === 0
  ) {
    return undefined
  }
  scratch.localPosition.copy(worldPosition)
  object.worldToLocal(scratch.localPosition)
  const { width, height, depth } = object.geometry.parameters
  const localRadiusX = radius / Math.abs(scratch.worldScale.x)
  const localRadiusY = radius / Math.abs(scratch.worldScale.y)
  const localRadiusZ = radius / Math.abs(scratch.worldScale.z)
  if (
    Math.abs(scratch.localPosition.x) > width / 2 + localRadiusX ||
    Math.abs(scratch.localPosition.y) > height / 2 + localRadiusY
  ) {
    return undefined
  }
  const nearestSurface = scratch.localPosition.z - localRadiusZ
  const farthestSurface = scratch.localPosition.z + localRadiusZ
  if (nearestSurface > depth / 2 + 0.025 || farthestSurface < -depth / 2) {
    return undefined
  }
  return nearestSurface <= depth / 2 + 1e-9 ? 'pressed' : 'hover'
}

export function orientedBoxLocalY(
  object: Mesh<BoxGeometry>,
  worldPosition: Vector3,
  marginMeters: number,
  scratch: OrientedBoxScratch,
): number | null {
  object.updateWorldMatrix(true, false)
  object.getWorldScale(scratch.worldScale)
  if (scratch.worldScale.x === 0 || scratch.worldScale.y === 0) return null
  scratch.localPosition.copy(worldPosition)
  object.worldToLocal(scratch.localPosition)
  const { width, height } = object.geometry.parameters
  if (
    Math.abs(scratch.localPosition.x) >
      width / 2 + marginMeters / Math.abs(scratch.worldScale.x) ||
    Math.abs(scratch.localPosition.y) >
      height / 2 + marginMeters / Math.abs(scratch.worldScale.y)
  ) {
    return null
  }
  return scratch.localPosition.y * Math.abs(scratch.worldScale.y)
}
