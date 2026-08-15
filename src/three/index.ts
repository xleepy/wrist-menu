import { Raycaster } from 'three/src/core/Raycaster.js'
import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Quaternion } from 'three/src/math/Quaternion.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import type { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  resolveControllerWristOffset,
  resolveWristAnchor,
  stepWristMenuRuntime,
  syncWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
  type ActivationMode,
  type ControllerWristConfiguration,
  type SelectionSourceSample,
  type Handedness,
  type HostSnapshot,
  type PoseSample,
  type PresentationModel,
  type ScrollSourceSample,
  type TargetObservation,
  type Vector3Tuple,
  type WristMenuRuntimeState,
  type WristSourceSample,
  type WristMenuEvent,
} from '../core/index.js'
import { copyHostSnapshot } from '../core/host-snapshot.js'
import { createInitialPresentationModel } from '../core/presentation-model.js'
import { resetRuntimeForPresentationReplacement } from '../core/runtime-internals.js'
import { selectWristSource } from '../core/wrist-anchor.js'
import {
  defaultThreeWristMenuPresentationFactory,
  ManagedWristMenuPresentation,
  type ThreeWristMenuPresentationFactory,
} from './presentation.js'

export * from '../core/index.js'
export {
  defaultThreeWristMenuPresentationFactory,
  type ThreeWristMenuHitRegion,
  type ThreeWristMenuPresentation,
  type ThreeWristMenuPresentationFactory,
  type ThreeWristMenuViewport,
} from './presentation.js'

export type ThreeWristMenuRenderer = Pick<WebGLRenderer, 'xr'>

export type ThreeWristMenuUpdate = Readonly<{
  time: number
  frame: XRFrame | null
}>

export type CreateThreeWristMenuOptions = Readonly<{
  renderer: ThreeWristMenuRenderer
  snapshot: HostSnapshot
  onEvent: (event: WristMenuEvent) => void
  presentationFactory?: ThreeWristMenuPresentationFactory
}>

type SelectEvent = Readonly<{ inputSource: XRInputSource }>

type AnchorSettings = Readonly<{
  activationMode: ActivationMode
  wrist: Handedness
  controllerWrist: ControllerWristConfiguration
}>

type BoundSessionHandlers = {
  selectstart: (e: SelectEvent) => void
  select: (e: SelectEvent) => void
  selectend: (e: SelectEvent) => void
  inputsourceschange: () => void
  visibilitychange: () => void
  end: () => void
}

type BoundReferenceSpaceHandler = () => void

export type ThreeWristMenuState = {
  renderer: ThreeWristMenuRenderer
  onEvent: (event: WristMenuEvent) => void
  runtime: WristMenuRuntimeState
  presentation: ManagedWristMenuPresentation
  raycaster: Raycaster
  rayMatrix: Matrix4
  rayOrigin: Vector3
  rayDirection: Vector3
  anchorMatrix: Matrix4
  parentInverse: Matrix4
  anchorParentMatrix: Matrix4
  anchorPosition: Vector3
  anchorOrientation: Quaternion
  anchorScale: Vector3
  anchorPoseApplied: boolean
  lastAnchorParent: Object3D<Object3DEventMap> | null
  sourceIds: WeakMap<XRInputSource, string>
  inputSourceById: Map<string, XRInputSource>
  anchorSettings: AnchorSettings
  pendingAnchorSettings: AnchorSettings | undefined
  sourcePressed: WeakMap<XRInputSource, boolean>
  sourceCompleted: WeakSet<XRInputSource>
  lastTargetBySource: WeakMap<XRInputSource, string>
  provisionalClaims: WeakSet<XRInputSource>
  inputSourceSequence: number
  frameSequence: number
  geometryBarrierThrough: number
  presentationRevision: number
  session: XRSession | null
  referenceSpace: XRReferenceSpace | null
  readonly sessionHandlers: BoundSessionHandlers
  readonly referenceSpaceHandler: BoundReferenceSpaceHandler
  lifecycleRevision: number
  observedSession: boolean
  observedParent: boolean
  lastParent: Object3D<Object3DEventMap> | null
  lastUpdateFrame: XRFrame | null | undefined
  lastUpdateTime: number
  lastSessionVisibility: XRVisibilityState | null
  frameInvalidated: boolean
  disposed: boolean
}

