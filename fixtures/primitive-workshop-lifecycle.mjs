/**
 * Known-good, renderer-neutral Primitive Workshop acceptance fixtures.
 *
 * These literals are deliberately independent of the Workshop Model so they
 * remain useful as expected values for both Example Variants.
 */

export const workshopCapacityPositions = Object.freeze([
  [-0.75, 0, -0.5],
  [-0.5, 0, -0.5],
  [-0.25, 0, -0.5],
  [0, 0, -0.5],
  [0.25, 0, -0.5],
  [0.5, 0, -0.5],
  [-0.75, 0, -0.25],
  [-0.5, 0, -0.25],
  [-0.25, 0, -0.25],
  [0, 0, -0.25],
  [0.25, 0, -0.25],
  [0.5, 0, -0.25],
].map((position) => Object.freeze(position)))

export const workshopPlacementFixtures = Object.freeze({
  invalid: Object.freeze([1.25, 0, 0]),
  occupied: workshopCapacityPositions[0],
})

export const workshopInputLanes = Object.freeze([
  Object.freeze({ kind: 'hand', menuWrist: 'left' }),
  Object.freeze({ kind: 'controller', menuWrist: 'left' }),
  Object.freeze({ kind: 'hand', menuWrist: 'right' }),
  Object.freeze({ kind: 'controller', menuWrist: 'right' }),
])

export const workshopScenarioNames = Object.freeze([
  'default',
  'full-workshop',
  'empty-definition',
  'shield',
])
