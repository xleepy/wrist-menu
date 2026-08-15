import { createPhysicalActionCoordinator } from '../shared/workshop-model.js'

/** @typedef {import('@xleepy/wrist-menu').WristMenuEvent} WristMenuEvent */
/**
 * @typedef {Readonly<{
 *   lifetimeMs?: number,
 *   now?: () => number,
 *   inputSourceForMenuSourceId(sourceId: string): XRInputSource | null,
 * }>} VanillaPhysicalActionOptions
 */

/** @param {XRInputSource} inputSource */
function descriptorFor(inputSource) {
  if (inputSource.handedness === 'none') return null
  return Object.freeze({
    kind:
      inputSource.hand == null
        ? /** @type {const} */ ('controller')
        : /** @type {const} */ ('hand'),
    handedness: inputSource.handedness,
  })
}

/** @param {VanillaPhysicalActionOptions} options */
export function createPhysicalActions(options) {
  const physicalActions = createPhysicalActionCoordinator({
    prefix: 'vanilla-xr',
    lifetimeMs: options.lifetimeMs,
    now: options.now,
  })
  /** @type {() => void} */
  let detachSession = () => undefined

  return Object.freeze({
    /** @param {XRSession} session */
    attachSession(session) {
      detachSession()
      physicalActions.clear()
      /** @param {XRInputSourceEvent} event */
      const selectStart = (event) => {
        const descriptor = descriptorFor(event.inputSource)
        if (descriptor !== null) {
          physicalActions.selectStart(event.inputSource, descriptor, event)
        }
      }
      /** @param {XRInputSourceEvent} event */
      const selectEnd = (event) => {
        physicalActions.selectEnd(event.inputSource)
      }
      /** @param {XRInputSourcesChangeEvent} event */
      const removeInputSources = (event) => {
        for (const inputSource of event.removed) {
          physicalActions.removeSource(inputSource)
        }
      }
      const end = () => {
        physicalActions.clear()
        detach()
      }
      const detach = () => {
        session.removeEventListener('selectstart', selectStart)
        session.removeEventListener('selectend', selectEnd)
        session.removeEventListener('inputsourceschange', removeInputSources)
        session.removeEventListener('end', end)
        if (detachSession === detach) detachSession = () => undefined
      }
      session.addEventListener('selectstart', selectStart)
      session.addEventListener('selectend', selectEnd)
      session.addEventListener('inputsourceschange', removeInputSources)
      session.addEventListener('end', end)
      detachSession = detach
      return detach
    },
    /** @param {XRInputSourceEvent} occurrence */
    sceneAction(occurrence) {
      const descriptor = descriptorFor(occurrence.inputSource)
      return descriptor === null
        ? null
        : physicalActions.sceneAction(
            occurrence.inputSource,
            descriptor,
            occurrence,
          )
    },
    /** @param {WristMenuEvent} event */
    menuAction(event) {
      if (event.type === 'selection-intent') {
        const inputSource = options.inputSourceForMenuSourceId(event.source.id)
        if (inputSource !== null) {
          const descriptor = descriptorFor(inputSource)
          if (descriptor !== null) {
            physicalActions.bindMenuSource(
              event.source.id,
              inputSource,
              descriptor,
            )
          }
        }
      }
      return physicalActions.menuAction(event)
    },
    clearTransientInteraction() {
      physicalActions.clear()
    },
    dispose() {
      detachSession()
      physicalActions.clear()
    },
  })
}
