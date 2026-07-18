#!/usr/bin/env node
// THROWAWAY PROTOTYPE terminal shell. Do not ship this as package UI.

import {
  CONTROLLER_CONFIDENCES,
  CONTROLLER_OFFSETS,
  HOST_MODES,
  SESSION_VISIBILITIES,
  createPrototypeState,
  facingScoreFromAngle,
  getControllerOffset,
  wristRevealReducer,
} from './state-machine.mjs'
import { SCENARIOS, SCENARIO_NAMES } from './scenario-presets.mjs'

const args = process.argv.slice(2)
const traceIndex = args.indexOf('--trace')

if (traceIndex >= 0) {
  traceScenario(args[traceIndex + 1])
} else {
  runInteractive()
}

function runInteractive() {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      'This throwaway lab needs an interactive terminal. Try: node prototypes/wrist-anchoring-reveal/cli.mjs\n',
    )
    process.exitCode = 1
    return
  }

  let state = createPrototypeState()
  let scenarioName = null
  let scenarioStepIndex = 0

  render(state, scenarioName, scenarioStepIndex)
  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdin.resume()

  process.stdin.on('data', (key) => {
    if (key === '\u0003' || key === 'q') {
      process.stdin.setRawMode(false)
      process.stdout.write('\x1b[2J\x1b[HPrototype closed. No state was saved.\n')
      process.exit(0)
    }

    const scenarioFromKey = SCENARIO_NAMES.find((name) => SCENARIOS[name].key === key)
    if (scenarioFromKey) {
      scenarioName = scenarioFromKey
      scenarioStepIndex = 0
      state = loadScenario(scenarioName)
      state.lastAction = `loaded scenario: ${scenarioName}`
      render(state, scenarioName, scenarioStepIndex)
      return
    }

    if (key === 'n' && scenarioName) {
      const scenario = SCENARIOS[scenarioName]
      const step = scenario.steps[scenarioStepIndex]
      if (step) {
        state = wristRevealReducer(state, step.action)
        scenarioStepIndex += 1
      } else {
        state = { ...state, lastAction: `scenario complete: ${scenarioName}` }
      }
      render(state, scenarioName, scenarioStepIndex)
      return
    }

    const action = actionForKey(key, state)
    if (action) {
      if (action.type === 'RESET') {
        scenarioName = null
        scenarioStepIndex = 0
      }
      state = wristRevealReducer(state, action)
      render(state, scenarioName, scenarioStepIndex)
    }
  })
}

function actionForKey(key, state) {
  switch (key) {
    case ' ':
      return { type: 'TICK', ms: state.tuning.smallTickMs }
    case 't':
      return { type: 'TICK', ms: state.tuning.largeTickMs }
    case '[':
      return { type: 'ADJUST_FACING_ANGLE', deltaDeg: -5 }
    case ']':
      return { type: 'ADJUST_FACING_ANGLE', deltaDeg: 5 }
    case 'h':
      return { type: 'SET_SOURCE', sourceKind: 'hand' }
    case 'c':
      return { type: 'SET_SOURCE', sourceKind: 'controller' }
    case 'x':
      return {
        type: 'SET_TRACKING',
        sourceKind: state.sourceKind,
        tracked: !state.samples[state.sourceKind].tracked,
      }
    case 'w':
      return { type: 'SET_WRIST', wrist: state.menuWrist === 'left' ? 'right' : 'left' }
    case 'k':
      return {
        type: 'SET_CONTROLLER_CONFIDENCE',
        confidence: cycle(CONTROLLER_CONFIDENCES, state.samples.controller.confidence),
      }
    case 'o':
      return {
        type: 'SET_CONTROLLER_OFFSET',
        offsetName: cycle(
          CONTROLLER_OFFSETS.map((offset) => offset.name),
          state.samples.controller.offsetName,
        ),
      }
    case 'v':
      return {
        type: 'SET_SESSION_VISIBILITY',
        visibility: cycle(SESSION_VISIBILITIES, state.sessionVisibility),
      }
    case 'm':
      return { type: 'SET_HOST_MODE', hostMode: cycle(HOST_MODES, state.hostMode) }
    case 'i':
      return { type: 'ADJUST_TUNING', field: 'enterAngleDeg', delta: 5 }
    case 'I':
      return { type: 'ADJUST_TUNING', field: 'enterAngleDeg', delta: -5 }
    case 'u':
      return { type: 'ADJUST_TUNING', field: 'exitAngleDeg', delta: 5 }
    case 'U':
      return { type: 'ADJUST_TUNING', field: 'exitAngleDeg', delta: -5 }
    case 'd':
      return { type: 'ADJUST_TUNING', field: 'dwellMs', delta: 50 }
    case 'D':
      return { type: 'ADJUST_TUNING', field: 'dwellMs', delta: -50 }
    case 'a':
      return { type: 'ADJUST_TUNING', field: 'reacquireDwellMs', delta: 50 }
    case 'A':
      return { type: 'ADJUST_TUNING', field: 'reacquireDwellMs', delta: -50 }
    case 'g':
      return { type: 'ADJUST_TUNING', field: 'graceMs', delta: 50 }
    case 'G':
      return { type: 'ADJUST_TUNING', field: 'graceMs', delta: -50 }
    case 'p':
      return { type: 'ADJUST_TUNING', field: 'transitionMs', delta: 50 }
    case 'P':
      return { type: 'ADJUST_TUNING', field: 'transitionMs', delta: -50 }
    case '0':
      return { type: 'RESET' }
    default:
      return null
  }
}

