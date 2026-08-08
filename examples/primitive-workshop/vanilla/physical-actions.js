import { createPhysicalActionCoordinator } from '../shared/workshop-model.js'

/**
 * @param {Parameters<typeof createPhysicalActionCoordinator>[0]} [options]
 */
export function createPhysicalActions(options = {}) {
  return createPhysicalActionCoordinator({ ...options, prefix: 'vanilla-xr' })
}
