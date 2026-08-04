import type { ThreeElements } from '@react-three/fiber'
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Group } from 'three/src/objects/Group.js'

import {
  createThreeWristMenu,
  type HostSnapshot,
  type WristMenuEvent,
} from '../three/index.js'

export {
  createWristMenuRuntime,
  defaultRevealConfiguration,
  resolveControllerWristOffset,
  resolveRevealConfiguration,
  wristMenuSessionFeatures,
  type ActivationMode,
  type ControllerDeviceTarget,
  type ControllerSelectionSourceSample,
  type ControllerWristConfiguration,
  type ControllerWristOffset,
  type ControllerWristPreset,
  type FrameSample,
  type HostSnapshot,
  type PoseSample,
  type PresentationModel,
  type QuaternionTuple,
  type RevealConfiguration,
  type RevealConfigurationOverrides,
  type RevealPhase,
  type SelectionIntent,
  type TargetObservation,
  type Vector3Tuple,
  type WristAnchorPose,
  type WristSourceSample,
  type WristMenuEvent,
  type WristMenuSessionFeatures,
  type WristMenuRuntime,
} from '../core/index.js'

export type WristMenuProps = Readonly<{
  snapshot: HostSnapshot
  onEvent: (event: WristMenuEvent) => void
}>

type SceneShieldEvent = Readonly<{
  stopPropagation(): void
}>

type FiberModule = typeof import('@react-three/fiber')

type MountedWristMenuProps = WristMenuProps &
  Readonly<{ fiber: FiberModule }>

function MountedWristMenu({
  snapshot,
  onEvent,
  fiber,
}: MountedWristMenuProps): ReactElement {
  const renderer = fiber.useThree((state) => state.gl)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent
  const initialSnapshotRef = useRef(snapshot)
  const lastSnapshotRef = useRef(snapshot)
  const [instance] = useState(() =>
    createThreeWristMenu({
      renderer,
      snapshot: initialSnapshotRef.current,
      onEvent: (event) => onEventRef.current(event),
    }),
  )
  const [shieldGroup] = useState(() => {
    const group = new Group()
    group.name = 'wrist-menu-scene-event-shield'
    group.add(instance.group)
    return group
  })

  useEffect(() => {
    if (lastSnapshotRef.current !== snapshot) {
      lastSnapshotRef.current = snapshot
      instance.sync(snapshot)
    }
  }, [instance, snapshot])

  useEffect(() => () => instance.dispose(), [instance])

  fiber.useFrame((state, _delta, frame) => {
    instance.update({
      time: state.clock.elapsedTime * 1000,
      frame: frame ?? null,
    })
  }, -1000)

  const stopSceneEvent = (event: SceneShieldEvent) => event.stopPropagation()
  const shieldProps: ThreeElements['primitive'] = {
    object: shieldGroup,
    onPointerOver: stopSceneEvent,
    onPointerMove: stopSceneEvent,
    onPointerDown: stopSceneEvent,
    onPointerUp: stopSceneEvent,
    onPointerCancel: stopSceneEvent,
    onClick: stopSceneEvent,
    onDoubleClick: stopSceneEvent,
    onContextMenu: stopSceneEvent,
  }

  return createElement('primitive', shieldProps)
}

/**
 * React Three Fiber lifecycle and Scene Event Shield for the shared Three.js
 * integration. Rendering outside an R3F root is intentionally inert for SSR.
 */
export function WristMenu(props: WristMenuProps): ReactElement | null {
  const [fiber, setFiber] = useState<FiberModule>()

  useEffect(() => {
    let mounted = true
    void import('@react-three/fiber').then((module) => {
      if (mounted) setFiber(module)
    })
    return () => {
      mounted = false
    }
  }, [])

  if (fiber === undefined) return null
  return createElement(MountedWristMenu, { ...props, fiber })
}