function materializeAnchorSettings(snapshot: HostSnapshot): AnchorSettings {
  const copyOffset = (handedness: Handedness) => {
    const offset = resolveControllerWristOffset(
      snapshot.controllerWrist,
      handedness,
    )
    return Object.freeze({
      translationMeters: Object.freeze([...offset.translationMeters]) as Vector3Tuple,
      rotationDegrees: Object.freeze([...offset.rotationDegrees]) as Vector3Tuple,
    })
  }
  return Object.freeze({
    activationMode: snapshot.activationMode,
    wrist: snapshot.wrist,
    controllerWrist: Object.freeze({
      offsets: Object.freeze({
        left: copyOffset('left'),
        right: copyOffset('right'),
      }),
    }),
  })
}

function requestCommitHaptic(
  inputSource: XRInputSource | undefined,
): void {
  const gamepad = inputSource?.gamepad as
    | (Gamepad & {
        hapticActuators?: ReadonlyArray<{
          pulse?(intensity: number, duration: number): unknown
        }>
        vibrationActuator?: {
          playEffect?(effect: string, parameters: object): unknown
        }
      })
    | undefined
  const actuator = gamepad?.hapticActuators?.[0]
  try {
    const request =
      typeof actuator?.pulse === 'function'
        ? actuator.pulse(0.35, 20)
        : gamepad?.vibrationActuator?.playEffect?.('dual-rumble', {
            duration: 20,
            startDelay: 0,
            strongMagnitude: 0.35,
            weakMagnitude: 0.35,
          })
    if (request !== undefined) {
      void Promise.resolve(request).catch(() => undefined)
    }
  } catch {
    // Haptics are optional feedback and never alter semantic delivery.
  }
}

function deliverWristMenuEventWithFeedback(
  state: ThreeWristMenuState,
  event: WristMenuEvent,
): void {
  try {
    state.onEvent(event)
  } finally {
    if (
      event.type === 'selection-intent' &&
      event.source.kind === 'controller'
    ) {
      requestCommitHaptic(state.inputSourceById.get(event.source.id))
    }
  }
}

function sourceId(state: ThreeWristMenuState, inputSource: XRInputSource): string {
  const existing = state.sourceIds.get(inputSource)
  if (existing !== undefined) return existing
  state.inputSourceSequence += 1
  const created = `input-source-${state.inputSourceSequence}`
  state.sourceIds.set(inputSource, created)
  return created
}

function poseSample(pose: XRPose | XRJointPose): PoseSample {
  return Object.freeze({
    position: Object.freeze([
      pose.transform.position.x,
      pose.transform.position.y,
      pose.transform.position.z,
    ]) as Vector3Tuple,
    orientation: Object.freeze([
      pose.transform.orientation.x,
      pose.transform.orientation.y,
      pose.transform.orientation.z,
      pose.transform.orientation.w,
    ]),
    emulatedPosition: pose.emulatedPosition,
  })
}

function applyAnchorPose(
  state: ThreeWristMenuState,
  pose: PresentationModel['anchorPose'],
): void {
  if (pose === null) return
  const parent = state.presentation.group.parent
  if (parent !== null) parent.updateWorldMatrix(true, false)
  const poseUnchanged =
    state.anchorPoseApplied &&
    state.anchorPosition.x === pose.position[0] &&
    state.anchorPosition.y === pose.position[1] &&
    state.anchorPosition.z === pose.position[2] &&
    state.anchorOrientation.x === pose.orientation[0] &&
    state.anchorOrientation.y === pose.orientation[1] &&
    state.anchorOrientation.z === pose.orientation[2] &&
    state.anchorOrientation.w === pose.orientation[3]
  const parentUnchanged =
    state.lastAnchorParent === parent &&
    (parent === null || state.anchorParentMatrix.equals(parent.matrixWorld))
  if (poseUnchanged && parentUnchanged) return

  state.anchorPosition.fromArray(pose.position)
  state.anchorOrientation.fromArray(pose.orientation)
  state.anchorMatrix.compose(
    state.anchorPosition,
    state.anchorOrientation,
    state.anchorScale,
  )
  if (parent !== null) {
    state.parentInverse.copy(parent.matrixWorld).invert()
    state.anchorMatrix.premultiply(state.parentInverse)
  }
  state.anchorMatrix.decompose(
    state.presentation.group.position,
    state.presentation.group.quaternion,
    state.presentation.group.scale,
  )
  state.anchorPoseApplied = true
  state.lastAnchorParent = parent
  if (parent !== null) state.anchorParentMatrix.copy(parent.matrixWorld)
}

