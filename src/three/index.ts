import { Raycaster } from 'three/src/core/Raycaster.js'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import type { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js'

import {
  createWristMenuRuntime,
  type ControllerSelectionSourceSample,
  type HostSnapshot,
  type PresentationModel,
  type TargetObservation,
  type WristMenuEvent,
} from '../core/index.js'
import { ControllerTracerPresentation } from './controller-tracer-presentation.js'

export * from '../core/index.js'

export type ThreeWristMenuRenderer = Pick<WebGLRenderer, 'xr'>

export type ThreeWristMenuUpdate = Readonly<{
  time: number
  frame: XRFrame | null
}>

export type CreateThreeWristMenuOptions = Readonly<{
  renderer: ThreeWristMenuRenderer
  snapshot: HostSnapshot
  onEvent: (event: WristMenuEvent) => void
}>

export type ThreeWristMenu = Readonly<{
  group: Group
  sync(nextSnapshot: HostSnapshot): void
  update(update: ThreeWristMenuUpdate): void
  blocksSceneInput(inputSource: XRInputSource): boolean
  dispose(): void
}>

type SelectEvent = Readonly<{ inputSource: XRInputSource }>

/** Create the vanilla Three.js Renderer Integration. */
export function createThreeWristMenu(
  options: CreateThreeWristMenuOptions,
): ThreeWristMenu {
  const runtime = createWristMenuRuntime({
    snapshot: options.snapshot,
    onEvent: options.onEvent,
  })
  const presentation = new ControllerTracerPresentation()
  const raycaster = new Raycaster()
  const rayMatrix = new Matrix4()
  const rayOrigin = new Vector3()
  const rayDirection = new Vector3()
  const sourceIds = new WeakMap<XRInputSource, string>()
  const sourcePressed = new WeakMap<XRInputSource, boolean>()
  const sourceCompleted = new WeakSet<XRInputSource>()
  const lastTargetBySource = new WeakMap<XRInputSource, string>()
  const provisionalClaims = new WeakSet<XRInputSource>()
  let sourceSequence = 0
  let frameSequence = 0
  let geometryBarrierThrough = 1
  let presentationRevision = 0
  let session: XRSession | null = null
  let disposed = false

  const sourceId = (inputSource: XRInputSource) => {
    const existing = sourceIds.get(inputSource)
    if (existing !== undefined) return existing
    sourceSequence += 1
    const created = `controller-${sourceSequence}`
    sourceIds.set(inputSource, created)
    return created
  }

  const onSelectStart = (event: SelectEvent) => {
    sourcePressed.set(event.inputSource, true)
    if (lastTargetBySource.has(event.inputSource)) {
      provisionalClaims.add(event.inputSource)
    }
  }
  const onSelectEnd = (event: SelectEvent) => {
    sourcePressed.set(event.inputSource, false)
  }
  const onSelect = (event: SelectEvent) => {
    sourceCompleted.add(event.inputSource)
  }
  const onSessionEnd = () => attachSession(null)

  const attachSession = (nextSession: XRSession | null) => {
    if (session === nextSession) return
    if (session !== null) {
      session.removeEventListener('selectstart', onSelectStart)
      session.removeEventListener('select', onSelect)
      session.removeEventListener('selectend', onSelectEnd)
      session.removeEventListener('end', onSessionEnd)
    }
    session = nextSession
    if (session !== null) {
      session.addEventListener('selectstart', onSelectStart)
      session.addEventListener('select', onSelect)
      session.addEventListener('selectend', onSelectEnd)
      session.addEventListener('end', onSessionEnd)
    }
  }

  const assertActive = () => {
    if (disposed) throw new Error('Wrist Menu Instance is disposed')
  }

  return Object.freeze({
    group: presentation.group,

    sync(nextSnapshot) {
      assertActive()
      runtime.sync(nextSnapshot)
    },

    update({ time, frame }) {
      assertActive()
      frameSequence += 1
      const nextSession = options.renderer.xr.getSession()
      attachSession(nextSession)

      const isGeometryTargetable = frameSequence > geometryBarrierThrough
      presentation.setTargetable(isGeometryTargetable)
      presentation.group.updateMatrixWorld(true)

      const selectionSources: ControllerSelectionSourceSample[] = []
      const targetObservations: TargetObservation[] = []
      const referenceSpace = options.renderer.xr.getReferenceSpace()

      if (frame !== null && nextSession !== null && referenceSpace !== null) {
        for (const inputSource of nextSession.inputSources) {
          if (
            inputSource.handedness !== 'left' &&
            inputSource.handedness !== 'right'
          ) {
            continue
          }

          const id = sourceId(inputSource)
          selectionSources.push({
            id,
            kind: 'controller',
            handedness: inputSource.handedness,
            selectPressed: sourcePressed.get(inputSource) ?? false,
            selectCompleted: sourceCompleted.has(inputSource),
          })

          const pose = frame.getPose(inputSource.targetRaySpace, referenceSpace)
          if (pose == null || !isGeometryTargetable) {
            lastTargetBySource.delete(inputSource)
            continue
          }

          rayMatrix.fromArray(pose.transform.matrix)
          rayOrigin.setFromMatrixPosition(rayMatrix)
          rayDirection.set(0, 0, -1).transformDirection(rayMatrix)
          raycaster.set(rayOrigin, rayDirection)
          const intersection = raycaster.intersectObjects(
            presentation.hitRegions,
            false,
          )[0]
          const itemId = presentation.itemIdForIntersection(intersection)
          if (itemId !== undefined) {
            lastTargetBySource.set(inputSource, itemId)
            targetObservations.push({
              sourceId: id,
              kind: 'controller-target-ray',
              itemId,
            })
          } else {
            lastTargetBySource.delete(inputSource)
          }
        }
      }

      const model = runtime.step(
        {
          sequence: frameSequence,
          time,
          visibility:
            nextSession?.visibilityState === 'hidden'
              ? 'hidden'
              : nextSession?.visibilityState === 'visible-blurred'
                ? 'visible-blurred'
                : 'visible',
          selectionSources,
        },
        targetObservations,
      )

      if (model.revision !== presentationRevision) {
        presentationRevision = model.revision
        presentation.renderItems(model.items)
        geometryBarrierThrough = frameSequence
      }

      presentation.setModel(
        model,
        model.targetable && frameSequence > geometryBarrierThrough,
      )

      for (const inputSource of nextSession?.inputSources ?? []) {
        if (!(sourcePressed.get(inputSource) ?? false)) {
          sourceCompleted.delete(inputSource)
        }
        if (!runtime.blocksSceneInput(sourceId(inputSource))) {
          provisionalClaims.delete(inputSource)
        }
      }
    },

    blocksSceneInput(inputSource) {
      assertActive()
      return (
        provisionalClaims.has(inputSource) ||
        runtime.blocksSceneInput(sourceId(inputSource))
      )
    },

    dispose() {
      if (disposed) return
      attachSession(null)
      runtime.dispose()
      presentation.dispose()
      disposed = true
    },
  })
}
