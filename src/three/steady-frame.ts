import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import { Matrix4 } from 'three/src/math/Matrix4.js'

type PoseSignature = {
  present: boolean
  emulatedPosition: boolean
  matrixMode: boolean
  matrix: Float64Array
}

type SourceSignature = {
  handedness: XRHandedness
  hand: XRHand | undefined
  gripSpace: XRSpace | undefined
  targetRaySpace: XRSpace
  wristSpace: XRJointSpace | undefined
  fingertipSpace: XRJointSpace | undefined
  wristPose: PoseSignature
  fingertipPose: PoseSignature
  fingertipRadius: number
  gripPose: PoseSignature
  targetRayPose: PoseSignature
  selectPressed: boolean
  selectCompleted: boolean
}

export type SteadyFrameSignature = {
  valid: boolean
  session: XRSession | null
  referenceSpace: XRReferenceSpace | null
  visibility: XRVisibilityState | null
  parent: Object3D<Object3DEventMap> | null
  parentMatrix: Matrix4
  groupVisible: boolean
  groupTransform: Float64Array
  viewerPresent: boolean
  viewerPosition: Float64Array
  inputOrder: XRInputSource[]
  sources: WeakMap<XRInputSource, SourceSignature>
}

export type SteadyFrameObservationContext = {
  readonly group: Object3D<Object3DEventMap>
  sourcePressed: WeakMap<XRInputSource, boolean>
  sourceCompleted: WeakSet<XRInputSource>
  frame: XRFrame | null
  session: XRSession | null
  referenceSpace: XRReferenceSpace | null
  parent: Object3D<Object3DEventMap> | null
}

export type SteadyFrameObservationMode = 'compare' | 'capture'

function createPoseSignature(): PoseSignature {
  return {
    present: false,
    emulatedPosition: false,
    matrixMode: false,
    matrix: new Float64Array(16),
  }
}

export function createSteadyFrameSignature(): SteadyFrameSignature {
  return {
    valid: false,
    session: null,
    referenceSpace: null,
    visibility: null,
    parent: null,
    parentMatrix: new Matrix4(),
    groupVisible: false,
    groupTransform: new Float64Array(10),
    viewerPresent: false,
    viewerPosition: new Float64Array(3),
    inputOrder: [],
    sources: new WeakMap(),
  }
}

export function createSteadyFrameObservationContext(
  group: Object3D<Object3DEventMap>,
  sourcePressed: WeakMap<XRInputSource, boolean>,
  sourceCompleted: WeakSet<XRInputSource>,
): SteadyFrameObservationContext {
  return {
    group,
    sourcePressed,
    sourceCompleted,
    frame: null,
    session: null,
    referenceSpace: null,
    parent: null,
  }
}

export function setSteadyFrameObservationContext(
  context: SteadyFrameObservationContext,
  frame: XRFrame | null,
  session: XRSession | null,
  referenceSpace: XRReferenceSpace | null,
  parent: Object3D<Object3DEventMap> | null,
  sourcePressed: WeakMap<XRInputSource, boolean>,
  sourceCompleted: WeakSet<XRInputSource>,
): void {
  context.frame = frame
  context.session = session
  context.referenceSpace = referenceSpace
  context.parent = parent
  context.sourcePressed = sourcePressed
  context.sourceCompleted = sourceCompleted
}

function createSourceSignature(inputSource: XRInputSource): SourceSignature {
  return {
    handedness: inputSource.handedness,
    hand: inputSource.hand,
    gripSpace: inputSource.gripSpace,
    targetRaySpace: inputSource.targetRaySpace,
    wristSpace: undefined,
    fingertipSpace: undefined,
    wristPose: createPoseSignature(),
    fingertipPose: createPoseSignature(),
    fingertipRadius: 0,
    gripPose: createPoseSignature(),
    targetRayPose: createPoseSignature(),
    selectPressed: false,
    selectCompleted: false,
  }
}