function clearTransientInput(state: ThreeWristMenuState): void {
  state.sourcePressed = new WeakMap()
  state.sourceCompleted = new WeakSet()
  state.lastTargetBySource = new WeakMap()
  state.provisionalClaims = new WeakSet()
}

function interruptLifecycle(state: ThreeWristMenuState): void {
  state.lifecycleRevision += 1
  state.frameInvalidated = true
  clearTransientInput(state)
}

function applyLifecycleSample(
  state: ThreeWristMenuState,
  visibility: 'visible-blurred' | 'hidden',
): void {
  state.presentation.setTargetable(false)
  if (visibility === 'hidden') state.presentation.group.visible = false
  state.frameSequence += 1
  const model = stepWristMenuRuntime(
    state.runtime,
    {
      sequence: state.frameSequence,
      time: state.lastUpdateTime,
      visibility,
      viewerPosition: null,
      wristSources: [],
      lifecycleRevision: state.lifecycleRevision,
      selectionSources: [],
    },
    [],
  )
  state.presentation.applyModel(model, false)
}

function onSelectStart(state: ThreeWristMenuState, event: SelectEvent): void {
  state.frameInvalidated = true
  state.sourcePressed.set(event.inputSource, true)
  if (state.lastTargetBySource.has(event.inputSource)) {
    state.provisionalClaims.add(event.inputSource)
  }
}

function onSelectEnd(state: ThreeWristMenuState, event: SelectEvent): void {
  state.frameInvalidated = true
  state.sourcePressed.set(event.inputSource, false)
}

function onSelect(state: ThreeWristMenuState, event: SelectEvent): void {
  state.frameInvalidated = true
  state.sourceCompleted.add(event.inputSource)
}

function onSessionEnd(state: ThreeWristMenuState): void {
  attachSession(state, null)
  applyLifecycleSample(state, 'hidden')
}

function onSessionVisibilityChange(state: ThreeWristMenuState): void {
  interruptLifecycle(state)
  if (state.session?.visibilityState === 'visible-blurred') {
    applyLifecycleSample(state, 'visible-blurred')
  } else if (state.session?.visibilityState === 'hidden') {
    applyLifecycleSample(state, 'hidden')
  }
}

function onInputSourcesChange(state: ThreeWristMenuState): void {
  interruptLifecycle(state)
  applyLifecycleSample(state, 'hidden')
}

function onReferenceSpaceReset(state: ThreeWristMenuState): void {
  interruptLifecycle(state)
  applyLifecycleSample(state, 'hidden')
}

function attachSession(
  state: ThreeWristMenuState,
  nextSession: XRSession | null,
): void {
  if (state.session === nextSession) return
  if (state.session !== null) {
    state.session.removeEventListener(
      'selectstart',
      state.sessionHandlers.selectstart,
    )
    state.session.removeEventListener('select', state.sessionHandlers.select)
    state.session.removeEventListener(
      'selectend',
      state.sessionHandlers.selectend,
    )
    state.session.removeEventListener(
      'inputsourceschange',
      state.sessionHandlers.inputsourceschange,
    )
    state.session.removeEventListener(
      'visibilitychange',
      state.sessionHandlers.visibilitychange,
    )
    state.session.removeEventListener('end', state.sessionHandlers.end)
  }
  if (state.observedSession) interruptLifecycle(state)
  state.session = nextSession
  state.observedSession = true
  if (state.session !== null) {
    state.session.addEventListener(
      'selectstart',
      state.sessionHandlers.selectstart,
    )
    state.session.addEventListener('select', state.sessionHandlers.select)
    state.session.addEventListener(
      'selectend',
      state.sessionHandlers.selectend,
    )
    state.session.addEventListener(
      'inputsourceschange',
      state.sessionHandlers.inputsourceschange,
    )
    state.session.addEventListener(
      'visibilitychange',
      state.sessionHandlers.visibilitychange,
    )
    state.session.addEventListener('end', state.sessionHandlers.end)
  }
}

function attachReferenceSpace(
  state: ThreeWristMenuState,
  nextReferenceSpace: XRReferenceSpace | null,
): void {
  if (state.referenceSpace === nextReferenceSpace) return
  if (state.referenceSpace !== null) {
    state.referenceSpace.removeEventListener('reset', state.referenceSpaceHandler)
  }
  if (state.referenceSpace !== null) interruptLifecycle(state)
  state.referenceSpace = nextReferenceSpace
  if (state.referenceSpace !== null) {
    state.referenceSpace.addEventListener('reset', state.referenceSpaceHandler)
  }
}

