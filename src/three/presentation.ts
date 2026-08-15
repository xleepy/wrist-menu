import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import type { Intersection } from 'three/src/core/Raycaster.js'
import type { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import { Group } from 'three/src/objects/Group.js'

import type {
  HandTargetObservation,
  PresentationModel,
  PresentationChoiceOption,
  PresentationItem,
  ThemeTokens,
} from '../core/index.js'
import {
  createOrientedBoxScratch,
  isOrientedBoxMesh,
  observeFingertipInOrientedBox,
  orientedBoxLocalY,
} from './oriented-box.js'
import { WristMenuPresentation } from './wrist-menu-presentation.js'

const decorativeRaycast: Mesh['raycast'] = () => undefined
const interactiveRaycast = Mesh.prototype.raycast

/** One presentation-declared, oriented-box target for one interactive row. */
export type ThreeWristMenuHitRegion = Readonly<{
  itemId: string
  /** Must be a Mesh backed by BoxGeometry; validated after every update. */
  object: Mesh<BoxGeometry>
}>

/** The oriented-box Menu Viewport used to derive scroll observations. */
export type ThreeWristMenuViewport = Readonly<{
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
  menuViewport: ThreeWristMenuViewport
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
    const presentation = new WristMenuPresentation(initialModel)
    presentation.group.name = 'wrist-menu-default-presentation-root'
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
      menuViewport: {
        object: presentation.viewportMesh as Mesh<BoxGeometry>,
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
  if (!isOrientedBoxMesh(value.menuViewport?.object)) {
    throw new TypeError(
      'Presentation Menu Viewport must declare a BoxGeometry Mesh',
    )
  }
  if (!isDescendant(value.menuViewport.object, value.root)) {
    throw new TypeError('Presentation Menu Viewport must belong to its root')
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

function choiceOptionEqual(
  left: PresentationChoiceOption,
  right: PresentationChoiceOption,
): boolean {
  return (
    left.id === right.id &&
    left.groupId === right.groupId &&
    left.label === right.label &&
    left.iconKey === right.iconKey &&
    left.value === right.value &&
    left.selected === right.selected &&
    left.disabled === right.disabled &&
    left.disabledReason === right.disabledReason &&
    left.interaction === right.interaction
  )
}

function presentationItemEqual(
  left: PresentationItem,
  right: PresentationItem,
): boolean {
  if (left.type !== right.type) return false
  if (left.type === 'separator' && right.type === 'separator') {
    return left.id === right.id && left.label === right.label
  }
  if (left.type === 'choice-group' && right.type === 'choice-group') {
    if (
      left.id !== right.id ||
      left.label !== right.label ||
      left.selectedValue !== right.selectedValue ||
      left.options.length !== right.options.length
    ) {
      return false
    }
    for (let index = 0; index < left.options.length; index += 1) {
      if (!choiceOptionEqual(left.options[index]!, right.options[index]!)) {
        return false
      }
    }
    return true
  }
  if (
    (left.type !== 'action' && left.type !== 'toggle') ||
    (right.type !== 'action' && right.type !== 'toggle')
  ) {
    return false
  }
  if (
    left.id !== right.id ||
    left.label !== right.label ||
    left.iconKey !== right.iconKey ||
    left.disabled !== right.disabled ||
    left.disabledReason !== right.disabledReason ||
    left.interaction !== right.interaction
  ) {
    return false
  }
  return left.type === 'action' ||
    right.type === 'action'
    ? left.type === right.type
    : left.value === right.value && left.selected === right.selected
}

function presentationItemsEqual(
  left: readonly PresentationItem[],
  right: readonly PresentationItem[],
): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (!presentationItemEqual(left[index]!, right[index]!)) return false
  }
  return true
}

function themeEqual(left: ThemeTokens, right: ThemeTokens): boolean {
  return (
    left.panelWidthMeters === right.panelWidthMeters &&
    left.viewportHeightMeters === right.viewportHeightMeters &&
    left.panelColor === right.panelColor &&
    left.itemColor === right.itemColor &&
    left.selectedItemColor === right.selectedItemColor &&
    left.disabledItemColor === right.disabledItemColor &&
    left.hoveredItemColor === right.hoveredItemColor &&
    left.hoveredDisabledItemColor === right.hoveredDisabledItemColor &&
    left.armedItemColor === right.armedItemColor &&
    left.separatorColor === right.separatorColor &&
    left.groupHeaderColor === right.groupHeaderColor
  )
}

function anchorPoseEqual(
  left: PresentationModel['anchorPose'],
  right: PresentationModel['anchorPose'],
): boolean {
  if (left === null || right === null) return left === right
  return (
    left.position[0] === right.position[0] &&
    left.position[1] === right.position[1] &&
    left.position[2] === right.position[2] &&
    left.orientation[0] === right.orientation[0] &&
    left.orientation[1] === right.orientation[1] &&
    left.orientation[2] === right.orientation[2] &&
    left.orientation[3] === right.orientation[3]
  )
}

function presentationModelEqual(
  left: PresentationModel,
  right: PresentationModel,
): boolean {
  return (
    left.visible === right.visible &&
    left.targetable === right.targetable &&
    left.opacity === right.opacity &&
    left.revealPhase === right.revealPhase &&
    left.revision === right.revision &&
    left.scrollOffset === right.scrollOffset &&
    left.totalRows === right.totalRows &&
    left.visibleSlots === right.visibleSlots &&
    left.scrollOwned === right.scrollOwned &&
    left.scrollBarrierActive === right.scrollBarrierActive &&
    anchorPoseEqual(left.anchorPose, right.anchorPose) &&
    themeEqual(left.theme, right.theme) &&
    presentationItemsEqual(left.items, right.items)
  )
}

/** Package-owned stable attachment and hit-testing adapter around one factory result. */
export class ManagedWristMenuPresentation {
  readonly group = new Group()
  private instance: ThreeWristMenuPresentation
  private declarations: readonly ThreeWristMenuHitRegion[] = []
  private readonly orientedBoxScratch = createOrientedBoxScratch()
  private appliedModel: PresentationModel | undefined
  private appliedTargetable: boolean | undefined

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
    return this.instance.menuViewport.object as Mesh<BoxGeometry>
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
      if (!isOrientedBoxMesh(declaration.object)) {
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
    if (
      this.appliedModel !== undefined &&
      this.appliedTargetable === targetable &&
      presentationModelEqual(this.appliedModel, model)
    ) {
      return
    }
    this.instance.update(model)
    this.refreshDeclarations(model)
    this.configureTargetability(model, targetable)
    this.appliedModel = model
    this.appliedTargetable = targetable
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
    this.appliedTargetable = targetable
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
      const phase = observeFingertipInOrientedBox(
        object,
        worldPosition,
        radius,
        this.orientedBoxScratch,
      )
      if (phase === undefined) continue
      return {
        kind: 'hand-fingertip',
        itemId,
        phase,
      }
    }
    return undefined
  }

  panelLocalY(worldPosition: Vector3): number | null {
    return orientedBoxLocalY(
      this.panelMesh,
      worldPosition,
      0.02,
      this.orientedBoxScratch,
    )
  }

  replace(
    factory: ThreeWristMenuPresentationFactory,
    model: PresentationModel,
    beforeCommit: () => void,
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
    this.group.visible = false
    let beforeCommitError: unknown
    try {
      beforeCommit()
    } catch (error) {
      beforeCommitError = error
    }
    previous.root.removeFromParent()
    this.instance = next
    this.declarations = nextDeclarations
    this.group.add(next.root)
    try {
      previous.dispose()
    } finally {
      this.configureTargetability(model, false)
      this.appliedModel = model
      this.appliedTargetable = false
    }
    if (beforeCommitError !== undefined) throw beforeCommitError
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