function observePose(
  signature: PoseSignature,
  pose: XRPose | XRJointPose | null,
  capture: boolean,
): boolean {
  if (!capture && signature.present !== (pose !== null)) return false
  if (capture) signature.present = pose !== null
  if (pose === null) return true

  if (
    !capture &&
    signature.emulatedPosition !== pose.emulatedPosition
  ) {
    return false
  }
  if (capture) signature.emulatedPosition = pose.emulatedPosition

  const matrix = pose.transform.matrix
  const matrixMode = matrix !== undefined
  if (!capture && signature.matrixMode !== matrixMode) return false
  if (capture) signature.matrixMode = matrixMode
  if (matrix !== undefined) {
    for (let index = 0; index < 16; index += 1) {
      if (!capture && signature.matrix[index] !== matrix[index]) return false
      if (capture) signature.matrix[index] = matrix[index]!
    }
    return true
  }

  const position = pose.transform.position!
  const orientation = pose.transform.orientation!
  if (!capture) {
    return (
      signature.matrix[0] === position.x &&
      signature.matrix[1] === position.y &&
      signature.matrix[2] === position.z &&
      signature.matrix[3] === orientation.x &&
      signature.matrix[4] === orientation.y &&
      signature.matrix[5] === orientation.z &&
      signature.matrix[6] === orientation.w
    )
  }
  signature.matrix[0] = position.x
  signature.matrix[1] = position.y
  signature.matrix[2] = position.z
  signature.matrix[3] = orientation.x
  signature.matrix[4] = orientation.y
  signature.matrix[5] = orientation.z
  signature.matrix[6] = orientation.w
  return true
}

function observeGroupTransform(
  signature: SteadyFrameSignature,
  group: Object3D<Object3DEventMap>,
  capture: boolean,
): boolean {
  const values = signature.groupTransform
  if (!capture) {
    return (
      values[0] === group.position.x &&
      values[1] === group.position.y &&
      values[2] === group.position.z &&
      values[3] === group.quaternion.x &&
      values[4] === group.quaternion.y &&
      values[5] === group.quaternion.z &&
      values[6] === group.quaternion.w &&
      values[7] === group.scale.x &&
      values[8] === group.scale.y &&
      values[9] === group.scale.z
    )
  }
  values[0] = group.position.x
  values[1] = group.position.y
  values[2] = group.position.z
  values[3] = group.quaternion.x
  values[4] = group.quaternion.y
  values[5] = group.quaternion.z
  values[6] = group.quaternion.w
  values[7] = group.scale.x
  values[8] = group.scale.y
  values[9] = group.scale.z
  return true
}

export function steadyPresentationStateChanged(
  signature: SteadyFrameSignature,
  group: Object3D<Object3DEventMap>,
): boolean {
  return signature.valid && (
    signature.groupVisible !== group.visible ||
    !observeGroupTransform(signature, group, false)
  )
}

function observeSource(
  signature: SourceSignature,
  inputSource: XRInputSource,
  frame: XRFrame,
  referenceSpace: XRReferenceSpace,
  sourcePressed: WeakMap<XRInputSource, boolean>,
  sourceCompleted: WeakSet<XRInputSource>,
  capture: boolean,
): boolean {
  const pressed = sourcePressed.get(inputSource) ?? false
  const completed = sourceCompleted.has(inputSource)
  if (!capture && (
    signature.handedness !== inputSource.handedness ||
    signature.hand !== inputSource.hand ||
    signature.gripSpace !== inputSource.gripSpace ||
    signature.targetRaySpace !== inputSource.targetRaySpace ||
    signature.selectPressed !== pressed ||
    signature.selectCompleted !== completed
  )) {
    return false
  }
  if (capture) {
    signature.handedness = inputSource.handedness
    signature.hand = inputSource.hand
    signature.gripSpace = inputSource.gripSpace
    signature.targetRaySpace = inputSource.targetRaySpace
    signature.selectPressed = pressed
    signature.selectCompleted = completed
  }

  if (inputSource.hand !== undefined) {
    const wristSpace = inputSource.hand.get('wrist')
    const fingertipSpace = inputSource.hand.get('index-finger-tip')
    if (!capture && (
      signature.wristSpace !== wristSpace ||
      signature.fingertipSpace !== fingertipSpace
    )) {
      return false
    }
    if (capture) {
      signature.wristSpace = wristSpace
      signature.fingertipSpace = fingertipSpace
    }
    const wristPose = wristSpace === undefined
      ? null
      : (frame.getJointPose?.(wristSpace, referenceSpace) ?? null)
    const fingertipPose = fingertipSpace === undefined
      ? null
      : (frame.getJointPose?.(fingertipSpace, referenceSpace) ?? null)
    const radius = fingertipPose?.radius ?? 0
    if (
      !observePose(signature.wristPose, wristPose, capture) ||
      !observePose(signature.fingertipPose, fingertipPose, capture) ||
      (!capture && signature.fingertipRadius !== radius)
    ) {
      return false
    }
    if (capture) {
      signature.fingertipRadius = radius
      observePose(signature.gripPose, null, true)
      observePose(signature.targetRayPose, null, true)
    }
    return true
  }

  if (!capture && (
    signature.wristSpace !== undefined ||
    signature.fingertipSpace !== undefined
  )) {
    return false
  }
  if (capture) {
    signature.wristSpace = undefined
    signature.fingertipSpace = undefined
  }
  const gripPose = inputSource.gripSpace === undefined
    ? null
    : (frame.getPose(inputSource.gripSpace, referenceSpace) ?? null)
  const targetRayPose = frame.getPose(
    inputSource.targetRaySpace,
    referenceSpace,
  ) ?? null
  if (
    !observePose(signature.gripPose, gripPose, capture) ||
    !observePose(signature.targetRayPose, targetRayPose, capture)
  ) {
    return false
  }
  if (capture) {
    observePose(signature.wristPose, null, true)
    observePose(signature.fingertipPose, null, true)
    signature.fingertipRadius = 0
  }
  return true
}