function assertActive(state: ThreeWristMenuState): void {
  if (state.disposed) throw new Error('Wrist Menu Instance is disposed')
}

/** Create state for the vanilla Three.js Renderer Integration. */
export function createThreeWristMenuState(
  options: CreateThreeWristMenuOptions,
): ThreeWristMenuState {
  const initialSnapshot = copyHostSnapshot(options.snapshot)
  const initialModel = createInitialPresentationModel(initialSnapshot, 1)
  const presentation = new ManagedWristMenuPresentation(
    initialModel,
    options.presentationFactory ?? defaultThreeWristMenuPresentationFactory,
  )
  let state: ThreeWristMenuState
  const sessionHandlers: BoundSessionHandlers = {
    selectstart: (event) => onSelectStart(state, event),
    select: (event) => onSelect(state, event),
    selectend: (event) => onSelectEnd(state, event),
    inputsourceschange: () => onInputSourcesChange(state),
    visibilitychange: () => onSessionVisibilityChange(state),
    end: () => onSessionEnd(state),
  }
  const referenceSpaceHandler = () => onReferenceSpaceReset(state)
  const runtime = createWristMenuRuntimeState({
    snapshot: initialSnapshot,
    onEvent: (event) => deliverWristMenuEventWithFeedback(state, event),
  })
  state = {
    renderer: options.renderer,
    onEvent: options.onEvent,
    runtime,
    presentation,
    raycaster: new Raycaster(),
    rayMatrix: new Matrix4(),
    rayOrigin: new Vector3(),
    rayDirection: new Vector3(),
    anchorMatrix: new Matrix4(),
    parentInverse: new Matrix4(),
    anchorParentMatrix: new Matrix4(),
    anchorPosition: new Vector3(),
    anchorOrientation: new Quaternion(),
    anchorScale: new Vector3(1, 1, 1),
    anchorPoseApplied: false,
    lastAnchorParent: null,
    sourceIds: new WeakMap(),
    inputSourceById: new Map(),
    anchorSettings: materializeAnchorSettings(initialSnapshot),
    pendingAnchorSettings: undefined,
    sourcePressed: new WeakMap(),
    sourceCompleted: new WeakSet(),
    lastTargetBySource: new WeakMap(),
    provisionalClaims: new WeakSet(),
    inputSourceSequence: 0,
    frameSequence: 0,
    geometryBarrierThrough: 1,
    presentationRevision: 0,
    session: null,
    referenceSpace: null,
    sessionHandlers,
    referenceSpaceHandler,
    lifecycleRevision: 0,
    observedSession: false,
    observedParent: false,
    lastParent: null,
    lastUpdateFrame: undefined,
    lastUpdateTime: 0,
    lastSessionVisibility: null,
    frameInvalidated: true,
    disposed: false,
  }
  return state
}

export function syncThreeWristMenu(
  state: ThreeWristMenuState,
  nextSnapshot: HostSnapshot,
): void {
  assertActive(state)
  const copiedSnapshot = copyHostSnapshot(nextSnapshot)
  syncWristMenuRuntime(state.runtime, copiedSnapshot)
  state.pendingAnchorSettings = materializeAnchorSettings(copiedSnapshot)
  state.frameInvalidated = true
}

/**
 * Replace only the inner presentation while retaining the package-owned
 * attachment. Interaction is released immediately and automatic reveal starts
 * a fresh initial dwell on the next XR frame.
 */
export function replaceThreeWristMenuPresentation(
  state: ThreeWristMenuState,
  presentationFactory: ThreeWristMenuPresentationFactory,
): void {
  assertActive(state)
  let resetError: unknown
  const snapshot = state.runtime.pendingSnapshot ?? state.runtime.snapshot
  const model = createInitialPresentationModel(
    snapshot,
    state.runtime.revision + 1,
  )
  state.presentation.replace(presentationFactory, model, () => {
    try {
      resetRuntimeForPresentationReplacement(state.runtime)
    } catch (error) {
      resetError = error
    } finally {
      clearTransientInput(state)
    }
    state.presentationRevision = 0
    state.geometryBarrierThrough = state.frameSequence
    state.frameInvalidated = true
  })
  if (resetError !== undefined) throw resetError
}

