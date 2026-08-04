import { Matrix4, Quaternion, Vector3 } from 'three'

import { FakeReferenceSpace, FakeXrSession } from './controller-action.mjs'

export function xrPose(matrix, emulatedPosition = false) {
  const position = new Vector3()
  const orientation = new Quaternion()
  matrix.decompose(position, orientation, new Vector3())
  return {
    emulatedPosition,
    transform: {
      matrix: matrix.toArray(),
      position,
      orientation,
    },
  }
}
export function createWristXrFixture({
  menuKind = 'hand',
  menuWrist = 'left',
} = {}) {
  const wristSpace = {}
  const menuSource = {
    handedness: menuWrist,
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: menuKind === 'controller' ? {} : undefined,
    hand:
      menuKind === 'hand'
        ? new Map([['wrist', wristSpace]])
        : undefined,
    profiles: menuKind === 'hand' ? ['generic-hand-select'] : ['unknown'],
  }
  const selectionSource = {
    handedness: menuWrist === 'left' ? 'right' : 'left',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    profiles: ['unknown'],
  }
  const session = new FakeXrSession([menuSource, selectionSource])
  const referenceSpace = new FakeReferenceSpace()
  let wristMatrix = new Matrix4()
  let wristTracked = true
  let viewerPosition = new Vector3(0, -1, 0)
  let targetRayMatrix = new Matrix4().makeTranslation(0, 0, 1)
  const poseCalls = []

  const frame = {
    session,
    getViewerPose() {
      return xrPose(new Matrix4().makeTranslation(...viewerPosition.toArray()))
    },
    getJointPose(space, reference) {
      poseCalls.push({ method: 'joint', space })
      if (reference !== referenceSpace || space !== wristSpace) {
        throw new Error('unexpected wrist joint query')
      }
      return wristTracked ? xrPose(wristMatrix) : null
    },
    getPose(space, reference) {
      poseCalls.push({ method: 'pose', space })
      if (reference !== referenceSpace) throw new Error('unexpected reference space')
      if (space === menuSource.gripSpace) {
        return wristTracked ? xrPose(wristMatrix) : null
      }
      if (space === selectionSource.gripSpace) return xrPose(new Matrix4())
      if (space === selectionSource.targetRaySpace) return xrPose(targetRayMatrix)
      if (space === menuSource.targetRaySpace) {
        return xrPose(new Matrix4().makeTranslation(50, 50, 50))
      }
      throw new Error('unexpected pose query')
    },
  }
  const renderer = {
    xr: {
      getSession: () => session,
      getReferenceSpace: () => referenceSpace,
    },
  }

  return {
    frame,
    menuSource,
    poseCalls,
    referenceSpace,
    renderer,
    selectionSource,
    session,
    setTargetRayMatrix(matrix) {
      targetRayMatrix = matrix
    },
    setViewerPosition(position) {
      viewerPosition = new Vector3(...position)
    },
    setWristMatrix(matrix) {
      wristMatrix = matrix
    },
    setWristTracked(tracked) {
      wristTracked = tracked
    },
  }
}