/**
 * Observe every field that admits the advancing-frame fast path. Compare and
 * capture deliberately share this traversal so adding a field cannot update
 * one cascade while leaving the other stale.
 */
export function observeSteadyFrame(
  signature: SteadyFrameSignature,
  context: SteadyFrameObservationContext,
  mode: SteadyFrameObservationMode,
): boolean {
  const capture = mode === 'capture'
  if (capture) signature.valid = false
  const {
    frame,
    session,
    referenceSpace,
    parent,
    group,
    sourcePressed,
    sourceCompleted,
  } = context
  if (frame === null || session === null || referenceSpace === null) return false

  const visibility = session.visibilityState
  if (!capture && (
    !signature.valid ||
    signature.session !== session ||
    signature.referenceSpace !== referenceSpace ||
    signature.visibility !== visibility ||
    signature.parent !== parent ||
    signature.groupVisible !== group.visible ||
    signature.inputOrder.length !== session.inputSources.length
  )) {
    return false
  }
  if (capture) {
    signature.session = session
    signature.referenceSpace = referenceSpace
    signature.visibility = visibility
    signature.parent = parent
    signature.groupVisible = group.visible
    signature.inputOrder.length = session.inputSources.length
  }

  if (parent !== null) {
    parent.updateWorldMatrix(true, false)
    if (!capture && !signature.parentMatrix.equals(parent.matrixWorld)) {
      return false
    }
    if (capture) signature.parentMatrix.copy(parent.matrixWorld)
  }
  if (!observeGroupTransform(signature, group, capture)) return false

  const viewerPose = frame.getViewerPose(referenceSpace) ?? null
  if (!capture && signature.viewerPresent !== (viewerPose !== null)) return false
  if (capture) signature.viewerPresent = viewerPose !== null
  if (viewerPose !== null) {
    const position = viewerPose.transform.position
    if (!capture && (
      signature.viewerPosition[0] !== position.x ||
      signature.viewerPosition[1] !== position.y ||
      signature.viewerPosition[2] !== position.z
    )) {
      return false
    }
    if (capture) {
      signature.viewerPosition[0] = position.x
      signature.viewerPosition[1] = position.y
      signature.viewerPosition[2] = position.z
    }
  }

  for (let index = 0; index < session.inputSources.length; index += 1) {
    const inputSource = session.inputSources[index]!
    if (!capture && signature.inputOrder[index] !== inputSource) return false
    if (capture) signature.inputOrder[index] = inputSource
    let sourceSignature = signature.sources.get(inputSource)
    if (sourceSignature === undefined) {
      if (!capture) return false
      sourceSignature = createSourceSignature(inputSource)
      signature.sources.set(inputSource, sourceSignature)
    }
    if (!observeSource(
      sourceSignature,
      inputSource,
      frame,
      referenceSpace,
      sourcePressed,
      sourceCompleted,
      capture,
    )) {
      return false
    }
  }

  if (capture) signature.valid = true
  return true
}
