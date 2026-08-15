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
  classifyAtlasRowVisual,
  type AtlasUvRegion,
  WristMenuPresentationAtlas,
} from './presentation-atlas.js'
import {
  reachFooterCenter,
  reachHeightScale,
  reachLayout,
  reachRowWidth,
  reachViewportCenter,
  reachViewportTop,
} from './reach-layout.js'

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

const POOL_SIZE = VISIBLE_SLOTS

type PoolSlot = {
  rowMesh: Mesh
  hitMesh: Mesh
  rowGeometry: BoxGeometry
  baseUvs: Float32Array
  hitMaterial: MeshBasicMaterial
  boundRowIndex: number | null
  boundInteraction: 'idle' | 'hovered' | 'armed' | null
}

type MeasuredRow = Readonly<{
  top: number
  bottom: number
  height: number
}>

function physicalRowHeight(row: PresentationRow): number {
  return row.type === 'separator'
    ? reachLayout.separatorHeightMeters
    : reachLayout.rowHeightMeters
}

function measureRows(rows: readonly PresentationRow[]): readonly MeasuredRow[] {
  let cursor = 0
  return rows.map((row) => {
    const height = physicalRowHeight(row)
    const measured = Object.freeze({
      top: cursor,
      bottom: cursor + height,
      height,
    })
    cursor = measured.bottom + reachLayout.rowGapMeters
    return measured
  })
}

function physicalScrollOffset(
  rows: readonly MeasuredRow[],
  logicalOffset: number,
): number {
  if (rows.length === 0) return 0
  const baseIndex = Math.min(
    rows.length - 1,
    Math.max(0, Math.floor(logicalOffset)),
  )
  const fraction = Math.min(1, Math.max(0, logicalOffset - baseIndex))
  const base = rows[baseIndex]!
  return base.top + fraction * (base.height + reachLayout.rowGapMeters)
}

function firstVisibleRow(
  rows: readonly MeasuredRow[],
  scrollOffset: number,
): number {
  const index = rows.findIndex(({ bottom }) => bottom > scrollOffset)
  return index < 0 ? Math.max(0, rows.length - 1) : index
}

