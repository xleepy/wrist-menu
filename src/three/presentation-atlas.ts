import { LinearFilter } from 'three/src/constants.js'
import { CanvasTexture } from 'three/src/textures/CanvasTexture.js'

import type { MenuInteraction, ThemeTokens } from '../core/index.js'
import { installEmbeddedInterFont } from './embedded-inter-font.js'
import {
  reachFooterHeight,
  reachLayout,
  reachRowWidth,
} from './reach-layout.js'

export const ATLAS_WIDTH = 1024
export const ATLAS_HEIGHT = 2048
export const ATLAS_BYTES = ATLAS_WIDTH * ATLAS_HEIGHT * 4

const ROW_ASPECT =
  reachLayout.viewportWidthMeters / reachLayout.rowHeightMeters
const PRIMARY_HEIGHT_METERS = 0.0065
const SECONDARY_HEIGHT_METERS = 0.00475
const CELL_GUTTER = 2

export type AtlasRowType =
  | 'action'
  | 'toggle'
  | 'choice'
  | 'choice-group'
  | 'separator'

export type AtlasRow = Readonly<{
  type: AtlasRowType
  label?: string
  iconKey?: string
  interaction?: MenuInteraction
  selected?: boolean
  disabled?: boolean
  disabledReason?: string
}>

export type AtlasRowCue =
  | 'hovered'
  | 'selected'
  | 'disabled'
  | 'selection-ownership'

export type AtlasRowVisual = Readonly<{
  interaction: MenuInteraction
  background: number
  ink: number
  secondary: string
  cues: readonly AtlasRowCue[]
  roles: readonly string[]
}>

export type AtlasUvRegion = Readonly<{
  u0: number
  u1: number
  v0: number
  v1: number
}>

type AtlasCanvas = {
  width: number
  height: number
  getContext?: (kind: string, options?: unknown) => AtlasContext | null
}

type AtlasTextMetrics = Readonly<{ width: number }>

type AtlasContext = {
  fillStyle: string
  strokeStyle: string
  font: string
  textAlign: string
  textBaseline: string
  lineWidth: number
  lineCap: string
  lineJoin: string
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): AtlasTextMetrics
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  rect(x: number, y: number, width: number, height: number): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): void
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void
  stroke(): void
  save(): void
  restore(): void
  translate(x: number, y: number): void
}

type AtlasLayout = Readonly<{
  columns: number
  cellWidth: number
  cellHeight: number
  rowsPerColumn: number
}>

type AtlasBounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

const fullAtlasRegion: AtlasUvRegion = Object.freeze({
  u0: 0,
  u1: 1,
  v0: 0,
  v1: 1,
})

function canvasForAtlas(): AtlasCanvas {
  const documentLike = (
    globalThis as unknown as {
      document?: { createElement(name: string): AtlasCanvas }
    }
  ).document
  const canvas = documentLike?.createElement('canvas') ?? {
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
  }
  canvas.width = ATLAS_WIDTH
  canvas.height = ATLAS_HEIGHT
  return canvas
}

function atlasLayout(regionCount: number): AtlasLayout {
  let columns = 1
  while (true) {
    const cellWidth = Math.floor(ATLAS_WIDTH / columns)
    const contentWidth = Math.max(1, cellWidth - CELL_GUTTER * 2)
    const cellHeight = Math.max(
      1,
      Math.ceil(contentWidth / ROW_ASPECT) + CELL_GUTTER * 2,
    )
    const rowsPerColumn = Math.floor(ATLAS_HEIGHT / cellHeight)
    if (columns * rowsPerColumn >= regionCount) {
      return { columns, cellWidth, cellHeight, rowsPerColumn }
    }
    columns += 1
  }
}

function cellBounds(layout: AtlasLayout, index: number): AtlasBounds {
  const column = Math.floor(index / layout.rowsPerColumn)
  const row = index % layout.rowsPerColumn
  return {
    x: column * layout.cellWidth,
    y: row * layout.cellHeight,
    width: layout.cellWidth,
    height: layout.cellHeight,
  }
}

function aspectMatchedBounds(
  cell: AtlasBounds,
  physicalWidth: number,
  physicalHeight: number,
): AtlasBounds {
  const availableWidth = Math.max(1, cell.width - CELL_GUTTER * 2)
  const availableHeight = Math.max(1, cell.height - CELL_GUTTER * 2)
  const physicalAspect = physicalWidth / physicalHeight
  const width = Math.min(availableWidth, availableHeight * physicalAspect)
  const height = width / physicalAspect
  return Object.freeze({
    x: cell.x + (cell.width - width) / 2,
    y: cell.y + (cell.height - height) / 2,
    width,
    height,
  })
}

