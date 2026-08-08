import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import type { Intersection } from 'three/src/core/Raycaster.js'
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import { Group } from 'three/src/objects/Group.js'

import type {
  HandTargetObservation,
  PresentationModel,
} from '../core/index.js'
import { WristMenuPresentation } from './wrist-menu-presentation.js'

const decorativeRaycast: Mesh['raycast'] = () => undefined
const interactiveRaycast = Mesh.prototype.raycast

/** One presentation-declared, oriented-box target for one interactive row. */
export type ThreeWristMenuHitRegion = Readonly<{
  itemId: string
  /** Must be a Mesh backed by BoxGeometry; validated after every update. */
  object: Mesh<BoxGeometry>
}>

/** The oriented-box surface used to derive continuous scroll observations. */
export type ThreeWristMenuScrollRegion = Readonly<{
  /** Must be a Mesh backed by BoxGeometry; validated when created. */
  object: Mesh<BoxGeometry>
}>

/**
 * One disposable Three.js realization of the curated Presentation Model.
 * Selection behavior remains package-owned; the presentation declares geometry
 * but never receives XR objects, callbacks, or core runtime state.
 */
export type ThreeWristMenuPresentation = Readonly<{
  root: Object3D<Object3DEventMap>
  hitRegions: readonly ThreeWristMenuHitRegion[]
  scrollRegion: ThreeWristMenuScrollRegion
  update(model: PresentationModel): void
  dispose(): void
}>

/** Synchronous, shared replacement seam used by both Three.js and React. */
export type ThreeWristMenuPresentationFactory = (
  model: PresentationModel,
) => ThreeWristMenuPresentation

/** The self-contained default Command slab factory. */
export const defaultThreeWristMenuPresentationFactory: ThreeWristMenuPresentationFactory =
  (initialModel) => {
    const presentation = new WristMenuPresentation()
    presentation.group.name = 'wrist-menu-default-presentation-root'
    presentation.setModel(initialModel, false)
    return {
      root: presentation.group,
      get hitRegions() {
        return presentation.hitRegions.flatMap((object) => {
          const itemId = object.userData['wristMenuItemId']
          return object.visible && typeof itemId === 'string'
            ? [{ itemId, object: object as Mesh<BoxGeometry> }]
            : []
        })
      },
      scrollRegion: {
        object: presentation.panelMesh as Mesh<BoxGeometry>,
      },
      update(model) {
        presentation.setModel(model, false)
      },
      dispose() {
        presentation.dispose()
      },
    }
  }

function isObject3D(value: unknown): value is Object3D<Object3DEventMap> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isObject3D?: unknown }).isObject3D === true
  )
}

function isBoxMesh(value: unknown): value is Mesh<BoxGeometry> {
  const geometry = (value as { geometry?: unknown } | null)?.geometry as
    | {
        type?: unknown
        parameters?: { width?: unknown; height?: unknown; depth?: unknown }
      }
    | undefined
  const dimensions = geometry?.parameters
  return (
    isObject3D(value) &&
    (value as { isMesh?: unknown }).isMesh === true &&
    geometry?.type === 'BoxGeometry' &&
    dimensions !== undefined &&
    [dimensions.width, dimensions.height, dimensions.depth].every(
      (dimension) =>
        typeof dimension === 'number' &&
        Number.isFinite(dimension) &&
        dimension > 0,
    )
  )
}

function isDescendant(
  object: Object3D<Object3DEventMap>,
  root: Object3D<Object3DEventMap>,
): boolean {
  let current: Object3D<Object3DEventMap> | null = object
  while (current !== null) {
    if (current === root) return true
    current = current.parent
  }
  return false
}

function assertPresentation(
  value: ThreeWristMenuPresentation,
): ThreeWristMenuPresentation {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Presentation factory must return an object')
  }
  if (!isObject3D(value.root)) {
    throw new TypeError('Presentation root must be a Three.js Object3D')
  }
  if (typeof value.update !== 'function' || typeof value.dispose !== 'function') {
    throw new TypeError('Presentation must provide update() and dispose()')
  }
  if (!isBoxMesh(value.scrollRegion?.object)) {
    throw new TypeError('Presentation scrollRegion must declare a BoxGeometry Mesh')
  }
  if (!isDescendant(value.scrollRegion.object, value.root)) {
    throw new TypeError('Presentation scrollRegion must belong to its root')
  }
  return value
}