function lastVisibleRow(
  rows: readonly MeasuredRow[],
  viewportEnd: number,
): number {
  let index = rows.length - 1
  while (index > 0 && rows[index]!.top >= viewportEnd) index -= 1
  return index
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

export class WristMenuPresentation {
  readonly group = new Group()
  readonly hitRegions: Mesh[] = []
  readonly panelMesh: Mesh
  readonly viewportMesh: Mesh
  readonly atlas: WristMenuPresentationAtlas
  private readonly resources: Array<{ dispose(): void }> = []
  private readonly slots: PoolSlot[] = []
  private readonly visualMaterials: MeshBasicMaterial[] = []
  private readonly footerMesh: Mesh<BoxGeometry, MeshBasicMaterial>
  private readonly footerGeometry: BoxGeometry
  private readonly footerBaseUvs: Float32Array
  private allRows: readonly PresentationRow[] = []
  private measuredRows: readonly MeasuredRow[] = []
  private scrollOffset = 0
  private scrollOwned = false
  private theme = defaultThemeTokens
  private modelRevision = -1
  private poolBound = false
  private targetable = false

  constructor(initialModel?: PresentationModel) {
    this.group.name = 'wrist-menu-attachment-root'
    this.theme = initialModel?.theme ?? defaultThemeTokens
    this.allRows = rowsFor(initialModel?.items ?? [])
    this.measuredRows = measureRows(this.allRows)
    this.modelRevision = initialModel?.revision ?? -1
    this.atlas = new WristMenuPresentationAtlas(this.allRows, this.theme)
    this.resources.push(this.atlas)

    const panelGeometry = new BoxGeometry(
      reachLayout.panelWidthMeters,
      reachLayout.panelHeightMeters,
      reachLayout.panelDepthMeters,
    )
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
      const rowGeometry = new BoxGeometry(
        reachLayout.viewportWidthMeters,
        reachLayout.rowHeightMeters,
        reachLayout.rowDepthMeters,
      )
      const rowMaterial = new MeshBasicMaterial({
        color: 0xffffff,
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

      const hitGeometry = new BoxGeometry(
        reachLayout.viewportWidthMeters,
        reachLayout.rowHeightMeters,
        reachLayout.hitDepthMeters,
      )
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
        hitMaterial,
        boundRowIndex: null,
        boundInteraction: null,
      })
    }

    this.viewportMesh = new Mesh(panelGeometry, this.slots[0]!.hitMaterial)
    this.viewportMesh.name = 'wrist-menu-reach-viewport'
    this.viewportMesh.position.set(0, reachViewportCenter, 0.002)
    this.viewportMesh.scale.set(
      reachLayout.viewportWidthMeters / reachLayout.panelWidthMeters,
      reachLayout.viewportHeightMeters / reachLayout.panelHeightMeters,
      1,
    )
    this.viewportMesh.raycast = decorativeRaycast
    this.group.add(this.viewportMesh)

    this.footerGeometry = new BoxGeometry(
      reachLayout.viewportWidthMeters,
      reachLayout.footerHeightMeters,
      reachLayout.rowDepthMeters,
    )
    const footerMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      map: this.atlas.texture,
      transparent: true,
    })
    this.footerMesh = new Mesh(this.footerGeometry, footerMaterial)
    this.footerMesh.name = 'wrist-menu-footer-atlas'
    this.footerMesh.raycast = decorativeRaycast
    this.footerMesh.position.set(
      0,
      reachFooterCenter,
      0.002,
    )
    this.footerBaseUvs = new Float32Array(
      this.footerGeometry.getAttribute('uv').array,
    )
    applyAtlasUv(
      this.footerGeometry,
      this.footerBaseUvs,
      this.atlas.footerRegion(false),
    )
    this.footerMesh.userData['wristMenuAtlasRoles'] = Object.freeze([
      'footer',
    ])
    this.footerMesh.userData['wristMenuAtlasStateCues'] = Object.freeze([])
    this.group.add(this.footerMesh)
    this.resources.push(this.footerGeometry, footerMaterial)
    this.visualMaterials.push(footerMaterial)

    if (initialModel !== undefined) this.setModel(initialModel, false)
  }

  private updateFooterAtlasState(scrollOwned: boolean, force = false) {
    if (!force && this.scrollOwned === scrollOwned) return
    this.scrollOwned = scrollOwned
    applyAtlasUv(
      this.footerGeometry,
      this.footerBaseUvs,
      this.atlas.footerRegion(scrollOwned),
    )
    this.footerMesh.userData['wristMenuAtlasRoles'] = Object.freeze([
      'footer',
      ...(scrollOwned ? ['scrollOwnership'] : []),
    ])
    const cues = Object.freeze(
      scrollOwned ? ['scroll-ownership'] : [],
    )
    this.footerMesh.userData['wristMenuAtlasStateCues'] = cues
    this.footerMesh.userData['wristMenuAtlasStateCue'] = cues[0]
  }

  renderItems(items: readonly PresentationItem[]) {
    this.allRows = rowsFor(items)
    this.measuredRows = measureRows(this.allRows)
    this.atlas.redraw(this.allRows, this.theme)
    this.updateFooterAtlasState(this.scrollOwned, true)
    this.updatePool(true)
  }

  setScrollOffset(offset: number) {
    if (this.scrollOffset === offset) return
    this.scrollOffset = offset
    this.updatePool(true)
  }

  private updatePool(rebindLayout: boolean) {
    const measuredRows = rebindLayout ? this.measuredRows : []
    const physicalOffset = rebindLayout
      ? physicalScrollOffset(measuredRows, this.scrollOffset)
      : 0
    const firstVisible = rebindLayout
      ? firstVisibleRow(measuredRows, physicalOffset)
      : 0
    const startRow = Math.max(0, firstVisible - 1)
    const heightScale = reachHeightScale(this.theme)
    const contentHeight = measuredRows.at(-1)?.bottom ?? 0
    const viewportTop =
      contentHeight <= this.theme.viewportHeightMeters
        ? contentHeight / 2
        : reachViewportTop * heightScale
    const viewportEnd = physicalOffset + this.theme.viewportHeightMeters
    const endRow = rebindLayout
      ? Math.min(
          measuredRows.length,
          lastVisibleRow(measuredRows, viewportEnd) + 2,
        )
      : 0

    for (let slotIndex = 0; slotIndex < POOL_SIZE; slotIndex++) {
      const slot = this.slots[slotIndex]!
      const rowIndex = rebindLayout
        ? startRow + slotIndex < endRow
          ? startRow + slotIndex
          : null
        : slot.boundRowIndex

      if (rowIndex === null || rowIndex >= this.allRows.length) {
        slot.rowMesh.visible = false
        slot.rowMesh.name = `wrist-menu-pool-visual-${slotIndex}`
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = null
        slot.boundRowIndex = null
        slot.boundInteraction = null
        continue
      }

      const row = this.allRows[rowIndex]!
      const interaction =
        ('interaction' in row ? row.interaction : 'idle') ?? 'idle'
      const atlasVisual = classifyAtlasRowVisual(
        row,
        interaction,
        this.theme,
      )
      const rowHeight = physicalRowHeight(row)
      let y = slot.rowMesh.position.y
      let fullyVisible = slot.hitMesh.visible
      if (rebindLayout) {
        const measured = measuredRows[rowIndex]!
        y = viewportTop - (measured.top - physicalOffset) - rowHeight / 2
        slot.rowMesh.visible =
          measured.bottom > physicalOffset && measured.top < viewportEnd
        slot.rowMesh.position.set(0, y, 0.001)
        slot.rowMesh.name = `wrist-menu-${row.type}-visual:${row.id}`
        slot.rowMesh.userData['wristMenuItemType'] = row.type
        slot.rowMesh.userData['wristMenuLabel'] = row.label
        slot.rowMesh.userData['wristMenuIconKey'] =
          'iconKey' in row ? row.iconKey : undefined
        const scaleY = rowHeight / reachLayout.rowHeightMeters
        const rowWidth = reachRowWidth(this.theme)
        const scaleX = rowWidth / reachLayout.viewportWidthMeters
        slot.rowMesh.scale.set(scaleX, scaleY, 1)
        slot.boundRowIndex = rowIndex
        fullyVisible =
          measured.top >= physicalOffset - 1e-7 &&
          measured.bottom <= viewportEnd + 1e-7
        slot.hitMesh.position.set(0, y, reachLayout.hitZMeters)
        slot.hitMesh.scale.set(scaleX, scaleY, 1)
      }

      if (rebindLayout || slot.boundInteraction !== interaction) {
        applyAtlasUv(
          slot.rowGeometry,
          slot.baseUvs,
          this.atlas.rowUv(rowIndex, interaction),
        )
        slot.boundInteraction = interaction
      }
      slot.rowMesh.userData['wristMenuValue'] =
        row.type === 'toggle' || row.type === 'choice'
          ? row.value
          : row.type === 'choice-group'
            ? row.selectedValue
            : undefined
      slot.rowMesh.userData['wristMenuSelected'] =
        row.type === 'toggle' || row.type === 'choice' ? row.selected : false
      slot.rowMesh.userData['wristMenuDisabledReason'] =
        'disabledReason' in row ? row.disabledReason : undefined
      slot.rowMesh.userData['wristMenuAtlasRoles'] = atlasVisual.roles
      slot.rowMesh.userData['wristMenuAtlasStateCues'] = atlasVisual.cues
      slot.rowMesh.userData['wristMenuAtlasStateCue'] =
        atlasVisual.cues.length === 1 ? atlasVisual.cues[0] : undefined

      if (row.type === 'separator' || row.type === 'choice-group') {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = null
        continue
      }

      if (fullyVisible) {
        slot.hitMesh.visible = true
        slot.hitMesh.raycast = this.targetable
          ? interactiveRaycast
          : decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = row.id
        slot.hitMesh.userData['wristMenuDisabled'] = row.disabled
        slot.hitMesh.userData['wristMenuSelected'] =
          row.type === 'toggle' || row.type === 'choice' ? row.selected : false
        slot.hitMesh.userData['wristMenuDisabledReason'] = row.disabledReason
      } else {
        slot.hitMesh.visible = false
        slot.hitMesh.raycast = decorativeRaycast
        slot.hitMesh.userData['wristMenuItemId'] = row.id
      }
    }
    this.poolBound = true
  }

  setModel(model: PresentationModel, targetable: boolean) {
    this.theme = model.theme ?? defaultThemeTokens
    const heightScale = reachHeightScale(this.theme)
    const rowWidth = reachRowWidth(this.theme)
    this.panelMesh.scale.set(
      this.theme.panelWidthMeters / reachLayout.panelWidthMeters,
      heightScale,
      1,
    )
    this.viewportMesh.scale.set(
      rowWidth / reachLayout.panelWidthMeters,
      this.theme.viewportHeightMeters / reachLayout.panelHeightMeters,
      1,
    )
    this.viewportMesh.position.y = reachViewportCenter * heightScale
    this.footerMesh.scale.set(
      rowWidth / reachLayout.viewportWidthMeters,
      heightScale,
      1,
    )
    this.footerMesh.position.y = reachFooterCenter * heightScale
    const panelMaterial = this.panelMesh.material as MeshBasicMaterial
    panelMaterial.color.setHex(this.theme.panelColor)
    const structureChanged = this.modelRevision !== model.revision
    this.allRows = rowsFor(model.items)
    if (structureChanged) {
      this.modelRevision = model.revision
      this.measuredRows = measureRows(this.allRows)
      this.atlas.redraw(this.allRows, this.theme)
    }
    this.updateFooterAtlasState(model.scrollOwned ?? false, structureChanged)
    const scrollChanged = this.scrollOffset !== model.scrollOffset
    this.scrollOffset = model.scrollOffset
    this.updatePool(structureChanged || scrollChanged || !this.poolBound)
    this.group.visible = model.visible
    this.setTargetable(targetable && model.visible && !model.scrollBarrierActive)
    for (const material of this.visualMaterials) {
      material.opacity = model.opacity
      material.depthWrite = model.opacity >= 1
    }
  }

  setTargetable(targetable: boolean) {
    this.targetable = targetable
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
    this.measuredRows = []
    this.group.clear()
  }
}