function uvRegion(bounds: AtlasBounds): AtlasUvRegion {
  return Object.freeze({
    u0: bounds.x / ATLAS_WIDTH,
    u1: (bounds.x + bounds.width) / ATLAS_WIDTH,
    v0: 1 - (bounds.y + bounds.height) / ATLAS_HEIGHT,
    v1: 1 - bounds.y / ATLAS_HEIGHT,
  })
}

function rowHeight(row: AtlasRow): number {
  return row.type === 'separator'
    ? reachLayout.separatorHeightMeters
    : reachLayout.rowHeightMeters
}

function linearChannel(channel: number): number {
  const srgb = channel / 255
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(color: number): number {
  return (
    0.2126 * linearChannel((color >> 16) & 0xff) +
    0.7152 * linearChannel((color >> 8) & 0xff) +
    0.0722 * linearChannel(color & 0xff)
  )
}

function contrastRatio(left: number, right: number): number {
  const light = Math.max(luminance(left), luminance(right))
  const dark = Math.min(luminance(left), luminance(right))
  return (light + 0.05) / (dark + 0.05)
}

function readableInk(background: number): number {
  return contrastRatio(0xffffff, background) >=
    contrastRatio(0x000000, background)
    ? 0xffffff
    : 0x000000
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function role(name: string, background: number) {
  const foreground = readableInk(background)
  return Object.freeze({
    name,
    foreground,
    background,
    contrast: contrastRatio(foreground, background),
  })
}

const cueRole = Object.freeze({
  hovered: 'hovered',
  selected: 'selected',
  disabled: 'disabled',
  'selection-ownership': 'selectionOwnership',
} satisfies Readonly<Record<AtlasRowCue, string>>)

type AtlasSemanticState = 'idle' | 'selected' | 'disabled'

function semanticState(row: AtlasRow): AtlasSemanticState {
  if (row.disabled === true) return 'disabled'
  if (row.selected === true) return 'selected'
  return 'idle'
}

function defaultSecondary(row: AtlasRow): string {
  if (row.type === 'toggle') return 'TOGGLE'
  if (row.type === 'choice') return 'OPTION'
  if (row.type === 'choice-group') return 'CHOICE GROUP'
  return 'ACTION'
}

/** One policy for atlas background, text, roles, and non-color row cues. */
export function classifyAtlasRowVisual(
  row: AtlasRow,
  interaction: MenuInteraction,
  theme: ThemeTokens,
): AtlasRowVisual {
  const semantic = semanticState(row)
  const cues: AtlasRowCue[] = []
  if (semantic !== 'idle') cues.push(semantic)

  if (interaction === 'hovered') cues.push('hovered')
  else if (interaction === 'armed' && semantic !== 'disabled') {
    cues.push('selection-ownership')
  }

  const background =
    row.type === 'separator'
      ? theme.separatorColor
      : row.type === 'choice-group'
        ? theme.groupHeaderColor
        : semantic === 'disabled'
          ? interaction === 'hovered'
            ? theme.hoveredDisabledItemColor
            : theme.disabledItemColor
          : interaction === 'armed'
            ? theme.armedItemColor
            : interaction === 'hovered'
              ? theme.hoveredItemColor
              : semantic === 'selected'
                ? theme.selectedItemColor
                : theme.itemColor
  const secondary =
    semantic === 'disabled'
      ? row.disabledReason ?? 'DISABLED'
      : interaction === 'armed'
        ? 'SELECTION OWNED'
        : interaction === 'hovered'
          ? 'HOVER'
          : semantic === 'selected'
            ? 'SELECTED'
            : defaultSecondary(row)
  const baseRoles =
    row.type === 'separator'
      ? ['separator']
      : ['primary', 'secondary']

  return Object.freeze({
    interaction,
    background,
    ink: readableInk(background),
    secondary,
    cues: Object.freeze(cues),
    roles: Object.freeze([
      ...baseRoles,
      ...cues.map((cue) => cueRole[cue]),
    ]),
  })
}

function atlasMetadata(theme: ThemeTokens) {
  return Object.freeze({
    kind: 'single-package-owned-rgba-atlas',
    fontFamily: 'WristMenuInter',
    fontSource: 'embedded-inter-woff2',
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    bytes: ATLAS_BYTES,
    roles: Object.freeze({
      primary: role('primary', theme.itemColor),
      secondary: role('secondary', theme.itemColor),
      separator: role('separator', theme.separatorColor),
      footer: role('footer', theme.panelColor),
      hovered: role('hovered', theme.hoveredItemColor),
      hoveredDisabled: role(
        'hoveredDisabled',
        theme.hoveredDisabledItemColor,
      ),
      selected: role('selected', theme.selectedItemColor),
      disabled: role('disabled', theme.disabledItemColor),
      selectionOwnership: role(
        'selectionOwnership',
        theme.armedItemColor,
      ),
      scrollOwnership: role('scrollOwnership', theme.panelColor),
    }),
    nonColorStateCues: Object.freeze([
      'hovered-inset-outline',
      'selected-label-and-check',
      'disabled-label-and-slash',
      'selection-ownership-double-outline',
      'scroll-ownership-footer-label-and-outline',
    ]),
  })
}

function fitText(
  context: AtlasContext,
  text: string,
  maximumWidth: number,
): string {
  if (context.measureText(text).width <= maximumWidth) return text
  let fitted = text
  while (
    fitted.length > 1 &&
    context.measureText(`${fitted}…`).width > maximumWidth
  ) {
    fitted = fitted.slice(0, -1)
  }
  return `${fitted}…`
}

function drawIcon(
  context: AtlasContext,
  iconKey: string | undefined,
  x: number,
  y: number,
  size: number,
  color: number,
) {
  const key = iconKey?.toLowerCase() ?? 'item'
  const half = size / 2
  context.save()
  context.translate(x, y)
  context.strokeStyle = cssColor(color)
  context.lineWidth = Math.max(1, size * 0.09)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.beginPath()

  if (key === 'add' || key === 'plus') {
    context.moveTo(-half * 0.65, 0)
    context.lineTo(half * 0.65, 0)
    context.moveTo(0, -half * 0.65)
    context.lineTo(0, half * 0.65)
  } else if (key === 'remove' || key === 'clear') {
    context.arc(0, 0, half * 0.7, 0, Math.PI * 2)
    context.moveTo(-half * 0.5, half * 0.5)
    context.lineTo(half * 0.5, -half * 0.5)
  } else if (key === 'grid') {
    context.rect(-half * 0.65, -half * 0.65, half * 1.3, half * 1.3)
    context.moveTo(-half * 0.22, -half * 0.65)
    context.lineTo(-half * 0.22, half * 0.65)
    context.moveTo(half * 0.22, -half * 0.65)
    context.lineTo(half * 0.22, half * 0.65)
    context.moveTo(-half * 0.65, -half * 0.22)
    context.lineTo(half * 0.65, -half * 0.22)
    context.moveTo(-half * 0.65, half * 0.22)
    context.lineTo(half * 0.65, half * 0.22)
  } else if (key === 'reset') {
    context.arc(0, 0, half * 0.65, -Math.PI * 0.35, Math.PI * 1.35)
    context.moveTo(-half * 0.7, -half * 0.05)
    context.lineTo(-half * 0.65, half * 0.55)
    context.lineTo(-half * 0.12, half * 0.3)
  } else if (key === 'sphere') {
    context.arc(0, 0, half * 0.7, 0, Math.PI * 2)
  } else if (key === 'cylinder') {
    context.ellipse(0, -half * 0.5, half * 0.65, half * 0.22, 0, 0, Math.PI * 2)
    context.moveTo(-half * 0.65, -half * 0.5)
    context.lineTo(-half * 0.65, half * 0.5)
    context.moveTo(half * 0.65, -half * 0.5)
    context.lineTo(half * 0.65, half * 0.5)
    context.ellipse(0, half * 0.5, half * 0.65, half * 0.22, 0, 0, Math.PI)
  } else {
    context.rect(-half * 0.62, -half * 0.62, half * 1.24, half * 1.24)
  }

  context.stroke()
  context.restore()
}

function drawRowCues(
  context: AtlasContext,
  visual: AtlasRowVisual,
  bounds: AtlasBounds,
  padding: number,
  iconSize: number,
) {
  const centerY = bounds.y + bounds.height / 2
  for (const cue of visual.cues) {
    context.save()
    context.strokeStyle = cssColor(visual.ink)
    context.lineWidth = Math.max(1, iconSize * 0.11)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    if (cue === 'hovered') {
      const inset = Math.max(2, padding * 0.45)
      context.rect(
        bounds.x + inset,
        bounds.y + inset,
        bounds.width - inset * 2,
        bounds.height - inset * 2,
      )
    } else if (cue === 'selection-ownership') {
      const outerInset = Math.max(2, padding * 0.35)
      const innerInset = Math.max(4, padding * 0.85)
      context.rect(
        bounds.x + outerInset,
        bounds.y + outerInset,
        bounds.width - outerInset * 2,
        bounds.height - outerInset * 2,
      )
      context.rect(
        bounds.x + innerInset,
        bounds.y + innerInset,
        bounds.width - innerInset * 2,
        bounds.height - innerInset * 2,
      )
    } else {
      context.translate(
        bounds.x + bounds.width - padding - iconSize / 2,
        centerY,
      )
      if (cue === 'disabled') {
        context.arc(0, 0, iconSize * 0.38, 0, Math.PI * 2)
        context.moveTo(-iconSize * 0.3, iconSize * 0.3)
        context.lineTo(iconSize * 0.3, -iconSize * 0.3)
      } else {
        context.moveTo(-iconSize * 0.38, 0)
        context.lineTo(-iconSize * 0.08, iconSize * 0.3)
        context.lineTo(iconSize * 0.42, -iconSize * 0.34)
      }
    }
    context.stroke()
    context.restore()
  }
}

function drawRow(
  context: AtlasContext,
  row: AtlasRow,
  bounds: AtlasBounds,
  physicalWidth: number,
  visual: AtlasRowVisual,
) {
  context.fillStyle = cssColor(visual.background)
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)

  const pixelsPerMeter = bounds.width / physicalWidth
  const primaryPixels = Math.max(
    7,
    Math.round(PRIMARY_HEIGHT_METERS * pixelsPerMeter),
  )
  const secondaryPixels = Math.max(
    6,
    Math.round(SECONDARY_HEIGHT_METERS * pixelsPerMeter),
  )
  const centerY = bounds.y + bounds.height / 2
  const padding = Math.max(4, bounds.width * 0.018)

  if (row.type === 'separator') {
    context.strokeStyle = cssColor(visual.ink)
    context.lineWidth = Math.max(1, bounds.height * 0.035)
    context.beginPath()
    context.moveTo(bounds.x + padding, centerY)
    context.lineTo(bounds.x + bounds.width * 0.28, centerY)
    context.moveTo(bounds.x + bounds.width * 0.72, centerY)
    context.lineTo(bounds.x + bounds.width - padding, centerY)
    context.stroke()
    context.fillStyle = cssColor(visual.ink)
    context.font = `600 ${secondaryPixels}px WristMenuInter, Arial, sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(
      fitText(context, row.label ?? 'SECTION', bounds.width * 0.4),
      bounds.x + bounds.width / 2,
      centerY,
    )
    context.textAlign = 'left'
    return
  }

  const iconSize = Math.max(8, bounds.height * 0.46)
  const iconX = bounds.x + padding + iconSize / 2
  const textX = iconX + iconSize / 2 + padding
  const trailingWidth = Math.max(48, bounds.width * 0.24)
  const maximumTextWidth = Math.max(
    12,
    bounds.x + bounds.width - trailingWidth - textX,
  )
  drawIcon(context, row.iconKey, iconX, centerY, iconSize, visual.ink)

  context.fillStyle = cssColor(visual.ink)
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.font = `600 ${primaryPixels}px WristMenuInter, Arial, sans-serif`
  context.fillText(
    fitText(context, row.label ?? '', maximumTextWidth),
    textX,
    centerY - secondaryPixels * 0.42,
  )
  context.font = `400 ${secondaryPixels}px WristMenuInter, Arial, sans-serif`
  context.fillText(
    fitText(context, visual.secondary, maximumTextWidth),
    textX,
    centerY + primaryPixels * 0.42,
  )

  drawRowCues(context, visual, bounds, padding, iconSize)
}

function drawFooter(
  context: AtlasContext,
  bounds: AtlasBounds,
  physicalWidth: number,
  rowCount: number,
  scrollOwned: boolean,
  theme: ThemeTokens,
) {
  const ink = readableInk(theme.panelColor)
  context.fillStyle = cssColor(theme.panelColor)
  context.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
  context.fillStyle = cssColor(ink)
  const pixelsPerMeter = bounds.width / physicalWidth
  context.font = `600 ${Math.max(6, Math.round(SECONDARY_HEIGHT_METERS * pixelsPerMeter))}px WristMenuInter, Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(
    scrollOwned
      ? `SCROLL OWNED  ·  ${rowCount} ITEMS`
      : `${rowCount} ITEMS  ·  WRIST MENU`,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  if (scrollOwned) {
    const inset = Math.max(2, bounds.height * 0.14)
    context.strokeStyle = cssColor(ink)
    context.lineWidth = Math.max(1, bounds.height * 0.08)
    context.beginPath()
    context.rect(
      bounds.x + inset,
      bounds.y + inset,
      bounds.width - inset * 2,
      bounds.height - inset * 2,
    )
    context.stroke()
  }
  context.textAlign = 'left'
}

const interactionVariants = Object.freeze<MenuInteraction[]>([
  'idle',
  'hovered',
  'armed',
])

type AtlasRowRegions = Readonly<Record<MenuInteraction, AtlasUvRegion>>
type AtlasFooterRegions = Readonly<{
  idle: AtlasUvRegion
  scrollOwned: AtlasUvRegion
}>

function atlasInteractions(row: AtlasRow): readonly MenuInteraction[] {
  return row.type === 'separator' || row.type === 'choice-group'
    ? ['idle']
    : interactionVariants
}

/** One bounded, package-owned CanvasTexture populated only at snapshot seams. */
export class WristMenuPresentationAtlas {
  readonly texture: CanvasTexture
  private readonly canvas: AtlasCanvas
  private readonly context: AtlasContext | null
  private rowRegions: readonly AtlasRowRegions[] = []
  private footerRegions: AtlasFooterRegions = Object.freeze({
    idle: fullAtlasRegion,
    scrollOwned: fullAtlasRegion,
  })

  constructor(rows: readonly AtlasRow[], theme: ThemeTokens) {
    installEmbeddedInterFont()
    this.canvas = canvasForAtlas()
    this.context = this.canvas.getContext?.('2d', { alpha: true }) ?? null
    this.render(rows, theme)
    this.texture = new CanvasTexture(this.canvas as never)
    this.texture.name = 'wrist-menu-default-inter-rgba-atlas'
    this.texture.generateMipmaps = false
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = LinearFilter
    this.texture.userData['wristMenuAtlas'] = atlasMetadata(theme)
  }

  rowUv(
    index: number,
    interaction: MenuInteraction = 'idle',
  ): AtlasUvRegion {
    return this.rowRegions[index]?.[interaction] ?? fullAtlasRegion
  }

  footerRegion(scrollOwned = false): AtlasUvRegion {
    return scrollOwned
      ? this.footerRegions.scrollOwned
      : this.footerRegions.idle
  }

  redraw(rows: readonly AtlasRow[], theme: ThemeTokens): void {
    this.render(rows, theme)
    this.texture.userData['wristMenuAtlas'] = atlasMetadata(theme)
    this.texture.needsUpdate = true
  }

  private render(rows: readonly AtlasRow[], theme: ThemeTokens): void {
    const plannedRows = rows.flatMap((row, rowIndex) =>
      atlasInteractions(row).map((interaction) => ({
        row,
        rowIndex,
        interaction,
      })),
    )
    const layout = atlasLayout(plannedRows.length + 2)
    const physicalWidth = reachRowWidth(theme)
    this.context?.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
    const regionsByRow: Array<Partial<Record<MenuInteraction, AtlasUvRegion>>> =
      rows.map(() => ({}))
    plannedRows.forEach(({ row, rowIndex, interaction }, regionIndex) => {
      const bounds = aspectMatchedBounds(
        cellBounds(layout, regionIndex),
        physicalWidth,
        rowHeight(row),
      )
      if (this.context !== null) {
        drawRow(
          this.context,
          row,
          bounds,
          physicalWidth,
          classifyAtlasRowVisual(row, interaction, theme),
        )
      }
      regionsByRow[rowIndex]![interaction] = uvRegion(bounds)
    })
    this.rowRegions = Object.freeze(
      regionsByRow.map((regions) => {
        const idle = regions.idle ?? fullAtlasRegion
        return Object.freeze({
          idle,
          hovered: regions.hovered ?? idle,
          armed: regions.armed ?? idle,
        })
      }),
    )

    const footerRegions = [false, true].map((scrollOwned, footerIndex) => {
      const footerBounds = aspectMatchedBounds(
        cellBounds(layout, plannedRows.length + footerIndex),
        physicalWidth,
        reachFooterHeight(theme),
      )
      if (this.context !== null) {
        drawFooter(
          this.context,
          footerBounds,
          physicalWidth,
          rows.length,
          scrollOwned,
          theme,
        )
      }
      return uvRegion(footerBounds)
    })
    this.footerRegions = Object.freeze({
      idle: footerRegions[0]!,
      scrollOwned: footerRegions[1]!,
    })
  }

  dispose(): void {
    this.texture.dispose()
  }
}