function createPresentation(
  factory: ThreeWristMenuPresentationFactory,
  model: PresentationModel,
): ThreeWristMenuPresentation {
  const candidate = factory(model)
  try {
    return assertPresentation(candidate)
  } catch (error) {
    try {
      candidate?.dispose?.()
    } catch {
      // Preserve the contract error that made this presentation unusable.
    }
    throw error
  }
}

function interactiveItemIds(model: PresentationModel): Set<string> {
  const ids = new Set<string>()
  for (const item of model.items) {
    if (item.type === 'action' || item.type === 'toggle') ids.add(item.id)
    if (item.type === 'choice-group') {
      for (const option of item.options) ids.add(option.id)
    }
  }
  return ids
}

/** Package-owned stable attachment and hit-testing adapter around one factory result. */
export class ManagedWristMenuPresentation {
  readonly group = new Group()
  private instance: ThreeWristMenuPresentation
  private declarations: readonly ThreeWristMenuHitRegion[] = []
  private readonly fingertipLocalPosition = new Vector3()
  private readonly worldScale = new Vector3()

  constructor(
    initialModel: PresentationModel,
    factory: ThreeWristMenuPresentationFactory,
  ) {
    this.group.name = 'wrist-menu-attachment-root'
    this.instance = createPresentation(factory, initialModel)
    this.group.add(this.instance.root)
    try {
      this.applyModel(initialModel, false)
    } catch (error) {
      this.instance.root.removeFromParent()
      try {
        this.instance.dispose()
      } catch {
        // Preserve the contract error that made this presentation unusable.
      }
      this.group.clear()
      throw error
    }
  }

  get hitRegions(): readonly Mesh<BoxGeometry>[] {
    return this.declarations.map(({ object }) => object)
  }

  get panelMesh(): Mesh<BoxGeometry> {
    return this.instance.scrollRegion.object as Mesh<BoxGeometry>
  }

  private declarationsFor(
    instance: ThreeWristMenuPresentation,
    model: PresentationModel,
  ): readonly ThreeWristMenuHitRegion[] {
    if (!Array.isArray(instance.hitRegions)) {
      throw new TypeError('Presentation hitRegions must be an array')
    }
    const validItemIds = interactiveItemIds(model)
    const declaredItemIds = new Set<string>()
    const declaredObjects = new Set<Object3D>()
    const declarations = [...instance.hitRegions]
    for (const declaration of declarations) {
      if (
        typeof declaration !== 'object' ||
        declaration === null ||
        typeof declaration.itemId !== 'string' ||
        declaration.itemId.trim() === ''
      ) {
        throw new TypeError('Each Hit Region must declare a non-empty itemId')
      }
      if (!validItemIds.has(declaration.itemId)) {
        throw new TypeError(
          `Hit Region references an unknown Menu Item: ${declaration.itemId}`,
        )
      }
      if (!isBoxMesh(declaration.object)) {
        throw new TypeError(
          `Hit Region ${declaration.itemId} must declare a BoxGeometry Mesh`,
        )
      }
      if (!isDescendant(declaration.object, instance.root)) {
        throw new TypeError(
          `Hit Region ${declaration.itemId} must belong to the presentation root`,
        )
      }
      if (declaredItemIds.has(declaration.itemId)) {
        throw new TypeError(
          `Interactive Menu Item has multiple Hit Regions: ${declaration.itemId}`,
        )
      }
      if (declaredObjects.has(declaration.object)) {
        throw new TypeError('One Hit Region Mesh cannot target multiple Menu Items')
      }
      declaredItemIds.add(declaration.itemId)
      declaredObjects.add(declaration.object)
    }
    return Object.freeze(
      declarations.map(({ itemId, object }) =>
        Object.freeze({ itemId, object }),
      ),
    )
  }

  private refreshDeclarations(model: PresentationModel): void {
    this.declarations = this.declarationsFor(this.instance, model)
  }

  private configureTargetability(
    model: PresentationModel,
    targetable: boolean,
  ): void {
    this.group.visible = model.visible
    this.instance.root.traverse((object) => {
      if ((object as { isMesh?: unknown }).isMesh === true) {
        ;(object as Mesh).raycast = decorativeRaycast
      }
    })
    for (const { object } of this.declarations) {
      object.raycast =
        targetable && model.visible && !model.scrollBarrierActive && object.visible
          ? interactiveRaycast
          : decorativeRaycast
    }
    this.panelMesh.raycast =
      targetable && model.visible && this.panelMesh.visible
        ? interactiveRaycast
        : decorativeRaycast
  }

