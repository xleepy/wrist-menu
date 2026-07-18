// THROWAWAY PROTOTYPE scenario queues. These are questions, not acceptance tests.

export const SCENARIOS = Object.freeze({
  'accidental-flicker': Object.freeze({
    key: '1',
    description: 'Noisy enter-angle crossings should expose dwell cancellation.',
    setup: Object.freeze([
      { type: 'SET_SOURCE', sourceKind: 'hand' },
      { type: 'SET_WRIST', wrist: 'left' },
      { type: 'SET_SESSION_VISIBILITY', visibility: 'visible' },
      { type: 'SET_HOST_MODE', hostMode: 'automatic' },
      { type: 'SET_TRACKING', sourceKind: 'hand', tracked: true },
      { type: 'SET_FACING_ANGLE', sourceKind: 'hand', angleDeg: 55 },
    ]),
    steps: Object.freeze([
      step('cross just inside enter angle', { type: 'SET_FACING_ANGLE', angleDeg: 34 }),
      step('hold for only 100 ms', { type: 'TICK', ms: 100 }),
      step('noise crosses back outside enter angle', { type: 'SET_FACING_ANGLE', angleDeg: 38 }),
      step('wait 100 ms outside', { type: 'TICK', ms: 100 }),
      step('cross inside again', { type: 'SET_FACING_ANGLE', angleDeg: 32 }),
      step('hold for 150 ms', { type: 'TICK', ms: 150 }),
      step('noise cancels dwell again', { type: 'SET_FACING_ANGLE', angleDeg: 37 }),
    ]),
  }),
  'intentional-reveal': Object.freeze({
    key: '2',
    description: 'Stable facing, enter dwell, transition, exit hysteresis, and hide.',
    setup: Object.freeze([
      { type: 'SET_SOURCE', sourceKind: 'hand' },
      { type: 'SET_WRIST', wrist: 'right' },
      { type: 'SET_SESSION_VISIBILITY', visibility: 'visible' },
      { type: 'SET_HOST_MODE', hostMode: 'automatic' },
      { type: 'SET_TRACKING', sourceKind: 'hand', tracked: true },
      { type: 'SET_FACING_ANGLE', sourceKind: 'hand', angleDeg: 60 },
    ]),
    steps: Object.freeze([
      step('turn palm deliberately toward viewer', { type: 'SET_FACING_ANGLE', angleDeg: 25 }),
      step('hold stable for 150 ms', { type: 'TICK', ms: 150 }),
      step('continue through the configured dwell window', { type: 'TICK', ms: 150 }),
      step('complete the appearance transition', { type: 'TICK', ms: 150 }),
      step('move within hysteresis band (still latched)', { type: 'SET_FACING_ANGLE', angleDeg: 45 }),
      step('cross the wider exit angle', { type: 'SET_FACING_ANGLE', angleDeg: 55 }),
      step('complete the hide transition', { type: 'TICK', ms: 150 }),
    ]),
  }),
  'brief-occlusion': Object.freeze({
    key: '3',
    description: 'Visual grace must not preserve interaction, dwell, or a press.',
    setup: Object.freeze([
      { type: 'SET_SOURCE', sourceKind: 'hand' },
      { type: 'SET_WRIST', wrist: 'left' },
      { type: 'SET_SESSION_VISIBILITY', visibility: 'visible' },
      { type: 'SET_HOST_MODE', hostMode: 'automatic' },
      { type: 'SET_TRACKING', sourceKind: 'hand', tracked: true },
      { type: 'SET_FACING_ANGLE', sourceKind: 'hand', angleDeg: 25 },
    ]),
    steps: Object.freeze([
      step('satisfy initial dwell', { type: 'TICK', ms: 300 }),
      step('finish showing the menu', { type: 'TICK', ms: 150 }),
      step('hand becomes occluded', { type: 'SET_TRACKING', sourceKind: 'hand', tracked: false }),
      step('hold cached visual for 50 ms without interaction', { type: 'TICK', ms: 50 }),
      step('tracking is reacquired', { type: 'SET_TRACKING', sourceKind: 'hand', tracked: true }),
      step('serve half the fresh dwell', { type: 'TICK', ms: 100 }),
      step('complete fresh dwell as grace reaches its boundary', { type: 'TICK', ms: 100 }),
      step('settle presentation', { type: 'TICK', ms: 150 }),
    ]),
  }),
  'forced-visibility': Object.freeze({
    key: '4',
    description: 'Host overrides bypass automatic eligibility, but not XR lifecycle safety.',
    setup: Object.freeze([
      { type: 'SET_SOURCE', sourceKind: 'controller' },
      { type: 'SET_WRIST', wrist: 'right' },
      { type: 'SET_SESSION_VISIBILITY', visibility: 'visible' },
      { type: 'SET_HOST_MODE', hostMode: 'automatic' },
      { type: 'SET_TRACKING', sourceKind: 'controller', tracked: true },
      { type: 'SET_CONTROLLER_CONFIDENCE', confidence: 'low' },
      { type: 'SET_CONTROLLER_OFFSET', offsetName: 'inward' },
      { type: 'SET_FACING_ANGLE', sourceKind: 'controller', angleDeg: 20 },
    ]),
    steps: Object.freeze([
      step('automatic reveal stays blocked by low confidence', { type: 'TICK', ms: 300 }),
      step('Host Application forces menu open', { type: 'SET_HOST_MODE', hostMode: 'forced-open' }),
      step('finish forced-open transition', { type: 'TICK', ms: 150 }),
      step('system UI makes session visible-blurred', {
        type: 'SET_SESSION_VISIBILITY',
        visibility: 'visible-blurred',
      }),
      step('time passes while input and activation are paused', { type: 'TICK', ms: 250 }),
      step('session returns visible and pose must be fresh', {
        type: 'SET_SESSION_VISIBILITY',
        visibility: 'visible',
      }),
      step('Host Application forces menu closed', {
        type: 'SET_HOST_MODE',
        hostMode: 'forced-closed',
      }),
      step('finish forced-close transition', { type: 'TICK', ms: 150 }),
      step('disabled removes presentation immediately', {
        type: 'SET_HOST_MODE',
        hostMode: 'disabled',
      }),
    ]),
  }),
})

export const SCENARIO_NAMES = Object.freeze(Object.keys(SCENARIOS))

function step(label, action) {
  return Object.freeze({ label, action: Object.freeze({ ...action, label }) })
}
