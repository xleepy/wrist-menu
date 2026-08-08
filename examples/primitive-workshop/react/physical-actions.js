import { createPhysicalActionCoordinator } from '../shared/workshop-model.js'

/** @typedef {import('@xleepy/wrist-menu').WristMenuEvent} WristMenuEvent */
/**
 * @typedef {Readonly<{
 *   lifetimeMs?: number,
 *   now?: () => number,
 * }>} ReactPhysicalActionOptions
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

/** @param {object} occurrence */
function inputSourceFromSceneOccurrence(occurrence) {
  if (!('pointerState' in occurrence)) return null
  const pointerState = occurrence.pointerState
  if (
    typeof pointerState !== 'object' ||
    pointerState === null ||
    !('inputSource' in pointerState)
  ) {
    return null
  }
  const inputSource = pointerState.inputSource
  return typeof inputSource === 'object' && inputSource !== null
    ? /** @type {XRInputSource} */ (inputSource)
    : null
}

/** @param {ReactPhysicalActionOptions} [options] */
export function createPhysicalActions(options = {}) {
  const physicalActions = createPhysicalActionCoordinator({
    prefix: 'react-xr',
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
    /** @param {object} occurrence */
    sceneAction(occurrence) {
      const inputSource = inputSourceFromSceneOccurrence(occurrence)
      if (inputSource === null) return null
      const descriptor = descriptorFor(inputSource)
      return descriptor === null
        ? null
        : physicalActions.sceneAction(inputSource, descriptor, occurrence)
    },
    /**
     * @param {WristMenuEvent} event
     * @param {XRInputSource | null} inputSource
     */
    menuAction(event, inputSource) {
      if (event.type === 'selection-intent' && inputSource !== null) {
        const descriptor = descriptorFor(inputSource)
        if (descriptor !== null) {
          physicalActions.bindMenuSource(
            event.source.id,
            inputSource,
            descriptor,
          )
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