export function updateThreeWristMenu(
  state: ThreeWristMenuState,
  update: ThreeWristMenuUpdate,
): void {
  assertActive(state)
  const nextSession = state.renderer.xr.getSession()
  const nextReferenceSpace = state.renderer.xr.getReferenceSpace()
  const parent = state.presentation.group.parent
  const sessionVisibility = nextSession?.visibilityState ?? null
  if (
    !state.frameInvalidated &&
    state.lastUpdateFrame === update.frame &&
    state.lastUpdateTime === update.time &&
    state.session === nextSession &&
    state.referenceSpace === nextReferenceSpace &&
    state.lastParent === parent &&
    state.lastSessionVisibility === sessionVisibility
  ) {
    return
  }
  state.lastUpdateTime = update.time
  state.frameSequence += 1
  if (state.pendingAnchorSettings !== undefined) {
    state.anchorSettings = state.pendingAnchorSettings
    state.pendingAnchorSettings = undefined
  }
  attachSession(state, nextSession)
  state.inputSourceById.clear()

  if (state.observedParent && parent !== state.lastParent) interruptLifecycle(state)
  state.lastParent = parent
  state.observedParent = true

  const isGeometryTargetable = state.frameSequence > state.geometryBarrierThrough
  state.presentation.group.updateMatrixWorld(true)

  const selectionSources: SelectionSourceSample[] = []
  const wristSources: WristSourceSample[] = []
  const controllerSources: Array<
    Readonly<{ id: string; handedness: Handedness; inputSource: XRInputSource }>
  > = []
  const handSources: Array<
    Readonly<{
      id: string
      handedness: Handedness
      fingertipPose: XRJointPose
    }>
  > = []
  const targetObservations: TargetObservation[] = []
  const scrollSources: ScrollSourceSample[] = []
  attachReferenceSpace(state, nextReferenceSpace)
  let viewerPosition: Vector3Tuple | null = null

  if (update.frame !== null && nextSession !== null && nextReferenceSpace !== null) {
    const viewerPose = update.frame.getViewerPose(nextReferenceSpace)
    if (viewerPose != null) {
      viewerPosition = Object.freeze([
        viewerPose.transform.position.x,
        viewerPose.transform.position.y,
        viewerPose.transform.position.z,
      ]) as Vector3Tuple
    }
    for (const inputSource of nextSession.inputSources) {
      if (
        inputSource.handedness !== 'left' &&
        inputSource.handedness !== 'right'
      ) {
        continue
      }

      const id = sourceId(state, inputSource)
      state.inputSourceById.set(id, inputSource)
      if (inputSource.hand != null) {
        const wristSpace = inputSource.hand.get('wrist')
        const wristPose =
          wristSpace === undefined
            ? null
            : (update.frame.getJointPose?.(wristSpace, nextReferenceSpace) ?? null)
        wristSources.push({
          id,
          kind: 'hand',
          handedness: inputSource.handedness,
          pose: wristPose === null ? null : poseSample(wristPose),
        })
        const fingertipSpace = inputSource.hand.get('index-finger-tip')
        const fingertipPose =
          fingertipSpace === undefined
            ? null
            : (update.frame.getJointPose?.(fingertipSpace, nextReferenceSpace) ??
              null)
        if (
          fingertipPose !== null &&
          Number.isFinite(fingertipPose.radius) &&
          (fingertipPose.radius ?? 0) > 0
        ) {
          selectionSources.push({
            id,
            kind: 'hand',
            handedness: inputSource.handedness,
          })
          handSources.push({ id, handedness: inputSource.handedness, fingertipPose })
        }
        continue
      }

      const gripPose =
        inputSource.gripSpace == null
          ? null
          : update.frame.getPose(inputSource.gripSpace, nextReferenceSpace)
      wristSources.push({
        id,
        kind: 'controller',
        handedness: inputSource.handedness,
        pose: gripPose == null ? null : poseSample(gripPose),
      })
      selectionSources.push({
        id,
        kind: 'controller',
        handedness: inputSource.handedness,
        selectPressed: state.sourcePressed.get(inputSource) ?? false,
        selectCompleted: state.sourceCompleted.has(inputSource),
      })
      controllerSources.push({ id, handedness: inputSource.handedness, inputSource })
    }

    const wristSource = selectWristSource(
      wristSources,
      state.anchorSettings.wrist,
    )
    const currentAnchor =
      wristSource === undefined
        ? undefined
        : resolveWristAnchor(
            wristSource,
            viewerPosition,
            state.anchorSettings.controllerWrist,
          )
    if (
      currentAnchor !== undefined &&
      (state.anchorSettings.activationMode !== 'automatic' ||
        currentAnchor.automaticEligible)
    ) {
      applyAnchorPose(state, currentAnchor.anchorPose)
    }
    state.presentation.group.updateMatrixWorld(true)

    for (const { id, handedness, inputSource } of controllerSources) {
      const pose = update.frame.getPose(inputSource.targetRaySpace, nextReferenceSpace)
      if (pose == null || !isGeometryTargetable) {
        state.lastTargetBySource.delete(inputSource)
        continue
      }

      state.rayMatrix.fromArray(pose.transform.matrix)
      state.rayOrigin.setFromMatrixPosition(state.rayMatrix)
      state.rayDirection.set(0, 0, -1).transformDirection(state.rayMatrix)
      state.raycaster.set(state.rayOrigin, state.rayDirection)
      const intersection = state.raycaster.intersectObjects(
        [...state.presentation.hitRegions],
        false,
      )[0]
      const itemId = state.presentation.itemIdForIntersection(intersection)
      if (itemId !== undefined) {
        state.lastTargetBySource.set(inputSource, itemId)
        targetObservations.push({
          sourceId: id,
          kind: 'controller-target-ray',
          itemId,
        })
      } else {
        state.lastTargetBySource.delete(inputSource)
        const panelIntersections = state.raycaster.intersectObject(
          state.presentation.panelMesh,
          false,
        )
        if (panelIntersections.length > 0) {
          const point = panelIntersections[0]!.point
          const localY = state.presentation.panelLocalY(point)
          if (localY !== null) {
            scrollSources.push({
              id,
              kind: 'controller',
              handedness,
              positionY: localY,
              targetingPanel: true,
            })
          }
        }
      }
    }

    for (const { id, handedness, fingertipPose } of handSources) {
      if (!isGeometryTargetable) continue
      const fingertipWorld = new Vector3(
        fingertipPose.transform.position.x,
        fingertipPose.transform.position.y,
        fingertipPose.transform.position.z,
      )
      const observation = state.presentation.fingertipObservation(
        fingertipWorld,
        fingertipPose.radius!,
      )
      if (observation !== undefined) {
        targetObservations.push({ sourceId: id, ...observation })
      } else {
        const localY = state.presentation.panelLocalY(fingertipWorld)
        if (localY !== null) {
          scrollSources.push({
            id,
            kind: 'hand',
            handedness,
            positionY: localY,
            targetingPanel: true,
          })
        }
      }
    }
  }

  const model = stepWristMenuRuntime(
    state.runtime,
    {
      sequence: state.frameSequence,
      time: update.time,
      visibility:
        nextSession === null || nextSession.visibilityState === 'hidden'
          ? 'hidden'
          : nextSession?.visibilityState === 'visible-blurred'
            ? 'visible-blurred'
            : 'visible',
      viewerPosition,
      wristSources,
      lifecycleRevision: state.lifecycleRevision,
      selectionSources,
      scrollSources,
    },
    targetObservations,
  )

  if (model.revision !== state.presentationRevision) {
    state.presentationRevision = model.revision
    state.geometryBarrierThrough = state.frameSequence
  }

  applyAnchorPose(state, model.anchorPose)
  state.presentation.applyModel(
    model,
    model.targetable && state.frameSequence > state.geometryBarrierThrough,
  )

  for (const inputSource of nextSession?.inputSources ?? []) {
    if (!(state.sourcePressed.get(inputSource) ?? false)) {
      state.sourceCompleted.delete(inputSource)
    }
    if (!wristMenuRuntimeBlocksSceneInput(state.runtime, sourceId(state, inputSource))) {
      state.provisionalClaims.delete(inputSource)
    }
  }
  state.lastUpdateFrame = update.frame
  state.lastSessionVisibility = sessionVisibility
  state.frameInvalidated = false
}

export function threeWristMenuBlocksSceneInput(
  state: ThreeWristMenuState,
  inputSource: XRInputSource,
): boolean {
  assertActive(state)
  return (
    state.provisionalClaims.has(inputSource) ||
    wristMenuRuntimeBlocksSceneInput(state.runtime, sourceId(state, inputSource))
  )
}

export function disposeThreeWristMenu(
  state: ThreeWristMenuState,
): void {
  if (state.disposed) return
  state.disposed = true
  try {
    attachSession(state, null)
  } finally {
    try {
      attachReferenceSpace(state, null)
    } finally {
      try {
        disposeWristMenuRuntime(state.runtime)
      } finally {
        state.inputSourceById.clear()
        state.presentation.dispose()
      }
    }
  }
}
