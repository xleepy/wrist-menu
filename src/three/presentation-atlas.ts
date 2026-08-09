import { LinearFilter } from 'three/src/constants.js'
import { CanvasTexture } from 'three/src/textures/CanvasTexture.js'

import type { ThemeTokens } from '../core/index.js'
import { installEmbeddedInterFont } from './embedded-inter-font.js'

export const ATLAS_WIDTH = 1024
export const ATLAS_HEIGHT = 2048
export const ATLAS_BYTES = ATLAS_WIDTH * ATLAS_HEIGHT * 4

const ROW_ASPECT = 0.176 / 0.02
const PRIMARY_HEIGHT_METERS = 0.0065
const SECONDARY_HEIGHT_METERS = 0.00475
const CELL_GUTTER = 2

export type AtlasRow = Readonly<{
  type: string
  label?: string
  iconKey?: string
  selected?: boolean
  disabled?: boolean
  disabledReason?: string
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

const noRegion: AtlasUvRegion = Object.freeze({ u0: 0, u1: 1, v0: 0, v1: 1 })

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
    const cellHeight = Math.max(1, Math.floor(cellWidth / ROW_ASPECT))
    const rowsPerColumn = Math.floor(ATLAS_HEIGHT / cellHeight)
    if (columns * rowsPerColumn >= regionCount) {
      return { columns, cellWidth, cellHeight, rowsPerColumn }
    }
    columns += 1
  }
}

function cellBounds(layout: AtlasLayout, index: number) {
  const column = Math.floor(index / layout.rowsPerColumn)
  const row = index % layout.rowsPerColumn
  return {
    x: column * layout.cellWidth,
    y: row * layout.cellHeight,
    width: layout.cellWidth,
    height: layout.cellHeight,
  }
}

