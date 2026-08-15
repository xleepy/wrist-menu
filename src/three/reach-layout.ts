import type { ThemeTokens } from '../core/theme.js'

/** Accepted Reach prototype dimensions and derived presentation measurements. */
export const reachLayout = Object.freeze({
  panelWidthMeters: 0.192,
  panelHeightMeters: 0.158,
  panelDepthMeters: 0.004,
  viewportWidthMeters: 0.176,
  viewportHeightMeters: 0.108,
  viewportBottomInsetMeters: 0.01,
  rowHeightMeters: 0.02,
  separatorHeightMeters: 0.009,
  rowGapMeters: 0.0025,
  rowDepthMeters: 0.003,
  hitDepthMeters: 0.008,
  hitZMeters: 0.008,
  footerHeightMeters: 0.0065,
  footerGapMeters: 0.0015,
  footerBottomInsetMeters: 0.002,
})

export const reachViewportBottom =
  -reachLayout.panelHeightMeters / 2 +
  reachLayout.viewportBottomInsetMeters
export const reachViewportTop =
  reachViewportBottom + reachLayout.viewportHeightMeters
export const reachViewportCenter =
  (reachViewportTop + reachViewportBottom) / 2
export const reachFooterCenter =
  (reachViewportBottom - reachLayout.footerGapMeters +
    (-reachLayout.panelHeightMeters / 2 +
      reachLayout.footerBottomInsetMeters)) /
  2

export function reachHeightScale(theme: ThemeTokens): number {
  return theme.viewportHeightMeters / reachLayout.viewportHeightMeters
}

export function reachRowWidth(theme: ThemeTokens): number {
  const horizontalInset =
    reachLayout.panelWidthMeters - reachLayout.viewportWidthMeters
  return Math.max(0.001, theme.panelWidthMeters - horizontalInset)
}

export function reachFooterHeight(theme: ThemeTokens): number {
  return reachLayout.footerHeightMeters * reachHeightScale(theme)
}
