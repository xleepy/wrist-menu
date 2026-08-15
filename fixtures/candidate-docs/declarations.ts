import type { ReactElement } from 'react'

import {
  createWristMenuRuntimeState,
  disposeWristMenuRuntime,
  stepWristMenuRuntime,
  syncWristMenuRuntime,
  wristMenuRuntimeBlocksSceneInput,
  type FrameSample,
  type HostSnapshot,
  type TargetObservation,
  type WristMenuRuntimeState,
} from '@xleepy/wrist-menu'
import {
  WristMenu,
  type WristMenuProps,
} from '@xleepy/wrist-menu/react'
import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  type CreateThreeWristMenuOptions,
  type ThreeWristMenuState,
} from '@xleepy/wrist-menu/three'

declare const snapshot: HostSnapshot
declare const frame: FrameSample
declare const observations: readonly TargetObservation[]
declare const runtime: WristMenuRuntimeState
declare const threeOptions: CreateThreeWristMenuOptions
declare const inputSource: XRInputSource
declare const reactProps: WristMenuProps

const createdRuntime: WristMenuRuntimeState = createWristMenuRuntimeState({
  snapshot,
  onEvent: () => undefined,
})
syncWristMenuRuntime(runtime, snapshot)
const model = stepWristMenuRuntime(runtime, frame, observations)
const coreBlocksSceneEvent: boolean = wristMenuRuntimeBlocksSceneInput(
  runtime,
  'source-id',
)
disposeWristMenuRuntime(createdRuntime)

const menuState: ThreeWristMenuState = createThreeWristMenuState(threeOptions)
const group = menuState.presentation.group
syncThreeWristMenu(menuState, snapshot)
updateThreeWristMenu(menuState, { time: 0, frame: null })
const threeBlocksSceneEvent: boolean = threeWristMenuBlocksSceneInput(
  menuState,
  inputSource,
)
disposeThreeWristMenu(menuState)
const element: ReactElement | null = WristMenu(reactProps)

void model
void coreBlocksSceneEvent
void group
void threeBlocksSceneEvent
void element
