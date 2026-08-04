import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import { type Intersection } from 'three/src/core/Raycaster.js'
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { MeshBasicMaterial } from 'three/src/materials/MeshBasicMaterial.js'
import { Group } from 'three/src/objects/Group.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import { Vector3 } from 'three/src/math/Vector3.js'

import type {
  PresentationActionItem,
  PresentationChoiceOption,
  PresentationItem,
  PresentationModel,
  PresentationToggleItem,
  HandTargetObservation,
} from '../core/index.js'
import { VISIBLE_SLOTS } from '../core/scroll-state.js'

const decorativeRaycast: Mesh['raycast'] = () => undefined
const interactiveRaycast = Mesh.prototype.raycast

type InteractivePresentationItem =
  | PresentationActionItem
  | PresentationToggleItem
  | PresentationChoiceOption

type PresentationRow =
  | InteractivePresentationItem
  | Readonly<{
      type: 'choice-group'
      id: string
      label: string
      selectedValue: string | number
    }>
  | Readonly<{
      type: 'separator'
      id: string
      label?: string
    }>

function rowsFor(items: readonly PresentationItem[]): readonly PresentationRow[] {
  const rows: PresentationRow[] = []
  items.forEach((item, index) => {
    if (item.type === 'choice-group') {
      rows.push({
        type: 'choice-group',
        id: item.id,
        label: item.label,
        selectedValue: item.selectedValue,
      })
      rows.push(...item.options)
    } else if (item.type === 'separator') {
      rows.push({
        type: 'separator',
        id: item.id ?? `separator-${index}`,
        ...(item.label === undefined ? {} : { label: item.label }),
      })
    } else {
      rows.push(item)
    }
  })
  return rows
}

function baseColor(item: InteractivePresentationItem): number {
  if (item.disabled) return 0x273031
  if (item.type === 'toggle' && item.selected) return 0x245345
  if (item.type === 'choice' && item.selected) return 0x245345
  return 0x102020
}

const POOL_SIZE = VISIBLE_SLOTS + 1
const ROW_HEIGHT = 0.02
const SEPARATOR_HEIGHT = 0.009
const ROW_SPACING = 0.0225
const PANEL_WIDTH = 0.192
const PANEL_HEIGHT = 0.27
const PANEL_DEPTH = 0.004
const ROW_WIDTH = 0.176
const ROW_DEPTH = 0.003
const HIT_DEPTH = 0.008
const HIT_Z = 0.008

type PoolSlot = {
  rowMesh: Mesh
  hitMesh: Mesh
  rowMaterial: MeshBasicMaterial
  hitMaterial: MeshBasicMaterial
  boundRow: PresentationRow | null
  boundItemId: string | null
}

