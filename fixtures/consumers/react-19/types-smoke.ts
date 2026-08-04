import {
  WristMenu,
  type HostSnapshot,
  type WristMenuProps,
  type WristMenuSessionFeatures,
  wristMenuSessionFeatures,
} from '@xleepy/wrist-menu/react'

const snapshot = {
  activationMode: 'forced-open',
  wrist: 'left',
  menuDefinition: [{ type: 'action', id: 'spawn-cube', label: 'Spawn cube' }],
} as const satisfies HostSnapshot
const completeSnapshot = {
  activationMode: 'forced-open',
  wrist: 'right',
  menuDefinition: [
    { type: 'action', id: 'reset', label: 'Reset' },
    { type: 'separator', label: 'Scene' },
    { type: 'toggle', id: 'grid', label: 'Grid', value: true },
    {
      type: 'choice-group',
      id: 'shape',
      label: 'Shape',
      selectedValue: 1,
      options: [
        { id: 'cube', label: 'Cube', value: 1 },
        { id: 'sphere', label: 'Sphere', value: 2 },
      ],
    },
  ],
} as const satisfies HostSnapshot
const props = { snapshot, onEvent: () => undefined } satisfies WristMenuProps
const componentResult = WristMenu(props)
const features: WristMenuSessionFeatures = wristMenuSessionFeatures

void componentResult
void features
void completeSnapshot
