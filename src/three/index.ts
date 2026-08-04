import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
  type Intersection,
  type Object3D,
  type Object3DEventMap,
  type WebGLRenderer,
} from 'three'

import {
  createWristMenuRuntime,
  type ControllerSelectionSourceSample,
  type HostSnapshot,
  type PresentationModel,
  type TargetObservation,
  type WristMenuEvent,
} from '../core/index.js'

export {
  createWristMenuRuntime,
  wristMenuSessionFeatures,
  type ControllerSelectionSourceSample,
  type HostSnapshot,
  type PresentationModel,
  type TargetObservation,
  type WristMenuEvent,
  type WristMenuSessionFeatures,
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

class ControllerTracerPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly rowMeshes: Mesh[] = []

  constructor(snapshot: HostSnapshot) {
    this.group.name = 'wrist-menu-attachment-root'

    const panelGeometry = new BoxGeometry(0.192, 0.158, 0.004)
    const panelMaterial = new MeshBasicMaterial({ color: 0x081415 })
    const panel = new Mesh(panelGeometry, panelMaterial)
    panel.name = 'wrist-menu-command-slab'
    panel.position.z = -0.004
    panel.raycast = decorativeRaycast
    this.group.add(panel)
    this.resources.push(panelGeometry, panelMaterial)

    this.renderItems(snapshot)
  }

  renderItems(snapshot: Pick<HostSnapshot, 'menuDefinition'>) {
    for (const mesh of [...this.rowMeshes, ...this.hitRegions]) {
      mesh.removeFromParent()
    }
    for (const resource of this.resources.splice(2)) resource.dispose()
    this.rowMeshes.length = 0
    this.hitRegions.length = 0

    const rowCount = snapshot.menuDefinition.length
    snapshot.menuDefinition.forEach((item, index) => {
      const y = (rowCount - 1) * 0.01125 - index * 0.0225
      const rowGeometry = new BoxGeometry(0.176, 0.02, 0.003)
      const rowMaterial = new MeshBasicMaterial({ color: 0x102020 })
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
      this.resources.push(rowGeometry, rowMaterial, hitGeometry, hitMaterial)
    })
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.group.visible = model.visible
    this.setTargetable(targetable && model.visible)

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
    this.group.clear()
  }
}

type SelectEvent = Readonly<{ inputSource: XRInputSource }>

/** Create the vanilla Three.js Renderer Integration. */
export function createThreeWristMenu(
  options: CreateThreeWristMenuOptions,
): ThreeWristMenu {
  const runtime = createWristMenuRuntime({
    snapshot: options.snapshot,
    onEvent: options.onEvent,
  })
  const presentation = new ControllerTracerPresentation(options.snapshot)
  const raycaster = new Raycaster()
  const rayMatrix = new Matrix4()
  const rayOrigin = new Vector3()
  const rayDirection = new Vector3()
  const sourceIds = new WeakMap<XRInputSource, string>()
  const sourcePressed = new WeakMap<XRInputSource, boolean>()
  const lastTargetBySource = new WeakMap<XRInputSource, string>()
  const provisionalClaims = new WeakSet<XRInputSource>()
  let sourceSequence = 0
  let frameSequence = 0
  let geometryBarrierThrough = 1
  let presentationRevision = 1
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
    if (lastTargetBySource.has(event.inputSource)) {
      provisionalClaims.add(event.inputSource)
    }
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
        presentation.renderItems({
          menuDefinition: model.items.map(({ interaction: _interaction, ...item }) => item),
        })
        geometryBarrierThrough = frameSequence
      }

      presentation.setModel(
        model,
        model.targetable && frameSequence > geometryBarrierThrough,
      )

      for (const inputSource of nextSession?.inputSources ?? []) {
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
