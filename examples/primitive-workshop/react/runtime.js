import {
  workshopHostSnapshot,
} from '../shared/workshop-model.js'
import { createWorkshopLifecycle } from './lifecycle.js'

/** @typedef {import('../shared/workshop-model.js').WorkshopModel} WorkshopModel */
/** @typedef {import('../shared/workshop-model.js').WorkshopSnapshotOptions} WorkshopSnapshotOptions */
/** @typedef {ReturnType<ReturnType<typeof createWorkshopLifecycle>['snapshot']>} WorkshopLifecycleSnapshot */
/**
 * @typedef {Readonly<{
 *   hostSnapshot: import('@xleepy/wrist-menu').HostSnapshot,
 *   cursorVisible: boolean,
 * }>} WorkshopView
 */
/**
 * @typedef {Readonly<{
 *   readModel: () => WorkshopModel,
 *   readSnapshotOptions?: () => WorkshopSnapshotOptions,
 *   clearTransientInteraction?: (reason: string) => void,
 *   render: (view: WorkshopView, lifecycle: WorkshopLifecycleSnapshot) => void,
 * }>} WorkshopRuntimeOptions
 */

/**
 * Derive the complete React view input from portable model and lifecycle
 * state. Keeping this seam beside the variant makes lifecycle-only changes
 * observable without sharing renderer or XR integration code.
 * @param {WorkshopModel} model
 * @param {WorkshopLifecycleSnapshot} lifecycle
 * @param {WorkshopSnapshotOptions} [snapshotOptions]
 * @returns {WorkshopView}
 */
export function deriveWorkshopView(model, lifecycle, snapshotOptions = {}) {
  const hostSnapshot = workshopHostSnapshot(model, {
    ...snapshotOptions,
    ...(lifecycle.hasLiveSession
      ? {
          availableWrists: lifecycle.availableWrists,
          cursorAvailable: lifecycle.cursorAvailable,
        }
      : {}),
  })
  return Object.freeze({
    hostSnapshot,
    cursorVisible:
      model.placementCursor.status !== 'unavailable' &&
      (!lifecycle.hasLiveSession || lifecycle.cursorAvailable),
  })
}
/**
 * Bind the React lifecycle directly to the production render seam.
 * @param {WorkshopRuntimeOptions} options
 */
export function createWorkshopRuntime(options) {
  if (typeof options.render !== 'function') {
    throw new TypeError('Workshop runtime render callback is required')
  }
  const readSnapshotOptions = options.readSnapshotOptions ?? (() => ({}))
  return createWorkshopLifecycle({
    clearTransientInteraction: options.clearTransientInteraction,
    onChange: (lifecycle) => {
      options.render(
        deriveWorkshopView(
          options.readModel(),
          lifecycle,
          readSnapshotOptions(),
        ),
        lifecycle,
      )
    },
  })
}
