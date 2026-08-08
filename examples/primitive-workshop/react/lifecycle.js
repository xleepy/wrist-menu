/**
 * React-owned XR lifecycle state for the Primitive Workshop.
 *
 * This adapter intentionally lives beside the React Renderer Integration.
 * The Vanilla variant has its own copy so neither variant shares XR/session code.
 */

/** @typedef {'none' | 'hand' | 'controller'} WorkshopInputMode */
/** @typedef {'pre-session' | 'requesting' | 'active' | 'blurred' | 'hidden' | 'tracking-lost' | 'rejected' | 'ended'} WorkshopRuntimeStatus */
/** @typedef {'info' | 'warning' | 'error'} DiagnosticLevel */
/**
 * @typedef {Readonly<{
 *   level: DiagnosticLevel,
 *   code: string,
 *   message: string,
 *   nextAction: string,
 * }>} WorkshopDiagnostic
 */
/**
 * @typedef {Readonly<{
 *   variant: 'react',
 *   runtimeStatus: WorkshopRuntimeStatus,
 *   inputMode: WorkshopInputMode,
 *   availableWrists: readonly ('left' | 'right')[],
 *   cursorAvailable: boolean,
 *   interactionRevision: number,
 *   sessionRevision: number,
 *   diagnostic: WorkshopDiagnostic,
 * }>} WorkshopLifecycleSnapshot
 */
/**
 * @typedef {Readonly<{
 *   clearTransientInteraction?: (reason: string) => void,
 *   onChange?: (snapshot: WorkshopLifecycleSnapshot) => void,
 * }>} WorkshopLifecycleOptions
 */

/** @param {DiagnosticLevel} level @param {string} code @param {string} message @param {string} nextAction */
function diagnostic(level, code, message, nextAction) {
  return Object.freeze({ level, code, message, nextAction })
}

/** @param {XRInputSource} source */
function sourceMode(source) {
  return source.hand == null ? /** @type {const} */ ('controller') : /** @type {const} */ ('hand')
}

/** @param {Iterable<XRInputSource>} inputSources */
function describeSources(inputSources) {
  const sources = [...inputSources].filter((source) => source.handedness !== 'none')
  /** @type {('left' | 'right')[]} */
  const availableWrists = []
  if (sources.some((source) => source.handedness === 'left')) availableWrists.push('left')
  if (sources.some((source) => source.handedness === 'right')) availableWrists.push('right')
  /** @type {WorkshopInputMode} */
  const inputMode = sources.some((source) => sourceMode(source) === 'hand')
    ? 'hand'
    : sources.length > 0
      ? 'controller'
      : 'none'
  return Object.freeze({
    inputMode,
    availableWrists: Object.freeze(availableWrists),
  })
}

