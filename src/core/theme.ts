/**
 * Resolved presentation customization owned by the Host Snapshot. Theme tokens
 * restyle the default Command slab and travel on the curated Presentation
 * Model; they never change Menu Definition semantics.
 */
export type ThemeTokens = Readonly<{
  /** Physical width of the Command slab panel. */
  panelWidthMeters: number
  /** Physical height of the Menu Viewport. */
  viewportHeightMeters: number
  panelColor: number
  itemColor: number
  selectedItemColor: number
  disabledItemColor: number
  hoveredItemColor: number
  hoveredDisabledItemColor: number
  armedItemColor: number
  separatorColor: number
  groupHeaderColor: number
}>

export type ThemeOverrides = Readonly<Partial<ThemeTokens>>

export const defaultThemeTokens: ThemeTokens = Object.freeze({
  panelWidthMeters: 0.192,
  viewportHeightMeters: 0.108,
  panelColor: 0x081415,
  itemColor: 0x102020,
  selectedItemColor: 0x245345,
  disabledItemColor: 0x273031,
  hoveredItemColor: 0x1d4438,
  hoveredDisabledItemColor: 0x3f4849,
  armedItemColor: 0x2e7d61,
  separatorColor: 0x355153,
  groupHeaderColor: 0x183132,
})

const physicalTokens = ['panelWidthMeters', 'viewportHeightMeters'] as const
const colorTokens = [
  'panelColor',
  'itemColor',
  'selectedItemColor',
  'disabledItemColor',
  'hoveredItemColor',
  'hoveredDisabledItemColor',
  'armedItemColor',
  'separatorColor',
  'groupHeaderColor',
] as const

export const themeTokenKeys: readonly string[] = Object.freeze([
  ...physicalTokens,
  ...colorTokens,
])

function physicalToken(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2) {
    throw new TypeError(`${name} must be a finite number of meters in (0, 2]`)
  }
  return value
}

function colorToken(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffff) {
    throw new TypeError(`${name} must be an integer between 0x000000 and 0xFFFFFF`)
  }
  return value
}

/** Validate and merge Host Application overrides over the default tokens. */
export function resolveThemeTokens(
  overrides: ThemeOverrides | undefined,
): ThemeTokens {
  const resolved = { ...defaultThemeTokens, ...overrides }
  for (const key of physicalTokens) {
    physicalToken(`theme.${key}`, resolved[key])
  }
  for (const key of colorTokens) {
    colorToken(`theme.${key}`, resolved[key])
  }
  return Object.freeze(resolved)
}