export class WristMenuPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  readonly panelMesh: Mesh
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly slots: PoolSlot[] = []
  private readonly visualMaterials: MeshBasicMaterial[] = []
  private readonly fingertipLocalPosition = new Vector3()
  private allRows: readonly PresentationRow[] = []
  private scrollOffset = 0

  constructor() {
    this.group.name = 'wrist-menu-attachment-root'

    const panelGeometry = new BoxGeometry(PANEL_WIDTH, PANEL_HEIGHT, PANEL_DEPTH)
    const panelMaterial = new MeshBasicMaterial({
      color: 0x081415,
      transparent: true,
    })
    const panel = new Mesh(panelGeometry, panelMaterial)
    panel.name = 'wrist-menu-command-slab'
    panel.position.z = -0.004
    panel.raycast = decorativeRaycast
    this.panelMesh = panel
    this.group.add(panel)
    this.resources.push(panelGeometry, panelMaterial)
    this.visualMaterials.push(panelMaterial)

    for (let i = 0; i < POOL_SIZE; i++) {
      const rowGeometry = new BoxGeometry(ROW_WIDTH, ROW_HEIGHT, ROW_DEPTH)
      const rowMaterial = new MeshBasicMaterial({ transparent: true })
      const rowMesh = new Mesh(rowGeometry, rowMaterial)
      rowMesh.raycast = decorativeRaycast
      rowMesh.visible = false
      this.group.add(rowMesh)
      this.resources.push(rowGeometry, rowMaterial)
      this.visualMaterials.push(rowMaterial)

      const hitGeometry = new BoxGeometry(ROW_WIDTH, ROW_HEIGHT, HIT_DEPTH)
      const hitMaterial = new MeshBasicMaterial({ visible: false })
      const hitMesh = new Mesh(hitGeometry, hitMaterial)
      hitMesh.raycast = decorativeRaycast
      hitMesh.visible = false
      this.group.add(hitMesh)
      this.resources.push(hitGeometry, hitMaterial)
      this.hitRegions.push(hitMesh)

      this.slots.push({
        rowMesh,
        hitMesh,
        rowMaterial,
        hitMaterial,
        boundRow: null,
        boundItemId: null,
      })
    }
  }

  renderItems(items: readonly PresentationItem[]) {
    this.allRows = rowsFor(items)
    this.rebindPool()
  }

  setScrollOffset(offset: number) {
    if (this.scrollOffset === offset) return
    this.scrollOffset = offset
    this.rebindPool()
  }

  private rebindPool() {
    const rows = this.allRows
    const startRow = Math.floor(this.scrollOffset)
    const fractionalOffset = this.scrollOffset - startRow

    for (let slotIndex = 0; slotIndex < POOL_SIZE; slotIndex++) {
      const slot = this.slots[slotIndex]!
      const rowIndex = startRow + slotIndex

      if (rowIndex >= rows.length) {
        slot.rowMesh.visible = false
        slot.hitMesh.visible = false
        slot.boundRow = null
        slot.boundItemId = null
        continue
      }

      const row = rows[rowIndex]!
      const isSeparator = row.type === 'separator'
      const rowHeight = isSeparator ? SEPARATOR_HEIGHT : ROW_HEIGHT
      const visibleCount = Math.min(rows.length, VISIBLE_SLOTS)
      const y = (visibleCount - 1) * (ROW_SPACING / 2) - slotIndex * ROW_SPACING + fractionalOffset * ROW_SPACING

      slot.rowMesh.visible = true
      slot.rowMesh.position.set(0, y, 0.001)
      slot.rowMesh.name = `wrist-menu-${row.type}-visual:${row.id}`
      slot.rowMesh.userData['wristMenuItemType'] = row.type
      slot.rowMesh.userData['wristMenuLabel'] = row.label
      slot.rowMesh.userData['wristMenuIconKey'] =
        'iconKey' in row ? row.iconKey : undefined
      slot.rowMesh.userData['wristMenuValue'] =
        row.type === 'toggle' || row.type === 'choice'
          ? row.value
          : row.type === 'choice-group'
            ? row.selectedValue
            : undefined

      if (row.type === 'separator') {
        slot.rowMaterial.color.setHex(0x355153)
      } else if (row.type === 'choice-group') {
        slot.rowMaterial.color.setHex(0x183132)
      } else {
        slot.rowMaterial.color.setHex(baseColor(row))
      }

      const scaleY = rowHeight / ROW_HEIGHT
      slot.rowMesh.scale.set(1, scaleY, 1)

      slot.boundRow = row
      slot.boundItemId = row.type !== 'separator' && row.type !== 'choice-group' ? row.id : null

      if (row.type === 'separator' || row.type === 'choice-group') {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        continue
      }

      const interactiveRow = row as InteractivePresentationItem
      const fullyVisible = y >= -PANEL_HEIGHT / 2 + rowHeight / 2 - 0.001 &&
                           y <= PANEL_HEIGHT / 2 - rowHeight / 2 + 0.001

      if (fullyVisible) {
        slot.hitMesh.visible = true
        slot.hitMesh.position.set(0, y, HIT_Z)
        slot.hitMesh.userData['wristMenuItemId'] = interactiveRow.id
        slot.hitMesh.userData['wristMenuDisabled'] = interactiveRow.disabled
        slot.hitMesh.userData['wristMenuSelected'] =
          interactiveRow.type === 'toggle' || interactiveRow.type === 'choice' ? interactiveRow.selected : false
        slot.hitMesh.userData['wristMenuDisabledReason'] = interactiveRow.disabledReason
      } else {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
      }
    }
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.group.visible = model.visible
    this.setTargetable(targetable && model.visible && !model.scrollBarrierActive)
    for (const material of this.visualMaterials) {
      material.opacity = model.opacity
      material.depthWrite = model.opacity >= 1
    }

    this.setScrollOffset(model.scrollOffset)

    const interactiveItems = this.allRows.filter(
      (item): item is InteractivePresentationItem =>
        item.type === 'action' || item.type === 'toggle' || item.type === 'choice',
    )
    const itemById = new Map(interactiveItems.map((item) => [item.id, item]))

    for (const slot of this.slots) {
      if (slot.boundItemId === null) continue
      const item = itemById.get(slot.boundItemId)
      if (item === undefined) continue
      slot.rowMaterial.color.setHex(
        item.interaction === 'armed'
          ? 0x2e7d61
          : item.interaction === 'hovered'
            ? item.disabled
              ? 0x3f4849
              : 0x1d4438
            : baseColor(item),
      )
      slot.rowMesh.userData['wristMenuSelected'] =
        item.type === 'toggle' || item.type === 'choice' ? item.selected : false
      slot.rowMesh.userData['wristMenuValue'] =
        item.type === 'toggle' || item.type === 'choice' ? item.value : undefined
      slot.rowMesh.userData['wristMenuDisabledReason'] = item.disabledReason
    }
  }

  setTargetable(targetable: boolean) {
    for (const hitRegion of this.hitRegions) {
      if (hitRegion.visible) {
        hitRegion.raycast = targetable ? interactiveRaycast : decorativeRaycast
      }
    }
  }

  itemIdForIntersection(
    intersection: Intersection<Object3D<Object3DEventMap>> | undefined,
  ): string | undefined {
    const itemId = intersection?.object.userData['wristMenuItemId']
    return typeof itemId === 'string' ? itemId : undefined
  }

  fingertipObservation(
    worldPosition: Vector3,
    radius: number,
  ): Omit<HandTargetObservation, 'sourceId'> | undefined {
    if (!Number.isFinite(radius) || radius <= 0) return undefined
    for (const hitRegion of this.hitRegions) {
      if (!hitRegion.visible) continue
      hitRegion.updateWorldMatrix(true, false)
      this.fingertipLocalPosition.copy(worldPosition)
      hitRegion.worldToLocal(this.fingertipLocalPosition)
      const geometry = hitRegion.geometry as BoxGeometry
      const halfWidth = geometry.parameters.width / 2
      const halfHeight = geometry.parameters.height / 2
      const halfDepth = geometry.parameters.depth / 2
      if (
        Math.abs(this.fingertipLocalPosition.x) > halfWidth + radius ||
        Math.abs(this.fingertipLocalPosition.y) > halfHeight + radius
      ) {
        continue
      }
      const nearestSurface = this.fingertipLocalPosition.z - radius
      const farthestSurface = this.fingertipLocalPosition.z + radius
      if (
        nearestSurface > halfDepth + 0.025 ||
        farthestSurface < -halfDepth
      ) {
        continue
      }
      const itemId = hitRegion.userData['wristMenuItemId']
      if (typeof itemId !== 'string') continue
      return {
        kind: 'hand-fingertip',
        itemId,
        phase: nearestSurface <= halfDepth + 1e-9 ? 'pressed' : 'hover',
      }
    }
    return undefined
  }

  panelLocalY(worldPosition: Vector3): number | null {
    this.panelMesh.updateWorldMatrix(true, false)
    this.fingertipLocalPosition.copy(worldPosition)
    this.panelMesh.worldToLocal(this.fingertipLocalPosition)
    const halfWidth = PANEL_WIDTH / 2
    const halfHeight = PANEL_HEIGHT / 2
    if (
      Math.abs(this.fingertipLocalPosition.x) > halfWidth + 0.02 ||
      Math.abs(this.fingertipLocalPosition.y) > halfHeight + 0.02
    ) {
      return null
    }
    return this.fingertipLocalPosition.y
  }

  dispose() {
    this.group.removeFromParent()
    for (const resource of this.resources) resource.dispose()
    this.resources.length = 0
    this.slots.length = 0
    this.hitRegions.length = 0
    this.visualMaterials.length = 0
    this.allRows = []
    this.group.clear()
  }
}