/** @param {WorkshopLifecycleOptions} [options] */
export function createWorkshopLifecycle(options = {}) {
  const clearTransientInteraction =
    options.clearTransientInteraction ?? (() => undefined)
  const onChange = options.onChange ?? (() => undefined)
  /** @type {WorkshopLifecycleSnapshot} */
  let state = Object.freeze({
    variant: 'react',
    runtimeStatus: 'pre-session',
    inputMode: 'none',
    availableWrists: Object.freeze([]),
    cursorAvailable: false,
    interactionRevision: 0,
    sessionRevision: 0,
    diagnostic: diagnostic(
      'info',
      'ready',
      'Ready to enter immersive VR.',
      'Select Enter VR',
    ),
  })
  /** @type {() => void} */
  let detachSession = () => undefined

  /** @param {Partial<WorkshopLifecycleSnapshot>} changes @param {string} [clearReason] */
  function transition(changes, clearReason) {
    if (clearReason !== undefined) clearTransientInteraction(clearReason)
    state = Object.freeze({
      ...state,
      ...changes,
      ...(clearReason === undefined
        ? {}
        : {
            cursorAvailable: false,
            interactionRevision: state.interactionRevision + 1,
          }),
      availableWrists: Object.freeze([
        ...(changes.availableWrists ?? state.availableWrists),
      ]),
    })
    onChange(state)
    return state
  }

  /** @param {Iterable<XRInputSource>} inputSources */
  function observeInputSources(inputSources) {
    const described = describeSources(inputSources)
    if (described.inputMode === 'none') {
      return transition(
        {
          runtimeStatus: 'tracking-lost',
          inputMode: 'none',
          availableWrists: described.availableWrists,
          diagnostic: diagnostic(
            'warning',
            'tracking-lost',
            'No tracked hand or controller is available.',
            'Restore tracking',
          ),
        },
        'tracking-lost',
      )
    }
    const changedMode =
      state.inputMode !== 'none' && state.inputMode !== described.inputMode
    return transition(
      {
        runtimeStatus: 'active',
        inputMode: described.inputMode,
        availableWrists: described.availableWrists,
        diagnostic: diagnostic(
          'info',
          'active',
          `VR active with ${described.inputMode} input.`,
          'Use the Wrist Menu',
        ),
      },
      changedMode ? 'input-mode-changed' : undefined,
    )
  }

  function sessionEnded() {
    detachSession()
    return transition(
      {
        runtimeStatus: 'ended',
        inputMode: 'none',
        availableWrists: [],
        diagnostic: diagnostic(
          'info',
          'session-ended',
          'The immersive session ended; Workshop state is preserved.',
          'Enter VR again',
        ),
      },
      'session-ended',
    )
  }

  return Object.freeze({
    beginSessionRequest() {
      detachSession()
      return transition(
        {
          runtimeStatus: 'requesting',
          inputMode: 'none',
          availableWrists: [],
          diagnostic: diagnostic(
            'info',
            'requesting',
            'Requesting an immersive VR session.',
            'Complete the browser prompt',
          ),
        },
        'session-requested',
      )
    },
    /** @param {unknown} error */
    sessionRejected(error) {
      detachSession()
      const detail = error instanceof Error ? error.message : String(error)
      return transition(
        {
          runtimeStatus: 'rejected',
          inputMode: 'none',
          availableWrists: [],
          diagnostic: diagnostic(
            'error',
            'session-rejected',
            `Could not enter VR: ${detail}`,
            'Retry Enter VR',
          ),
        },
        'session-rejected',
      )
    },
    /** @param {XRSession} session */
    sessionActivated(session) {
      detachSession()
      const visibilityChanged = () => {
        if (session.visibilityState === 'hidden') {
          transition(
            {
              runtimeStatus: 'hidden',
              diagnostic: diagnostic(
                'warning',
                'xr-hidden',
                'XR is hidden; interaction is paused.',
                'Return to the immersive view',
              ),
            },
            'xr-hidden',
          )
          return
        }
        if (session.visibilityState === 'visible-blurred') {
          transition(
            {
              runtimeStatus: 'blurred',
              diagnostic: diagnostic(
                'warning',
                'xr-blurred',
                'XR is blurred; interaction is paused.',
                'Focus the immersive view',
              ),
            },
            'xr-blurred',
          )
          return
        }
        observeInputSources(session.inputSources)
      }
      const inputSourcesChanged = () => observeInputSources(session.inputSources)
      const ended = () => sessionEnded()
      const detach = () => {
        session.removeEventListener('visibilitychange', visibilityChanged)
        session.removeEventListener('inputsourceschange', inputSourcesChanged)
        session.removeEventListener('end', ended)
        if (detachSession === detach) detachSession = () => undefined
      }
      session.addEventListener('visibilitychange', visibilityChanged)
      session.addEventListener('inputsourceschange', inputSourcesChanged)
      session.addEventListener('end', ended)
      detachSession = detach
      transition(
        {
          runtimeStatus: 'active',
          inputMode: 'none',
          availableWrists: [],
          sessionRevision: state.sessionRevision + 1,
          diagnostic: diagnostic(
            'info',
            'active',
            'VR active; waiting for tracked input.',
            'Show a hand or controller',
          ),
        },
        'session-activated',
      )
      return observeInputSources(session.inputSources)
    },
    observeInputSources,
    markCursorAvailable() {
      if (state.runtimeStatus !== 'active') return state
      return transition({ cursorAvailable: true })
    },
    /** @param {'left' | 'right'} wrist */
    reportUnavailableWrist(wrist) {
      return transition({
        diagnostic: diagnostic(
          'warning',
          'wrist-unavailable',
          `The ${wrist} wrist is not tracked.`,
          'Restore tracking or choose the other wrist',
        ),
      })
    },
    snapshot() {
      return state
    },
    dispose() {
      detachSession()
      clearTransientInteraction('disposed')
    },
  })
}
