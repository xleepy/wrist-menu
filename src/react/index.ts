export {
  wristMenuSessionFeatures,
  type WristMenuSessionFeatures,
} from '../core/index.js'

/** The bootstrap component accepts no content before integration behavior exists. */
export type WristMenuProps = Readonly<{ children?: never }>

/**
 * Inert bootstrap boundary for the future React Renderer Integration.
 *
 * It deliberately creates no Three.js resources and mounts no effects.
 */
export function WristMenu(_props: WristMenuProps): null {
  return null
}
