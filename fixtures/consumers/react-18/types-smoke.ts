import {
  WristMenu,
  type WristMenuProps,
  type WristMenuSessionFeatures,
  wristMenuSessionFeatures,
} from '@xleepy/wrist-menu/react'

const props = {} satisfies WristMenuProps
const componentResult = WristMenu(props)
const features: WristMenuSessionFeatures = wristMenuSessionFeatures

void componentResult
void features