function uvRegion(
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
): AtlasUvRegion {
  return Object.freeze({
    u0: (bounds.x + CELL_GUTTER) / ATLAS_WIDTH,
    u1: (bounds.x + bounds.width - CELL_GUTTER) / ATLAS_WIDTH,
    v0:
      1 -
      (bounds.y + bounds.height - CELL_GUTTER) / ATLAS_HEIGHT,
    v1: 1 - (bounds.y + CELL_GUTTER) / ATLAS_HEIGHT,
  })
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
      selected: role('selected', theme.selectedItemColor),
      disabled: role('disabled', theme.disabledItemColor),
    }),
    nonColorStateCues: Object.freeze([
      'selected-label-and-check',
      'disabled-label-and-slash',
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

function rowBackground(row: AtlasRow, theme: ThemeTokens): number {
  if (row.type === 'separator') return theme.separatorColor
  if (row.type === 'choice-group') return theme.groupHeaderColor
  if (row.disabled === true) return theme.disabledItemColor
  if (row.selected === true) return theme.selectedItemColor
  return theme.itemColor
}

function secondaryText(row: AtlasRow): string {
  if (row.disabled === true) return row.disabledReason ?? 'DISABLED'
  if (row.selected === true) return 'SELECTED'
  if (row.type === 'toggle') return 'TOGGLE'
  if (row.type === 'choice') return 'OPTION'
  if (row.type === 'choice-group') return 'CHOICE GROUP'
  return 'ACTION'
}

function drawStateCue(
  context: AtlasContext,
  row: AtlasRow,
  x: number,
  y: number,
  size: number,
  color: number,
) {
  context.save()
  context.translate(x, y)
  context.strokeStyle = cssColor(color)
  context.lineWidth = Math.max(1, size * 0.11)
  context.lineCap = 'round'
  context.beginPath()
  if (row.disabled === true) {
    context.arc(0, 0, size * 0.38, 0, Math.PI * 2)
    context.moveTo(-size * 0.3, size * 0.3)
    context.lineTo(size * 0.3, -size * 0.3)
  } else if (row.selected === true) {
    context.moveTo(-size * 0.38, 0)
    context.lineTo(-size * 0.08, size * 0.3)
    context.lineTo(size * 0.42, -size * 0.34)
  }
  context.stroke()
  context.restore()
}

function drawRow(
  context: AtlasContext,
  row: AtlasRow,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  theme: ThemeTokens,
) {
  const background = rowBackground(row, theme)
  const ink = readableInk(background)
  context.fillStyle = cssColor(background)
  context.fillRect(
    bounds.x + CELL_GUTTER,
    bounds.y + CELL_GUTTER,
    bounds.width - CELL_GUTTER * 2,
    bounds.height - CELL_GUTTER * 2,
  )

  const pixelsPerMeter = bounds.width / 0.176
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
    context.strokeStyle = cssColor(ink)
    context.lineWidth = Math.max(1, bounds.height * 0.035)
    context.beginPath()
    context.moveTo(bounds.x + padding, centerY)
    context.lineTo(bounds.x + bounds.width * 0.28, centerY)
    context.moveTo(bounds.x + bounds.width * 0.72, centerY)
    context.lineTo(bounds.x + bounds.width - padding, centerY)
    context.stroke()
    context.fillStyle = cssColor(ink)
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
  drawIcon(context, row.iconKey, iconX, centerY, iconSize, ink)

  context.fillStyle = cssColor(ink)
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
    fitText(context, secondaryText(row), maximumTextWidth),
    textX,
    centerY + primaryPixels * 0.42,
  )

  if (row.selected === true || row.disabled === true) {
    drawStateCue(
      context,
      row,
      bounds.x + bounds.width - padding - iconSize / 2,
      centerY,
      iconSize,
      ink,
    )
  }
}

function drawFooter(
  context: AtlasContext,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  rowCount: number,
  theme: ThemeTokens,
) {
  const ink = readableInk(theme.panelColor)
  context.fillStyle = cssColor(theme.panelColor)
  context.fillRect(
    bounds.x + CELL_GUTTER,
    bounds.y + CELL_GUTTER,
    bounds.width - CELL_GUTTER * 2,
    bounds.height - CELL_GUTTER * 2,
  )
  context.fillStyle = cssColor(ink)
  context.font = `600 ${Math.max(6, bounds.height * 0.24)}px WristMenuInter, Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(
    `${rowCount} ITEMS  ·  WRIST MENU`,
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  context.textAlign = 'left'
}

/** One bounded, package-owned CanvasTexture populated only at snapshot seams. */
export class WristMenuPresentationAtlas {
  readonly texture: CanvasTexture
  private readonly canvas: AtlasCanvas
  private readonly context: AtlasContext | null
  private rowRegions: readonly AtlasUvRegion[] = []
  private footerUv: AtlasUvRegion = noRegion

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

  rowUv(index: number): AtlasUvRegion {
    return this.rowRegions[index] ?? noRegion
  }

  footerRegion(): AtlasUvRegion {
    return this.footerUv
  }

  redraw(rows: readonly AtlasRow[], theme: ThemeTokens): void {
    this.render(rows, theme)
    this.texture.userData['wristMenuAtlas'] = atlasMetadata(theme)
    this.texture.needsUpdate = true
  }

  private render(rows: readonly AtlasRow[], theme: ThemeTokens): void {
    const layout = atlasLayout(rows.length + 1)
    this.context?.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT)
    this.rowRegions = Object.freeze(
      rows.map((row, index) => {
        const bounds = cellBounds(layout, index)
        if (this.context !== null) drawRow(this.context, row, bounds, theme)
        return uvRegion(bounds)
      }),
    )
    const footerBounds = cellBounds(layout, rows.length)
    if (this.context !== null) {
      drawFooter(this.context, footerBounds, rows.length, theme)
    }
    this.footerUv = uvRegion(footerBounds)
  }

  dispose(): void {
    this.texture.dispose()
  }
}
