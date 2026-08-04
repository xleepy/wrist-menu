import { Raycaster, type Intersection } from 'three/src/core/Raycaster.js'
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { MeshBasicMaterial } from 'three/src/materials/MeshBasicMaterial.js'
import { Matrix4 } from 'three/src/math/Matrix4.js'
import { Quaternion } from 'three/src/math/Quaternion.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import type { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js'

import {
  createWristMenuRuntime,
  resolveControllerWristOffset,
  resolveWristAnchor,
  type ActivationMode,
  type ControllerWristConfiguration,
  type ControllerSelectionSourceSample,
  type Handedness,
  type HostSnapshot,
  type PoseSample,
  type PresentationModel,
  type TargetObservation,
  type Vector3Tuple,
  type WristSourceSample,
  type WristMenuEvent,
} from '../core/index.js'

export {
  createWristMenuRuntime,
  defaultRevealConfiguration,
  resolveControllerWristOffset,
  resolveRevealConfiguration,
  wristMenuSessionFeatures,
  type ActivationMode,
  type ControllerDeviceTarget,
  type ControllerSelectionSourceSample,
  type ControllerWristConfiguration,
  type ControllerWristOffset,
  type ControllerWristPreset,
  type FrameSample,
  type HostSnapshot,
  type PoseSample,
  type PresentationModel,
  type QuaternionTuple,
  type RevealConfiguration,
  type RevealConfigurationOverrides,
  type RevealPhase,
  type SelectionIntent,
  type TargetObservation,
  type Vector3Tuple,
  type WristAnchorPose,
  type WristSourceSample,
  type WristMenuRuntime,
  type WristMenuEvent,
  type WristMenuSessionFeatures,
  type VisibilityChangeReason,
} from '../core/index.js'

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

const decorativeRaycast: Mesh['raycast'] = () => undefined
const interactiveRaycast = Mesh.prototype.raycast

class WristMenuPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly rowMeshes: Mesh[] = []
  private readonly visualMaterials: MeshBasicMaterial[] = []

  constructor(snapshot: HostSnapshot) {
    this.group.name = 'wrist-menu-attachment-root'

    const panelGeometry = new BoxGeometry(0.192, 0.158, 0.004)
    const panelMaterial = new MeshBasicMaterial({
      color: 0x081415,
      transparent: true,
    })
    const panel = new Mesh(panelGeometry, panelMaterial)
    panel.name = 'wrist-menu-command-slab'
    panel.position.z = -0.004
    panel.raycast = decorativeRaycast
    this.group.add(panel)
    this.resources.push(panelGeometry, panelMaterial)
    this.visualMaterials.push(panelMaterial)

    this.renderItems(snapshot)
  }

  renderItems(snapshot: Pick<HostSnapshot, 'menuDefinition'>) {
    for (const mesh of [...this.rowMeshes, ...this.hitRegions]) {
      mesh.removeFromParent()
    }
    for (const resource of this.resources.splice(2)) resource.dispose()
    this.rowMeshes.length = 0
    this.hitRegions.length = 0
    this.visualMaterials.length = 1

    const rowCount = snapshot.menuDefinition.length
    snapshot.menuDefinition.forEach((item, index) => {
      const y = (rowCount - 1) * 0.01125 - index * 0.0225
      const rowGeometry = new BoxGeometry(0.176, 0.02, 0.003)
      const rowMaterial = new MeshBasicMaterial({
        color: 0x102020,
        transparent: true,
      })
      const row = new Mesh(rowGeometry, rowMaterial)
      row.name = `wrist-menu-action-visual:${item.id}`
      row.position.set(0, y, 0.001)
      row.raycast = decorativeRaycast

      const hitGeometry = new BoxGeometry(0.176, 0.02, 0.008)
      const hitMaterial = new MeshBasicMaterial({ visible: false })
      const hitRegion = new Mesh(hitGeometry, hitMaterial)
      hitRegion.name = `wrist-menu-hit-region:${item.id}`
      hitRegion.position.set(0, y, 0.008)
      hitRegion.userData['wristMenuItemId'] = item.id
      hitRegion.raycast = decorativeRaycast

      this.group.add(row, hitRegion)
      this.rowMeshes.push(row)
      this.hitRegions.push(hitRegion)
      this.visualMaterials.push(rowMaterial)
      this.resources.push(rowGeometry, rowMaterial, hitGeometry, hitMaterial)
    })
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.group.visible = model.visible
    this.setTargetable(targetable && model.visible)
    for (const material of this.visualMaterials) {
      material.opacity = model.opacity
      material.depthWrite = model.opacity >= 1
    }

    const itemById = new Map(model.items.map((item) => [item.id, item]))
    for (const row of this.rowMeshes) {
      const itemId = row.name.slice('wrist-menu-action-visual:'.length)
      const item = itemById.get(itemId)
      const material = row.material as MeshBasicMaterial
      material.color.setHex(
        item?.interaction === 'armed'
          ? 0x2e7d61
          : item?.interaction === 'hovered'
            ? 0x1d4438
            : 0x102020,
      )
    }
  }

  setTargetable(targetable: boolean) {
    for (const hitRegion of this.hitRegions) {
      hitRegion.raycast = targetable ? interactiveRaycast : decorativeRaycast
    }
  }

  itemIdForIntersection(
    intersection: Intersection<Object3D<Object3DEventMap>> | undefined,
  ): string | undefined {
    const itemId = intersection?.object.userData['wristMenuItemId']
    return typeof itemId === 'string' ? itemId : undefined
  }

  dispose() {
    this.group.removeFromParent()
    for (const resource of this.resources) resource.dispose()
    this.resources.length = 0
    this.rowMeshes.length = 0
    this.hitRegions.length = 0
    this.visualMaterials.length = 0
    this.group.clear()
  }
}

