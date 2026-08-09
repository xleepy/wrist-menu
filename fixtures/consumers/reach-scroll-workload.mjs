export const reachScrollGapYMeters = Object.freeze([
  0.01775,
  -0.00475,
  -0.02725,
  -0.04976,
])

export function activeScrollPositionY(frameIndex) {
  if (frameIndex < reachScrollGapYMeters.length) {
    return reachScrollGapYMeters[frameIndex]
  }
  return reachScrollGapYMeters[
    2 + ((frameIndex - reachScrollGapYMeters.length) % 2)
  ]
}
