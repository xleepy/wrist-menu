import {
  WristMenu,
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

void componentResult
void features