type SelectEvent = Readonly<{ inputSource: XRInputSource }>

type AnchorSettings = Readonly<{
  activationMode: ActivationMode
  wrist: Handedness
  controllerWrist: ControllerWristConfiguration
}>

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

/** Create the vanilla Three.js Renderer Integration. */
export function createThreeWristMenu(
  options: CreateThreeWristMenuOptions,
): ThreeWristMenu {
  const runtime = createWristMenuRuntime({
    snapshot: options.snapshot,
    onEvent: options.onEvent,
  })
  const presentation = new WristMenuPresentation(options.snapshot)
  const raycaster = new Raycaster()
  const rayMatrix = new Matrix4()
  const rayOrigin = new Vector3()
  const rayDirection = new Vector3()
  const anchorMatrix = new Matrix4()
  const parentInverse = new Matrix4()
  const anchorPosition = new Vector3()
  const anchorOrientation = new Quaternion()
  const anchorScale = new Vector3(1, 1, 1)
  const sourceIds = new WeakMap<XRInputSource, string>()
  let anchorSettings = materializeAnchorSettings(options.snapshot)
  let pendingAnchorSettings: AnchorSettings | undefined
  let sourcePressed = new WeakMap<XRInputSource, boolean>()
  let sourceCompleted = new WeakSet<XRInputSource>()
  let lastTargetBySource = new WeakMap<XRInputSource, string>()
  let provisionalClaims = new WeakSet<XRInputSource>()
  let inputSourceSequence = 0
  let frameSequence = 0
  let geometryBarrierThrough = 1
  let presentationRevision = 1
  let session: XRSession | null = null
  let referenceSpace: XRReferenceSpace | null = null
  let lifecycleRevision = 0
  let observedSession = false
  let observedParent = false
  let lastParent: Object3D<Object3DEventMap> | null = null
  let lastUpdateTime = 0
  let disposed = false

  const clearTransientInput = () => {
    sourcePressed = new WeakMap()
    sourceCompleted = new WeakSet()
    lastTargetBySource = new WeakMap()
    provisionalClaims = new WeakSet()
  }

  const interruptLifecycle = () => {
    lifecycleRevision += 1
    clearTransientInput()
  }

  const sourceId = (inputSource: XRInputSource) => {
    const existing = sourceIds.get(inputSource)
    if (existing !== undefined) return existing
    inputSourceSequence += 1
    const created = `input-source-${inputSourceSequence}`
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
  const applyLifecycleSample = (
    visibility: 'visible-blurred' | 'hidden',
  ) => {
    presentation.setTargetable(false)
    if (visibility === 'hidden') presentation.group.visible = false
    frameSequence += 1
    const model = runtime.step(
      {
        sequence: frameSequence,
        time: lastUpdateTime,
        visibility,
        viewerPosition: null,
        wristSources: [],
        lifecycleRevision,
        selectionSources: [],
      },
      [],
    )
    presentation.setModel(model, false)
  }
  const onSessionEnd = () => {
    attachSession(null)
    applyLifecycleSample('hidden')
  }
  const onSessionVisibilityChange = () => {
    interruptLifecycle()
    if (session?.visibilityState === 'visible-blurred') {
      applyLifecycleSample('visible-blurred')
    } else if (session?.visibilityState === 'hidden') {
      applyLifecycleSample('hidden')
    }
  }
  const onInputSourcesChange = () => {
    interruptLifecycle()
    applyLifecycleSample('hidden')
  }
  const onReferenceSpaceReset = () => {
    interruptLifecycle()
    applyLifecycleSample('hidden')
  }

  const attachSession = (nextSession: XRSession | null) => {
    if (session === nextSession) return
    if (session !== null) {
      session.removeEventListener('selectstart', onSelectStart)
      session.removeEventListener('select', onSelect)
      session.removeEventListener('selectend', onSelectEnd)
      session.removeEventListener('inputsourceschange', onInputSourcesChange)
      session.removeEventListener('visibilitychange', onSessionVisibilityChange)
      session.removeEventListener('end', onSessionEnd)
    }
    if (observedSession) interruptLifecycle()
    session = nextSession
    observedSession = true
    if (session !== null) {
      session.addEventListener('selectstart', onSelectStart)
      session.addEventListener('select', onSelect)
      session.addEventListener('selectend', onSelectEnd)
      session.addEventListener('inputsourceschange', onInputSourcesChange)
      session.addEventListener('visibilitychange', onSessionVisibilityChange)
      session.addEventListener('end', onSessionEnd)
    }
  }

  const attachReferenceSpace = (nextReferenceSpace: XRReferenceSpace | null) => {
    if (referenceSpace === nextReferenceSpace) return
    referenceSpace?.removeEventListener('reset', onReferenceSpaceReset)
    if (referenceSpace !== null) interruptLifecycle()
    referenceSpace = nextReferenceSpace
    referenceSpace?.addEventListener('reset', onReferenceSpaceReset)
  }

  const poseSample = (pose: XRPose | XRJointPose): PoseSample =>
    Object.freeze({
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

  const applyAnchorPose = (pose: PresentationModel['anchorPose']) => {
    if (pose === null) return
    anchorPosition.fromArray(pose.position)
    anchorOrientation.fromArray(pose.orientation)
    anchorMatrix.compose(anchorPosition, anchorOrientation, anchorScale)
    const parent = presentation.group.parent
    if (parent !== null) {
      parent.updateWorldMatrix(true, false)
      parentInverse.copy(parent.matrixWorld).invert()
      anchorMatrix.premultiply(parentInverse)
    }
    anchorMatrix.decompose(
      presentation.group.position,
      presentation.group.quaternion,
      presentation.group.scale,
    )
  }

  const assertActive = () => {
    if (disposed) throw new Error('Wrist Menu Instance is disposed')
  }

  return Object.freeze({
    group: presentation.group,

    sync(nextSnapshot) {
      assertActive()
      runtime.sync(nextSnapshot)
      pendingAnchorSettings = materializeAnchorSettings(nextSnapshot)
    },

    update({ time, frame }) {
      assertActive()
      lastUpdateTime = time
      frameSequence += 1
      if (pendingAnchorSettings !== undefined) {
        anchorSettings = pendingAnchorSettings
        pendingAnchorSettings = undefined
      }
      const nextSession = options.renderer.xr.getSession()
      attachSession(nextSession)

      const parent = presentation.group.parent
      if (observedParent && parent !== lastParent) interruptLifecycle()
      lastParent = parent
      observedParent = true

      const isGeometryTargetable = frameSequence > geometryBarrierThrough
      presentation.group.updateMatrixWorld(true)

      const selectionSources: ControllerSelectionSourceSample[] = []
      const wristSources: WristSourceSample[] = []
      const controllerSources: Array<
        Readonly<{ id: string; inputSource: XRInputSource }>
      > = []
      const targetObservations: TargetObservation[] = []
      const nextReferenceSpace = options.renderer.xr.getReferenceSpace()
      attachReferenceSpace(nextReferenceSpace)
      let viewerPosition: Vector3Tuple | null = null

      if (frame !== null && nextSession !== null && nextReferenceSpace !== null) {
        const viewerPose = frame.getViewerPose(nextReferenceSpace)
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

          const id = sourceId(inputSource)
          if (inputSource.hand != null) {
            const wristSpace = inputSource.hand.get('wrist')
            const wristPose =
              wristSpace === undefined
                ? null
                : (frame.getJointPose?.(wristSpace, nextReferenceSpace) ?? null)
            wristSources.push({
              id,
              kind: 'hand',
              handedness: inputSource.handedness,
              pose: wristPose === null ? null : poseSample(wristPose),
            })
            continue
          }

          const gripPose =
            inputSource.gripSpace == null
              ? null
              : frame.getPose(inputSource.gripSpace, nextReferenceSpace)
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
            selectPressed: sourcePressed.get(inputSource) ?? false,
            selectCompleted: sourceCompleted.has(inputSource),
          })
          controllerSources.push({ id, inputSource })
        }

        const wristSource = wristSources
          .filter((source) => source.handedness === anchorSettings.wrist)
          .sort(
            (left, right) =>
              Number(left.kind === 'controller') -
              Number(right.kind === 'controller'),
          )[0]
        const currentAnchor =
          wristSource === undefined
            ? undefined
            : resolveWristAnchor(
                wristSource,
                viewerPosition,
                anchorSettings.controllerWrist,
              )
        if (
          currentAnchor !== undefined &&
          (anchorSettings.activationMode !== 'automatic' ||
            currentAnchor.automaticEligible)
        ) {
          applyAnchorPose(currentAnchor.anchorPose)
        }
        presentation.group.updateMatrixWorld(true)

        for (const { id, inputSource } of controllerSources) {
          const pose = frame.getPose(inputSource.targetRaySpace, nextReferenceSpace)
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
            nextSession === null || nextSession.visibilityState === 'hidden'
              ? 'hidden'
              : nextSession?.visibilityState === 'visible-blurred'
                ? 'visible-blurred'
                : 'visible',
          viewerPosition,
          wristSources,
          lifecycleRevision,
          selectionSources,
        },
        targetObservations,
      )

      if (model.revision !== presentationRevision) {
        presentationRevision = model.revision
        presentation.renderItems({
          menuDefinition: model.items.map(({ interaction: _interaction, ...item }) => item),
        })
        geometryBarrierThrough = frameSequence
      }

      applyAnchorPose(model.anchorPose)
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
      disposed = true
      try {
        attachSession(null)
        attachReferenceSpace(null)
        runtime.dispose()
      } finally {
        presentation.dispose()
      }
    },
  })
}
