import type {
  Object3D,
  Object3DEventMap,
} from 'three/src/core/Object3D.js'
import { type Intersection } from 'three/src/core/Raycaster.js'
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { MeshBasicMaterial } from 'three/src/materials/MeshBasicMaterial.js'
import { Group } from 'three/src/objects/Group.js'
import { Mesh } from 'three/src/objects/Mesh.js'

import type {
  PresentationActionItem,
  PresentationChoiceOption,
  PresentationItem,
  PresentationModel,
  PresentationToggleItem,
} from '../core/index.js'

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

export class WristMenuPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly rowMeshes: Mesh[] = []
  private readonly visualMaterials: MeshBasicMaterial[] = []

  constructor() {
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
  }

  renderItems(items: readonly PresentationItem[]) {
    for (const mesh of [...this.rowMeshes, ...this.hitRegions]) {
      mesh.removeFromParent()
    }
    for (const resource of this.resources.splice(2)) resource.dispose()
    this.rowMeshes.length = 0
    this.hitRegions.length = 0
    this.visualMaterials.length = 1

    const rows = rowsFor(items)
    rows.forEach((item, index) => {
      const isSeparator = item.type === 'separator'
      const rowHeight = isSeparator ? 0.009 : 0.02
      const y = (rows.length - 1) * 0.01125 - index * 0.0225
      const rowGeometry = new BoxGeometry(0.176, rowHeight, 0.003)
      const rowMaterial = new MeshBasicMaterial({
        color:
          item.type === 'separator'
            ? 0x355153
            : item.type === 'choice-group'
              ? 0x183132
              : baseColor(item),
        transparent: true,
      })
      const row = new Mesh(rowGeometry, rowMaterial)
      row.name = `wrist-menu-${item.type}-visual:${item.id}`
      row.position.set(0, y, 0.001)
      row.raycast = decorativeRaycast
      row.userData['wristMenuItemType'] = item.type
      row.userData['wristMenuLabel'] = item.label
      row.userData['wristMenuIconKey'] =
        'iconKey' in item ? item.iconKey : undefined
      row.userData['wristMenuValue'] =
        item.type === 'toggle' || item.type === 'choice'
          ? item.value
          : item.type === 'choice-group'
            ? item.selectedValue
            : undefined
      this.group.add(row)
      this.rowMeshes.push(row)
      this.visualMaterials.push(rowMaterial)
      this.resources.push(rowGeometry, rowMaterial)

      if (item.type === 'separator' || item.type === 'choice-group') return

      row.userData['wristMenuSelected'] =
        item.type === 'toggle' || item.type === 'choice' ? item.selected : false
      row.userData['wristMenuDisabledReason'] = item.disabledReason

      const hitGeometry = new BoxGeometry(0.176, 0.02, 0.008)
      const hitMaterial = new MeshBasicMaterial({ visible: false })
      const hitRegion = new Mesh(hitGeometry, hitMaterial)
      hitRegion.name = `wrist-menu-hit-region:${item.id}`
      hitRegion.position.set(0, y, 0.008)
      hitRegion.userData['wristMenuItemId'] = item.id
      hitRegion.userData['wristMenuDisabled'] = item.disabled
      hitRegion.raycast = decorativeRaycast

      this.group.add(hitRegion)
      this.hitRegions.push(hitRegion)
      this.resources.push(hitGeometry, hitMaterial)
    })
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.group.visible = model.visible
    this.setTargetable(targetable && model.visible)
    for (const material of this.visualMaterials) {
      material.opacity = model.opacity
      material.depthWrite = model.opacity >= 1
    }

    const interactiveItems = rowsFor(model.items).filter(
      (item): item is InteractivePresentationItem =>
        item.type === 'action' || item.type === 'toggle' || item.type === 'choice',
    )
    const itemById = new Map(interactiveItems.map((item) => [item.id, item]))
    for (const row of this.rowMeshes) {
      const itemId = row.name.slice(row.name.indexOf(':') + 1)
      const item = itemById.get(itemId)
      if (item === undefined) continue
      const material = row.material as MeshBasicMaterial
      material.color.setHex(
        item.interaction === 'armed'
          ? 0x2e7d61
          : item.interaction === 'hovered'
            ? item.disabled
              ? 0x3f4849
              : 0x1d4438
            : baseColor(item),
      )
      row.userData['wristMenuSelected'] =
        item.type === 'toggle' || item.type === 'choice' ? item.selected : false
      row.userData['wristMenuValue'] =
        item.type === 'toggle' || item.type === 'choice' ? item.value : undefined
      row.userData['wristMenuDisabledReason'] = item.disabledReason
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