function loadScenario(name) {
  const scenario = SCENARIOS[name]
  let state = createPrototypeState()
  for (const action of scenario.setup) {
    state = wristRevealReducer(state, action)
  }
  return state
}

function render(state, scenarioName, scenarioStepIndex) {
  const b = '\x1b[1m'
  const d = '\x1b[2m'
  const r = '\x1b[0m'
  const scenario = scenarioName ? SCENARIOS[scenarioName] : null
  const nextStep = scenario?.steps[scenarioStepIndex]
  const hand = state.samples.hand
  const controller = state.samples.controller
  const selected = state.samples[state.sourceKind]
  const offset = getControllerOffset(state)
  const anchor = formatVector(state.output.anchorPosition)
  const controllerTranslation = formatVector(offset.translationMeters)
  const controllerRotation = formatVector(offset.rotationDeg)

  const lines = [
    `${b}THROWAWAY WRIST REVEAL STATE LAB${r} ${d}(illustrative values; no defaults decided)${r}`,
    `${b}Question${r} Can reveal stay intentional across lifecycle, tracking, and host overrides?`,
    `${b}Scenario${r} ${scenarioName ?? 'free drive'}${scenario ? ` — ${scenario.description}` : ''}`,
    `${b}Queue${r} ${scenario ? `${scenarioStepIndex}/${scenario.steps.length}; next: ${nextStep?.label ?? 'complete'}` : 'press 1-4 to load, then n to advance'}`,
    `${b}Last action${r} ${state.lastAction}`,
    '',
    `${b}SESSION / HOST${r}`,
    `time ${state.timeMs} ms | session ${state.sessionVisibility} | host ${state.hostMode}`,
    `wrist ${state.menuWrist} | selected source ${state.sourceKind} | anchor ${anchor}`,
    '',
    `${b}POSE SAMPLES${r}`,
    `hand       tracked ${yesNo(hand.tracked)} | angle ${formatNumber(hand.facingAngleDeg)}° | score ${formatNumber(facingScoreFromAngle(hand.facingAngleDeg), 3)}`,
    `controller tracked ${yesNo(controller.tracked)} | angle ${formatNumber(controller.facingAngleDeg)}° | score ${formatNumber(facingScoreFromAngle(controller.facingAngleDeg), 3)} | confidence ${controller.confidence}`,
    `controller offset ${offset.name} | translation ${controllerTranslation} m | rotation ${controllerRotation}°`,
    `selected   tracked ${yesNo(selected.tracked)} | auto eligible ${yesNo(state.output.automaticEligible)} | facing ${formatNumber(state.output.facingAngleDeg)}° / ${formatNumber(state.output.facingScore, 3)}`,
    '',
    `${b}STATE MACHINE${r}`,
    `tracking ${state.tracking.status} | fresh dwell ${yesNo(state.tracking.freshDwellRequired)} | lost at ${formatMaybe(state.tracking.lastLostAtMs)} | reacquired at ${formatMaybe(state.tracking.reacquiredAtMs)}`,
    `activation ${state.activation.phase} | reason ${state.activation.reason} | dwell remaining ${formatMaybe(state.output.dwellRemainingMs)}`,
    `presentation ${state.presentation.phase} | opacity ${formatNumber(state.output.opacity, 2)} | held pose ${yesNo(state.presentation.heldPose)} | grace remaining ${formatMaybe(state.output.graceRemainingMs)} | transition remaining ${formatMaybe(state.output.transitionRemainingMs)}`,
    `output interactive ${yesNo(state.output.interactive)} | reason ${state.output.reason}`,
    state.output.tuningWarning ? `WARNING: ${state.output.tuningWarning}` : '',
    '',
    `${b}ADJUSTABLE HYPOTHESES${r}`,
    `enter ≤${state.tuning.enterAngleDeg}° (score ≥${formatNumber(facingScoreFromAngle(state.tuning.enterAngleDeg), 3)}) | exit >${state.tuning.exitAngleDeg}° (score <${formatNumber(facingScoreFromAngle(state.tuning.exitAngleDeg), 3)})`,
    `dwell ${state.tuning.dwellMs} ms | reacquire dwell ${state.tuning.reacquireDwellMs} ms | grace ${state.tuning.graceMs} ms | transition ${state.tuning.transitionMs} ms`,
    '',
    `${b}KEYS${r}`,
    `[1-4] scenarios  [n] next scenario event  [0] reset  [q] quit`,
    `[space] +${state.tuning.smallTickMs} ms  [t] +${state.tuning.largeTickMs} ms  [[] more facing  []] more away  [x] tracking`,
    `[h] hand  [c] controller  [w] wrist  [k] controller confidence  [o] controller offset`,
    `[v] session visibility  [m] host mode`,
    `[i/I] enter angle +/-  [u/U] exit angle +/-  [d/D] dwell +/-`,
    `[a/A] reacquire dwell +/-  [g/G] grace +/-  [p/P] transition +/-`,
  ].filter((line, index, all) => line !== '' || all[index - 1] !== '')

  process.stdout.write(`\x1b[2J\x1b[H${lines.join('\n')}\n`)
}

