import type { ThreeElements } from '@react-three/fiber'
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react'

import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  updateThreeWristMenu,
  type HostSnapshot,
  type WristMenuEvent,
} from '../three/index.js'

export * from '../core/index.js'

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
  const [menuState] = useState(() =>
    createThreeWristMenuState({
      renderer,
      snapshot: initialSnapshotRef.current,
      onEvent: (event) => onEventRef.current(event),
    }),
  )

  useEffect(() => {
    if (lastSnapshotRef.current !== snapshot) {
      lastSnapshotRef.current = snapshot
      syncThreeWristMenu(menuState, snapshot)
    }
  }, [menuState, snapshot])

  useEffect(() => () => disposeThreeWristMenu(menuState), [menuState])

  fiber.useFrame((fiberState, _delta, frame) => {
    updateThreeWristMenu(menuState, {
      time: fiberState.clock.elapsedTime * 1000,
      frame: frame ?? null,
    })
  }, -1000)

  const stopSceneEvent = (event: SceneShieldEvent) => event.stopPropagation()
  const shieldProps: ThreeElements['primitive'] = {
    object: menuState.presentation.group,
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
 * Renderer Integration. Rendering outside an R3F root is intentionally inert
 * for SSR.
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
