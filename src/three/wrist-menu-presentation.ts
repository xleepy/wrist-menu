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
  ThemeTokens,
} from '../core/index.js'
import { defaultThemeTokens } from '../core/index.js'
import { VISIBLE_SLOTS } from '../core/scroll-state.js'
import {
  type AtlasUvRegion,
  WristMenuPresentationAtlas,
} from './presentation-atlas.js'

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

function baseColor(
  item: InteractivePresentationItem,
  theme: ThemeTokens,
): number {
  if (item.disabled) return theme.disabledItemColor
  if (item.type === 'toggle' && item.selected) return theme.selectedItemColor
  if (item.type === 'choice' && item.selected) return theme.selectedItemColor
  return theme.itemColor
}

const POOL_SIZE = VISIBLE_SLOTS
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
const FOOTER_HEIGHT = 0.009

const idleAtlasRoles = Object.freeze(['primary', 'secondary'])
const selectedAtlasRoles = Object.freeze([
  'primary',
  'secondary',
  'selected',
])
const disabledAtlasRoles = Object.freeze([
  'primary',
  'secondary',
  'disabled',
])

type PoolSlot = {
  rowMesh: Mesh
  hitMesh: Mesh
  rowGeometry: BoxGeometry
  baseUvs: Float32Array
  rowMaterial: MeshBasicMaterial
  hitMaterial: MeshBasicMaterial
  boundRow: PresentationRow | null
  boundItemId: string | null
}

function applyAtlasUv(
  geometry: BoxGeometry,
  baseUvs: Float32Array,
  region: AtlasUvRegion,
): void {
  const uvs = geometry.getAttribute('uv')
  for (let index = 0; index < uvs.count; index += 1) {
    const source = index * 2
    const baseU = baseUvs[source] ?? 0
    const baseV = baseUvs[source + 1] ?? 0
    uvs.setXY(
      index,
      region.u0 + baseU * (region.u1 - region.u0),
      region.v0 + baseV * (region.v1 - region.v0),
    )
  }
  uvs.needsUpdate = true
}

function atlasRoles(row: PresentationRow): readonly string[] {
  if ('disabled' in row && row.disabled) return disabledAtlasRoles
  if (
    (row.type === 'toggle' || row.type === 'choice') &&
    row.selected
  ) {
    return selectedAtlasRoles
  }
  return idleAtlasRoles
}

function atlasStateCue(
  row: PresentationRow,
): 'disabled' | 'selected' | undefined {
  if ('disabled' in row && row.disabled) return 'disabled'
  if (
    (row.type === 'toggle' || row.type === 'choice') &&
    row.selected
  ) {
    return 'selected'
  }
  return undefined
}