function traceScenario(name) {
  const scenario = SCENARIOS[name]
  if (!scenario) {
    process.stderr.write(`Unknown scenario "${name}". Choose: ${SCENARIO_NAMES.join(', ')}\n`)
    process.exitCode = 1
    return
  }

  let state = loadScenario(name)
  process.stdout.write(`THROWAWAY TRACE: ${name}\n`)
  process.stdout.write(`${traceLine('setup', state)}\n`)
  scenario.steps.forEach((step, index) => {
    state = wristRevealReducer(state, step.action)
    process.stdout.write(`${traceLine(`${index + 1}. ${step.label}`, state)}\n`)
  })
}

function traceLine(label, state) {
  return [
    label,
    `t=${state.timeMs}`,
    `session=${state.sessionVisibility}`,
    `host=${state.hostMode}`,
    `tracked=${state.output.selectedPoseTracked}`,
    `angle=${state.output.facingAngleDeg}`,
    `eligible=${state.output.automaticEligible}`,
    `activation=${state.activation.phase}`,
    `presentation=${state.presentation.phase}`,
    `opacity=${formatNumber(state.output.opacity, 2)}`,
    `interactive=${state.output.interactive}`,
    `dwell=${formatMaybe(state.output.dwellRemainingMs)}`,
    `grace=${formatMaybe(state.output.graceRemainingMs)}`,
    `reason=${state.output.reason}`,
  ].join(' | ')
}

function cycle(values, current) {
  const index = values.indexOf(current)
  return values[(index + 1) % values.length]
}

function yesNo(value) {
  return value ? 'yes' : 'no'
}

function formatNumber(value, digits = 1) {
  return Number(value).toFixed(digits)
}

function formatMaybe(value) {
  return value === null ? '—' : `${value} ms`
}

function formatVector(vector) {
  return `[${vector.map((value) => formatNumber(value, 3)).join(', ')}]`
}