  applyModel(model: PresentationModel, targetable: boolean): void {
    this.instance.update(model)
    this.refreshDeclarations(model)
    this.configureTargetability(model, targetable)
  }

  setTargetable(targetable: boolean): void {
    for (const { object } of this.declarations) {
      object.raycast = targetable && object.visible
        ? interactiveRaycast
        : decorativeRaycast
    }
    this.panelMesh.raycast =
      targetable && this.panelMesh.visible
        ? interactiveRaycast
        : decorativeRaycast
  }

  itemIdForIntersection(
    intersection: Intersection<Object3D<Object3DEventMap>> | undefined,
  ): string | undefined {
    return this.declarations.find(({ object }) => object === intersection?.object)
      ?.itemId
  }

  fingertipObservation(
    worldPosition: Vector3,
    radius: number,
  ): Omit<HandTargetObservation, 'sourceId'> | undefined {
    if (!Number.isFinite(radius) || radius <= 0) return undefined
    for (const { itemId, object } of this.declarations) {
      if (!object.visible) continue
      object.updateWorldMatrix(true, false)
      object.getWorldScale(this.worldScale)
      if (
        this.worldScale.x === 0 ||
        this.worldScale.y === 0 ||
        this.worldScale.z === 0
      ) {
        continue
      }
      this.fingertipLocalPosition.copy(worldPosition)
      object.worldToLocal(this.fingertipLocalPosition)
      const { width, height, depth } = (object.geometry as BoxGeometry).parameters
      const halfWidth = width / 2
      const halfHeight = height / 2
      const halfDepth = depth / 2
      const localRadiusX = radius / Math.abs(this.worldScale.x)
      const localRadiusY = radius / Math.abs(this.worldScale.y)
      const localRadiusZ = radius / Math.abs(this.worldScale.z)
      if (
        Math.abs(this.fingertipLocalPosition.x) > halfWidth + localRadiusX ||
        Math.abs(this.fingertipLocalPosition.y) > halfHeight + localRadiusY
      ) {
        continue
      }
      const nearestSurface = this.fingertipLocalPosition.z - localRadiusZ
      const farthestSurface = this.fingertipLocalPosition.z + localRadiusZ
      if (nearestSurface > halfDepth + 0.025 || farthestSurface < -halfDepth) {
        continue
      }
      return {
        kind: 'hand-fingertip',
        itemId,
        phase: nearestSurface <= halfDepth + 1e-9 ? 'pressed' : 'hover',
      }
    }
    return undefined
  }

  panelLocalY(worldPosition: Vector3): number | null {
    const panel = this.panelMesh
    panel.updateWorldMatrix(true, false)
    panel.getWorldScale(this.worldScale)
    if (this.worldScale.x === 0 || this.worldScale.y === 0) return null
    this.fingertipLocalPosition.copy(worldPosition)
    panel.worldToLocal(this.fingertipLocalPosition)
    const { width, height } = panel.geometry.parameters
    if (
      Math.abs(this.fingertipLocalPosition.x) >
        width / 2 + 0.02 / Math.abs(this.worldScale.x) ||
      Math.abs(this.fingertipLocalPosition.y) >
        height / 2 + 0.02 / Math.abs(this.worldScale.y)
    ) {
      return null
    }
    return this.fingertipLocalPosition.y * Math.abs(this.worldScale.y)
  }

  replace(
    factory: ThreeWristMenuPresentationFactory,
    model: PresentationModel,
  ): void {
    const next = createPresentation(factory, model)
    let nextDeclarations: readonly ThreeWristMenuHitRegion[]
    try {
      next.update(model)
      nextDeclarations = this.declarationsFor(next, model)
    } catch (error) {
      try {
        next.dispose()
      } catch {
        // Preserve the contract error that made this presentation unusable.
      }
      throw error
    }
    const previous = this.instance
    this.setTargetable(false)
    previous.root.removeFromParent()
    this.instance = next
    this.declarations = nextDeclarations
    this.group.add(next.root)
    try {
      previous.dispose()
    } finally {
      this.configureTargetability(model, false)
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    try {
      this.instance.root.removeFromParent()
      this.instance.dispose()
    } finally {
      this.declarations = []
      this.group.clear()
    }
  }
}
