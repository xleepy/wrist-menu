import { Matrix4 } from 'three'

import { FakeXrSession } from './controller-action.mjs'

export const rowTargetY = Object.freeze({
  action: 0.0675,
  toggle: 0.0225,
  choiceCube: -0.0225,
  choiceSphere: -0.045,
  disabledAction: -0.0675,
})

export const expectedControlledIntentOrder = Object.freeze([
  Object.freeze({
    type: 'toggle',
    itemId: 'show-grid',
    currentValue: true,
    proposedValue: false,
  }),
  Object.freeze({
    type: 'choice',
    groupId: 'primitive-shape',
    itemId: 'shape-sphere',
    currentValue: 'cube',
    proposedValue: 'sphere',
  }),
])

export function createHostControlledXrFixture() {
  const inputSource = {
    handedness: 'right',
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {},
  }
  const session = new FakeXrSession(inputSource)
  const referenceSpace = {}
  let targetY = rowTargetY.toggle
  const frame = {
    session,
    getPose(space, reference) {
      if (space !== inputSource.targetRaySpace || reference !== referenceSpace) {
        throw new Error('Renderer Integration requested an unexpected XR space')
      }
      return {
        transform: {
          matrix: new Matrix4().makeTranslation(0, targetY, 1).toArray(),
        },
      }
    },
  }
  const xr = {
    enabled: false,
    isPresenting: false,
    getSession: () => session,
    getReferenceSpace: () => referenceSpace,
    setAnimationLoop: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const renderer = {
    xr,
    render: () => undefined,
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    outputColorSpace: '',
    toneMapping: 0,
  }

  return {
    frame,
    inputSource,
    renderer,
    session,
    target(item) {
      targetY = rowTargetY[item]
    },
  }
}

export function driveControlledIntentJourney({
  advance,
  inputSource,
  session,
  target,
}) {
  advance(16)
  advance(32)

  target('toggle')
  advance(48)
  session.dispatch('selectstart', inputSource)
  advance(64)
  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  advance(80)

  target('choiceSphere')
  advance(96)
  session.dispatch('selectstart', inputSource)
  advance(112)
  session.dispatch('select', inputSource)
  session.dispatch('selectend', inputSource)
  advance(128)
}
