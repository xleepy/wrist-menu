import {
  WristMenu,
  defaultRevealConfiguration,
  type FrameSample,
  type HostSnapshot,
  type WristMenuProps,
  type WristMenuSessionFeatures,
  wristMenuSessionFeatures,
} from '@xleepy/wrist-menu/react'
import { completeSnapshot } from '../complete-snapshot.js'

const snapshot = {
  activationMode: 'forced-open',
  wrist: 'left',
  menuDefinition: [{ type: 'action', id: 'spawn-cube', label: 'Spawn cube' }],
} as const satisfies HostSnapshot
completeSnapshot satisfies HostSnapshot
const props = { snapshot, onEvent: () => undefined } satisfies WristMenuProps
const componentResult = WristMenu(props)
const features: WristMenuSessionFeatures = wristMenuSessionFeatures
const automaticSnapshot = {
  ...completeSnapshot,
  activationMode: 'automatic',
  comfort: { enterAngleDegrees: 30 },
  controllerWrist: { deviceTarget: 'quest-2' },
} as const satisfies HostSnapshot
const frame = {
  sequence: 1,
  time: 0,
  visibility: 'visible',
  viewerPosition: [0, 0, 1],
  wristSources: [],
  lifecycleRevision: 0,
  selectionSources: [],
} as const satisfies FrameSample

void componentResult
void features
void automaticSnapshot
void defaultRevealConfiguration
void frame
