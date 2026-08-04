import { Matrix4, Quaternion, Vector3 } from 'three'

import { FakeReferenceSpace, FakeXrSession } from './controller-action.mjs'

export function xrPose(matrix, radius) {
  const position = new Vector3()
  const orientation = new Quaternion()
  matrix.decompose(position, orientation, new Vector3())
  return {
    emulatedPosition: false,
    ...(radius === undefined ? {} : { radius }),
    transform: {
      matrix: matrix.toArray(),
      position,
      orientation,
    },
  }
}

export function createHandXrFixture() {
  const menuSource = {
    handedness: 'left',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    profiles: ['unknown'],
  }
  const wristSpace = {}
  const fingertipSpace = {}
  const handSpaces = new Map([
    ['wrist', wristSpace],
    ['index-finger-tip', fingertipSpace],
  ])
  const handSource = {
    handedness: 'right',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: null,
    hand: { get: (name) => handSpaces.get(name) },
    profiles: ['generic-hand-select'],
  }
  const session = new FakeXrSession([menuSource, handSource])
  const referenceSpace = new FakeReferenceSpace()
  let fingertipZ = 0.1
  let fingertipTracked = true
  const frame = {
    session,
    getPose(space) {
      if (space === menuSource.gripSpace) {
        return xrPose(new Matrix4().makeRotationY(-Math.PI / 2))
      }
      return null
    },
    getJointPose(space) {
      if (space === wristSpace) return xrPose(new Matrix4())
      if (space === fingertipSpace && fingertipTracked) {
        return xrPose(new Matrix4().makeTranslation(0, 0.0225, fingertipZ), 0.005)
      }
      return null
    },
    getViewerPose: () => xrPose(new Matrix4().makeTranslation(0, 0, 1)),
  }
  const renderer = {
    xr: {
      getSession: () => session,
      getReferenceSpace: () => referenceSpace,
    },
  }
  return {
    frame,
    handSource,
    renderer,
    session,
    setFingertipZ(value) {
      fingertipZ = value
    },
    setFingertipTracked(value) {
      fingertipTracked = value
    },
  }
}

export function createControllerHapticFixture(hapticActuator) {
  const controller = {
    handedness: 'right',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    gamepad: { hapticActuators: [hapticActuator] },
    profiles: ['unknown'],
  }
  const menuSource = {
    handedness: 'left',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
    gripSpace: {},
    profiles: ['unknown'],
  }
  const session = new FakeXrSession([menuSource, controller])
  const referenceSpace = new FakeReferenceSpace()
  const frame = {
    session,
    getPose(space) {
      if (space === controller.targetRaySpace) {
        return xrPose(new Matrix4().makeTranslation(0, 0, 1))
      }
      if (space === menuSource.gripSpace) {
        return xrPose(new Matrix4().makeRotationY(-Math.PI / 2))
      }
      if (space === controller.gripSpace) return xrPose(new Matrix4())
      return null
    },
    getViewerPose: () => xrPose(new Matrix4().makeTranslation(0, 0, 1)),
  }
  return {
    controller,
    frame,
    renderer: {
      xr: {
        getSession: () => session,
        getReferenceSpace: () => referenceSpace,
      },
    },
    session,
  }
}