export class WristMenuPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  readonly panelMesh: Mesh
  readonly atlas: WristMenuPresentationAtlas
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly slots: PoolSlot[] = []
  private readonly visualMaterials: MeshBasicMaterial[] = []
  private readonly footerMesh: Mesh<BoxGeometry, MeshBasicMaterial>
  private readonly footerGeometry: BoxGeometry
  private readonly footerBaseUvs: Float32Array
  private allRows: readonly PresentationRow[] = []
  private scrollOffset = 0
  private theme = defaultThemeTokens
  private modelRevision = -1

  constructor(initialModel?: PresentationModel) {
    this.group.name = 'wrist-menu-attachment-root'
    this.theme = initialModel?.theme ?? defaultThemeTokens
    this.allRows = rowsFor(initialModel?.items ?? [])
    this.modelRevision = initialModel?.revision ?? -1
    this.atlas = new WristMenuPresentationAtlas(this.allRows, this.theme)
    this.resources.push(this.atlas)

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
      const rowMaterial = new MeshBasicMaterial({
        map: this.atlas.texture,
        transparent: true,
      })
      const rowMesh = new Mesh(rowGeometry, rowMaterial)
      rowMesh.raycast = decorativeRaycast
      rowMesh.visible = false
      rowMesh.userData['wristMenuPoolSlot'] = i
      this.group.add(rowMesh)
      this.resources.push(rowGeometry, rowMaterial)
      this.visualMaterials.push(rowMaterial)

      const hitGeometry = new BoxGeometry(ROW_WIDTH, ROW_HEIGHT, HIT_DEPTH)
      const hitMaterial = new MeshBasicMaterial({ visible: false })
      const hitMesh = new Mesh(hitGeometry, hitMaterial)
      hitMesh.raycast = decorativeRaycast
      hitMesh.visible = false
      hitMesh.userData['wristMenuPoolSlot'] = i
      hitMesh.userData['wristMenuItemId'] = null
      this.group.add(hitMesh)
      this.resources.push(hitGeometry, hitMaterial)
      this.hitRegions.push(hitMesh)

      this.slots.push({
        rowMesh,
        hitMesh,
        rowGeometry,
        baseUvs: new Float32Array(rowGeometry.getAttribute('uv').array),
        rowMaterial,
        hitMaterial,
        boundRow: null,
        boundItemId: null,
      })
    }

    this.footerGeometry = new BoxGeometry(ROW_WIDTH, FOOTER_HEIGHT, ROW_DEPTH)
    const footerMaterial = new MeshBasicMaterial({
      map: this.atlas.texture,
      transparent: true,
    })
    this.footerMesh = new Mesh(this.footerGeometry, footerMaterial)
    this.footerMesh.name = 'wrist-menu-footer-atlas'
    this.footerMesh.raycast = decorativeRaycast
    this.footerMesh.position.set(
      0,
      -this.theme.viewportHeightMeters / 2 + FOOTER_HEIGHT / 2,
      0.002,
    )
    this.footerBaseUvs = new Float32Array(
      this.footerGeometry.getAttribute('uv').array,
    )
    applyAtlasUv(
      this.footerGeometry,
      this.footerBaseUvs,
      this.atlas.footerRegion(),
    )
    this.group.add(this.footerMesh)
    this.resources.push(this.footerGeometry, footerMaterial)
    this.visualMaterials.push(footerMaterial)

    const stagingGeometry = new BoxGeometry(0.001, 0.001, 0.001)
    const stagingMaterial = new MeshBasicMaterial({
      map: this.atlas.texture,
      transparent: true,
    })
    const stagingMesh = new Mesh(stagingGeometry, stagingMaterial)
    stagingMesh.name = 'wrist-menu-atlas-staging'
    stagingMesh.visible = false
    stagingMesh.raycast = decorativeRaycast
    this.group.add(stagingMesh)
    this.resources.push(stagingGeometry, stagingMaterial)

    if (initialModel !== undefined) this.setModel(initialModel, false)
  }

  renderItems(items: readonly PresentationItem[]) {
    this.allRows = rowsFor(items)
    this.atlas.redraw(this.allRows, this.theme)
    applyAtlasUv(
      this.footerGeometry,
      this.footerBaseUvs,
      this.atlas.footerRegion(),
    )
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
      slot.rowMesh.userData['wristMenuAtlasRoles'] = atlasRoles(row)
      slot.rowMesh.userData['wristMenuAtlasStateCue'] = atlasStateCue(row)
      applyAtlasUv(
        slot.rowGeometry,
        slot.baseUvs,
        this.atlas.rowUv(rowIndex),
      )

      if (row.type === 'separator') {
        slot.rowMaterial.color.setHex(this.theme.separatorColor)
      } else if (row.type === 'choice-group') {
        slot.rowMaterial.color.setHex(this.theme.groupHeaderColor)
      } else {
        slot.rowMaterial.color.setHex(baseColor(row, this.theme))
      }

      const scaleY = rowHeight / ROW_HEIGHT
      const rowWidth = Math.max(0.001, this.theme.panelWidthMeters - 0.016)
      const scaleX = rowWidth / ROW_WIDTH
      slot.rowMesh.scale.set(scaleX, scaleY, 1)

      slot.boundRow = row
      slot.boundItemId = row.type !== 'separator' && row.type !== 'choice-group' ? row.id : null

      if (row.type === 'separator' || row.type === 'choice-group') {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = null
        continue
      }

      const interactiveRow = row as InteractivePresentationItem
      const fullyVisible =
        y >= -this.theme.viewportHeightMeters / 2 + rowHeight / 2 - 0.001 &&
        y <= this.theme.viewportHeightMeters / 2 - rowHeight / 2 + 0.001

      if (fullyVisible) {
        slot.hitMesh.visible = true
        slot.hitMesh.position.set(0, y, HIT_Z)
        slot.hitMesh.scale.set(scaleX, 1, 1)
        slot.hitMesh.userData['wristMenuItemId'] = interactiveRow.id
        slot.hitMesh.userData['wristMenuDisabled'] = interactiveRow.disabled
        slot.hitMesh.userData['wristMenuSelected'] =
          interactiveRow.type === 'toggle' || interactiveRow.type === 'choice' ? interactiveRow.selected : false
        slot.hitMesh.userData['wristMenuDisabledReason'] = interactiveRow.disabledReason
      } else {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = interactiveRow.id
      }
    }
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.theme = model.theme ?? defaultThemeTokens
    this.panelMesh.scale.set(
      this.theme.panelWidthMeters / PANEL_WIDTH,
      this.theme.viewportHeightMeters / PANEL_HEIGHT,
      1,
    )
    this.footerMesh.scale.x =
      Math.max(0.001, this.theme.panelWidthMeters - 0.016) / ROW_WIDTH
    this.footerMesh.position.y =
      -this.theme.viewportHeightMeters / 2 + FOOTER_HEIGHT / 2
    const panelMaterial = this.panelMesh.material as MeshBasicMaterial
    panelMaterial.color.setHex(this.theme.panelColor)
    if (this.modelRevision !== model.revision) {
      this.modelRevision = model.revision
      this.renderItems(model.items)
    } else {
      this.rebindPool()
    }
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
          ? this.theme.armedItemColor
          : item.interaction === 'hovered'
            ? item.disabled
              ? this.theme.hoveredDisabledItemColor
              : this.theme.hoveredItemColor
            : baseColor(item, this.theme),
      )
      slot.rowMesh.userData['wristMenuSelected'] =
        item.type === 'toggle' || item.type === 'choice' ? item.selected : false
      slot.rowMesh.userData['wristMenuValue'] =
        item.type === 'toggle' || item.type === 'choice' ? item.value : undefined
      slot.rowMesh.userData['wristMenuDisabledReason'] = item.disabledReason
      slot.rowMesh.userData['wristMenuAtlasRoles'] = atlasRoles(item)
      slot.rowMesh.userData['wristMenuAtlasStateCue'] = atlasStateCue(item)
    }
  }

  setTargetable(targetable: boolean) {
    for (const hitRegion of this.hitRegions) {
      if (hitRegion.visible) {
        hitRegion.raycast = targetable ? interactiveRaycast : decorativeRaycast
      }
    }
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
