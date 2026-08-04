import type { ThreeElements } from '@react-three/fiber'

export {
  wristMenuSessionFeatures,
  type WristMenuSessionFeatures,
} from '../core/index.js'

/** Props reserved for the React Renderer Integration's scene group. */
export type WristMenuProps = Readonly<Omit<ThreeElements['group'], 'children'>>

/**
 * Inert bootstrap boundary for the future React Renderer Integration.
 *
 * It deliberately creates no Three.js resources and mounts no effects.
 */
export function WristMenu(_props: WristMenuProps): null {
  return null
}
