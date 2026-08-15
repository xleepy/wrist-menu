import assert from 'node:assert/strict'

import { controllerActionSnapshot } from '../controller-action.mjs'
import { crossInputSnapshot } from '../cross-input-selection.mjs'
import {
  runRendererJourneyEvidence,
  sceneActionTypes,
} from './journey-evidence.mjs'
import {
  createIwerControllerFixture,
  createIwerHandFixture,
  createReactIwerRendererHarness,
} from './react-renderer-harness.mjs'
import { reachScrollGapYMeters } from './reach-scroll-workload.mjs'

const REACH_ROW_STRIDE_METERS = 0.0225
const REACH_VIEWPORT_TOP_METERS = 0.039
function snapshotForWrist(snapshot, wrist) {
  return {
    ...snapshot,
    wrist,
    controllerWrist: {
      offsets: {
        left: {
          translationMeters: [0, 0, 0],
          rotationDegrees: [0, 0, 0],
        },
        right: {
          translationMeters: [0, 0, 0],
          rotationDegrees: [0, 0, 0],
        },
      },
    },
  }
}

function withViewerPosition(frame, [x, y, z], fixture, sourceKind) {
  if (sourceKind === 'controller') {
    const originalGetPose = frame.getPose.bind(frame)
    Object.defineProperty(frame, 'getPose', {
      configurable: true,
      value(space, referenceSpace) {
        const pose = originalGetPose(space, referenceSpace)
        return space === fixture.menuInput.inputSource.gripSpace && pose !== null
          ? {
              transform: pose.transform,
              emulatedPosition: false,
            }
          : pose
      },
    })
  }
  Object.defineProperty(frame, 'getViewerPose', {
    configurable: true,
    value: () => ({
      transform: { position: { x, y, z } },
      views: [],
    }),
  })
  return frame
}

function setControllerRayAtPanelLocal(fixture, group, three, x, y) {
  const origin = group.localToWorld(new three.Vector3(x, y, 1))
  const orientation = group.getWorldQuaternion(new three.Quaternion())
  fixture.controller.position.set(origin.x, origin.y, origin.z)
  fixture.controller.quaternion.set(
    orientation.x,
    orientation.y,
    orientation.z,
    orientation.w,
  )
}

function presentationModelSignature(group) {
  const rows = []
  group.traverse((object) => {
    if (
      object.visible &&
      object.name.startsWith('wrist-menu-') &&
      object.name.includes('-visual:')
    ) {
      rows.push([
        object.name,
        object.userData['wristMenuLabel'] ?? null,
        object.userData['wristMenuValue'] ?? null,
      ].join('|'))
    }
  })
  return rows
}

function observedPresentationScrollOffset(group) {
  let firstVisual
  group.traverse((object) => {
    if (
      firstVisual === undefined &&
      object.visible &&
      /^wrist-menu-action-visual:row-\d+$/.test(object.name)
    ) {
      firstVisual = object
    }
  })
  if (firstVisual === undefined) return null
  const rowIndex = Number(firstVisual.name.slice(firstVisual.name.lastIndexOf('-') + 1))
  const rowCenterAtTop = REACH_VIEWPORT_TOP_METERS - 0.01
  const offset = rowIndex +
    (firstVisual.position.y - rowCenterAtTop) / REACH_ROW_STRIDE_METERS
  return Math.abs(offset) < 1e-9 ? 0 : offset
}

function terminalWristMenuEvents(events) {
  return events
    .filter(({ type }) =>
      type === 'selection-intent' || type === 'selection-cancellation')
    .map((event) => ({
      type: event.type,
      ...(event.type === 'selection-cancellation'
        ? { reason: event.reason }
        : { itemId: event.intent.itemId }),
      time: event.time,
    }))
}

function threeBehindTarget(three) {
  const target = new three.Object3D()
  const deliveries = new Map(sceneActionTypes.map((type) => [type, 0]))
  for (const type of sceneActionTypes) {
    target.addEventListener(type, () => {
      deliveries.set(type, deliveries.get(type) + 1)
    })
  }
  return {
    dispatch(blocked) {
      return sceneActionTypes.map((type) => {
        const before = deliveries.get(type)
        if (!blocked) target.dispatchEvent({ type })
        return {
          type,
          behindTargetDeliveries: deliveries.get(type) - before,
        }
      })
    },
  }
}

async function runThreeShieldMatrix({
  sourceKind,
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}, scenarios) {
  const cases = []
  for (const { id } of scenarios) {
    const fixture = sourceKind === 'controller'
      ? await createIwerControllerFixture(iwer)
      : await createIwerHandFixture(iwer)
    const events = []
    const menu = createThreeWristMenuState({
      renderer: {
        xr: {
          getSession: () => fixture.session,
          getReferenceSpace: () => fixture.referenceSpace,
        },
      },
      snapshot: crossInputSnapshot,
      onEvent: (event) => events.push(event),
    })
    const behind = threeBehindTarget(three)
    let rendererFrames = 0
    let disposed = false
    let time = 0
    const update = (frame) => {
      rendererFrames += 1
      updateThreeWristMenu(menu, { time: time += 16, frame })
    }
    try {
      const initialFrame = fixture.nextFrame(time += 16)
      update(initialFrame)
      update(fixture.nextFrame(time += 16))
      if (sourceKind === 'controller') {
        fixture.controller.position.set(
          menu.presentation.group.position.x,
          menu.presentation.group.position.y,
          menu.presentation.group.position.z + 1,
        )
        update(fixture.nextFrame(time += 16))
        update(fixture.press(time += 16))
      } else {
        const hoverTarget = menu.presentation.group.localToWorld(
          new three.Vector3(0, 0.0225, 0.03),
        )
        fixture.moveFingertipTo(initialFrame, hoverTarget)
        update(fixture.nextFrame(time += 16))
        if (id === 'hold') {
          const frame = fixture.nextFrame(time += 16)
          fixture.moveFingertipTo(
            frame,
            menu.presentation.group.localToWorld(
              new three.Vector3(0, 0.0225, 0.008),
            ),
          )
          update(fixture.nextFrame(time += 16))
        }
      }

      if (id === 'hold') {
        update(fixture.nextFrame(time += 16))
        update(fixture.nextFrame(time += 16))
      }
      const dispatches = behind.dispatch(
        threeWristMenuBlocksSceneInput(menu, fixture.inputSource),
      )

      let neutralTransitions = 0
      if (id === 'cancel') {
        fixture.menuInput.connected = false
        update(fixture.nextFrame(time += 16))
        neutralTransitions += 1
      } else if (sourceKind === 'controller') {
        if (id === 'commit' || id === 'hold') {
          update(fixture.release(time += 16))
          neutralTransitions += 1
        } else if (id === 'rapid-actions') {
          update(fixture.release(time += 16))
          neutralTransitions += 1
          update(fixture.nextFrame(time += 16))
          update(fixture.press(time += 16))
          update(fixture.release(time += 16))
          neutralTransitions += 1
        } else {
          fixture.controller.position.x += 2
          update(fixture.release(time += 16))
          neutralTransitions += 1
        }
        fixture.controller.position.x += 2
        update(fixture.nextFrame(time += 16))
      } else {
        if (id === 'commit' || id === 'rapid-actions') {
          const frame = fixture.nextFrame(time += 16)
          const pressTarget = menu.presentation.group.localToWorld(
            new three.Vector3(0, 0.0225, 0.008),
          )
          fixture.moveFingertipTo(frame, pressTarget)
          update(fixture.nextFrame(time += 16))
        }
        if (id === 'rapid-actions') {
          fixture.selectionInput.position.x += 2
          update(fixture.nextFrame(time += 16))
          neutralTransitions += 1
          const hoverFrame = fixture.nextFrame(time += 16)
          fixture.moveFingertipTo(
            hoverFrame,
            menu.presentation.group.localToWorld(
              new three.Vector3(0, 0.0225, 0.03),
            ),
          )
          update(fixture.nextFrame(time += 16))
          const pressFrame = fixture.nextFrame(time += 16)
          fixture.moveFingertipTo(
            pressFrame,
            menu.presentation.group.localToWorld(
              new three.Vector3(0, 0.0225, 0.008),
            ),
          )
          update(fixture.nextFrame(time += 16))
        }
        fixture.selectionInput.position.x += 2
        update(fixture.nextFrame(time += 16))
        neutralTransitions += 1
      }

      const mountedRecoveryDispatches = behind.dispatch(
        threeWristMenuBlocksSceneInput(menu, fixture.inputSource),
      )
      const terminalEvents = terminalWristMenuEvents(events)
      const mountedRecoveryMenuPresent =
        !menu.runtime.disposed && menu.presentation.group.children.length > 0
      const sourceNeutralized =
        !threeWristMenuBlocksSceneInput(menu, fixture.inputSource)
      disposeThreeWristMenu(menu)
      disposed = true
      const menuPresentAfterUnmount = menu.presentation.group.children.length > 0
      const unmountRecoveryDispatches = behind.dispatch(false)
      const observations = {
        dispatchPath: 'three-host-shield',
        dispatches,
        recoveryDispatches: mountedRecoveryDispatches,
        mountedRecoveryDispatches,
        unmountRecoveryDispatches,
        terminalEvents,
        neutralTransitions,
        mountedRecoveryMenuPresent,
        sourceNeutralized,
        menuPresentAfterUnmount,
        iwerFrames: fixture.frameCount,
        rendererFrames,
        wristMenuEvents: events,
      }
      cases.push({
        id,
        observations,
      })
    } finally {
      if (!disposed) disposeThreeWristMenu(menu)
      fixture.restoreGlobals()
    }
  }
  return cases
}

async function runThreeSemanticMatrix({
  sourceKind,
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}, scenarios) {
  const createFixture = (wrist = 'left') =>
    sourceKind === 'controller'
      ? createIwerControllerFixture(iwer, wrist)
      : createIwerHandFixture(iwer, wrist)
  const cases = []

  for (const { id } of scenarios) {
    const wrists = id === 'both-wrists' ? ['left', 'right'] : ['left']
    const observations = []
    let passed = true
    for (const wrist of wrists) {
      const fixture = await createFixture(wrist)
      const events = []
      const longSnapshot = snapshotForWrist({
        ...crossInputSnapshot,
        menuDefinition: Array.from({ length: 18 }, (_, index) => ({
          type: 'action',
          id: `row-${index}`,
          label: `Row ${index}`,
        })),
      }, wrist)
      const automaticDwellCase =
        id === 'fresh-reveal-hide-dwell' ||
        id === 'visibility-session-reentry'
      const initialSnapshot =
        automaticDwellCase
          ? {
              ...snapshotForWrist(crossInputSnapshot, wrist),
              activationMode: 'automatic',
              comfort: { transitionMs: 0 },
            }
          : id === 'scrolling'
            ? longSnapshot
            : snapshotForWrist(crossInputSnapshot, wrist)
      const menu = createThreeWristMenuState({
        renderer: {
          xr: {
            getSession: () => fixture.session,
            getReferenceSpace: () => fixture.referenceSpace,
          },
        },
        snapshot: initialSnapshot,
        onEvent: (event) => events.push(event),
      })
      let rendererFrames = 0
      let time = 0
      const update = (frame, nextTime = time + 16) => {
        time = nextTime
        rendererFrames += 1
        updateThreeWristMenu(menu, { time, frame })
      }
      try {
        let frame = fixture.nextFrame(time)
        if (automaticDwellCase) {
          frame = withViewerPosition(
            frame,
            [0, -1, 0],
            fixture,
            sourceKind,
          )
        }
        update(frame, 0)
        let facingViewer = [0, -1, 0]
        let awayViewer = [0, 0, 1]
        if (automaticDwellCase) {
          const position = menu.presentation.group.getWorldPosition(
            new three.Vector3(),
          )
          const palmNormal = new three.Vector3(0, 0, 1).applyQuaternion(
            menu.presentation.group.getWorldQuaternion(new three.Quaternion()),
          )
          facingViewer = position.clone().add(palmNormal).toArray()
          awayViewer = position.clone().sub(palmNormal).toArray()
        }
        frame = fixture.nextFrame(16)
        if (automaticDwellCase) {
          frame = withViewerPosition(frame, facingViewer, fixture, sourceKind)
        }
        update(frame, 16)
        let casePassed = true
        const detail = {}

        if (id === 'fresh-reveal-hide-dwell') {
          const beforeDwell = menu.presentation.group.visible
          update(
            withViewerPosition(
              fixture.nextFrame(315),
              facingViewer,
              fixture,
              sourceKind,
            ),
            315,
          )
          const belowDwell = menu.presentation.group.visible
          const belowPhase = menu.runtime.revealState.phase
          update(
            withViewerPosition(
              fixture.nextFrame(316),
              facingViewer,
              fixture,
              sourceKind,
            ),
            316,
          )
          const atDwell = menu.presentation.group.visible
          const atPhase = menu.runtime.revealState.phase
          update(
            withViewerPosition(
              fixture.nextFrame(332),
              awayViewer,
              fixture,
              sourceKind,
            ),
            332,
          )
          const hidden = !menu.presentation.group.visible
          casePassed = !beforeDwell && !belowDwell && atDwell && hidden
          Object.assign(detail, {
            beforeDwell,
            belowDwell,
            belowPhase,
            atDwell,
            atPhase,
            visibilityReason: menu.runtime.revealState.visibilityReason,
            anchorPose: menu.runtime.revealState.anchorPose,
            facingViewer,
            hidden,
          })
        }

        if (id === 'both-wrists') {
          casePassed = menu.presentation.group.visible
          detail.wrist = wrist
          detail.visible = menu.presentation.group.visible
        }

        if (id === 'scrolling') {
          let scrollTime = 32
          const releaseSource = () => {
            if (sourceKind === 'controller') fixture.controller.position.x += 2
            else fixture.selectionInput.position.x += 2
            update(fixture.nextFrame(scrollTime), scrollTime)
            scrollTime += 16
          }
          const aimAtPanelY = (positionY) => {
            if (sourceKind === 'controller') {
              setControllerRayAtPanelLocal(
                fixture,
                menu.presentation.group,
                three,
                0,
                positionY,
              )
              update(fixture.nextFrame(scrollTime), scrollTime)
              scrollTime += 16
            } else {
              const poseFrame = fixture.nextFrame(scrollTime)
              scrollTime += 16
              fixture.moveFingertipTo(
                poseFrame,
                menu.presentation.group.localToWorld(
                  new three.Vector3(0, positionY, 0.06),
                ),
              )
              update(fixture.nextFrame(scrollTime), scrollTime)
              scrollTime += 16
            }
            return menu.runtime.scrollState.offset
          }

          releaseSource()
          const firstDownwardDrag = reachScrollGapYMeters.map(aimAtPanelY)
          const ownershipAcquired =
            menu.runtime.scrollState.ownerSourceId !== null
          releaseSource()
          const ownershipReleased =
            menu.runtime.scrollState.ownerSourceId === null
          const secondDownwardDrag = reachScrollGapYMeters.map(aimAtPanelY)
          const rearmed = menu.runtime.scrollState.ownerSourceId !== null
          const downwardSamples = [
            ...firstDownwardDrag,
            ...secondDownwardDrag.slice(1),
          ]
          const offsetSamples = downwardSamples
          const bottomClamp = menu.runtime.scrollState.offset

          releaseSource()
          const upwardGapYs = [...reachScrollGapYMeters].reverse()
          const firstUpwardDrag = upwardGapYs.map(aimAtPanelY)
          releaseSource()
          const secondUpwardDrag = upwardGapYs.map(aimAtPanelY)
          const returnSamples = [
            ...firstUpwardDrag,
            ...secondUpwardDrag.slice(1),
          ]
          const topClamp = menu.runtime.scrollState.offset
          const maxOffset = 18 - 12
          Object.assign(detail, {
            offsetSamples,
            downwardSamples,
            returnSamples,
            topClamp,
            bottomClamp,
            maxOffset,
            ownershipAcquired,
            ownershipReleased,
            rearmed,
          })
          casePassed =
            offsetSamples.slice(1).every(
              (offset, index) => offset > offsetSamples[index],
            ) &&
            Math.abs(bottomClamp - maxOffset) < 1e-9 &&
            Math.abs(topClamp) < 1e-9 &&
            ownershipAcquired && ownershipReleased && rearmed
        }

        if (id === 'invalid-disabled') {
          const intentsBefore = events.filter(
            ({ type }) => type === 'selection-intent',
          ).length
          if (sourceKind === 'controller') {
            fixture.controller.position.set(2, 2, 1)
            update(fixture.press(32), 32)
            update(fixture.release(48), 48)
            fixture.controller.position.set(
              menu.presentation.group.position.x,
              menu.presentation.group.position.y - 0.0225,
              menu.presentation.group.position.z + 1,
            )
            update(fixture.nextFrame(64), 64)
            update(fixture.press(80), 80)
            update(fixture.release(96), 96)
          } else {
            const targetFrame = fixture.nextFrame(32)
            fixture.moveFingertipTo(
              targetFrame,
              menu.presentation.group.localToWorld(
                new three.Vector3(0, -0.0225, 0.008),
              ),
            )
            update(fixture.nextFrame(48), 48)
          }
          detail.selectionIntents = events.filter(
            ({ type }) => type === 'selection-intent',
          ).length - intentsBefore
          casePassed = detail.selectionIntents === 0
        }

        if (id === 'tracking-loss') {
          fixture.menuInput.connected = false
          update(fixture.nextFrame(32), 32)
          detail.targetable = menu.presentation.group.visible
          casePassed = !detail.targetable
        }

        if (id === 'input-switching') {
          const durableModelBefore = presentationModelSignature(
            menu.presentation.group,
          )
          if (sourceKind === 'controller') {
            setControllerRayAtPanelLocal(
              fixture,
              menu.presentation.group,
              three,
              0,
              0.0225,
            )
            update(fixture.nextFrame(32), 32)
            update(fixture.press(48), 48)
          } else {
            const hoverFrame = fixture.nextFrame(32)
            fixture.moveFingertipTo(
              hoverFrame,
              menu.presentation.group.localToWorld(
                new three.Vector3(0, 0.0225, 0.03),
              ),
            )
            update(fixture.nextFrame(48), 48)
          }
          const activeTransientBefore = {
            kind: sourceKind === 'controller'
              ? 'selection-ownership'
              : 'scene-input-claim',
            claimed: threeWristMenuBlocksSceneInput(
              menu,
              fixture.inputSource,
            ),
          }
          fixture.device.primaryInputMode =
            sourceKind === 'controller' ? 'hand' : 'controller'
          update(fixture.nextFrame(64), 64)
          if (sourceKind === 'controller') update(fixture.release(80), 80)
          else {
            fixture.selectionInput.position.x += 2
            update(fixture.nextFrame(80), 80)
          }
          const terminalEvents = terminalWristMenuEvents(events)
          const durableModelAfter = presentationModelSignature(
            menu.presentation.group,
          )
          const sourceSwitched =
            fixture.device.primaryInputMode ===
              (sourceKind === 'controller' ? 'hand' : 'controller') &&
            !fixture.session.inputSources.includes(fixture.inputSource)
          const transientCleared =
            !threeWristMenuBlocksSceneInput(menu, fixture.inputSource) &&
            menu.runtime.selectionState.claims.size === 0 &&
            menu.runtime.selectionState.ownership === undefined &&
            menu.runtime.scrollState.ownerSourceId === null
          Object.assign(detail, {
            activeTransientBefore,
            sourceSwitched,
            transientCleared,
            terminalEvents,
            durableModelBefore,
            durableModelAfter,
          })
          casePassed =
            activeTransientBefore.claimed &&
            sourceSwitched &&
            transientCleared &&
            terminalEvents.length === 1 &&
            terminalEvents[0].type === 'selection-cancellation' &&
            durableModelBefore.length > 0 &&
            durableModelAfter.join('\n') === durableModelBefore.join('\n')
        }

        if (id === 'visibility-session-reentry') {
          update(
            withViewerPosition(
              fixture.nextFrame(315),
              facingViewer,
              fixture,
              sourceKind,
            ),
            315,
          )
          update(
            withViewerPosition(
              fixture.nextFrame(316),
              facingViewer,
              fixture,
              sourceKind,
            ),
            316,
          )
          const durableModelBefore = presentationModelSignature(
            menu.presentation.group,
          )
          fixture.device.updateVisibilityState('hidden')
          update(
            withViewerPosition(
              fixture.nextFrame(332),
              facingViewer,
              fixture,
              sourceKind,
            ),
            332,
          )
          const visibilityHidden = !menu.presentation.group.visible
          fixture.device.updateVisibilityState('visible')
          update(
            withViewerPosition(
              fixture.nextFrame(348),
              facingViewer,
              fixture,
              sourceKind,
            ),
            348,
          )
          update(
            withViewerPosition(
              fixture.nextFrame(548),
              facingViewer,
              fixture,
              sourceKind,
            ),
            548,
          )
          const visibilityRestored = menu.presentation.group.visible

          const previousSession = fixture.session
          await fixture.endSession()
          const sessionEnded =
            fixture.session === previousSession &&
            previousSession[iwer.P_SESSION].ended === true
          const sessionCleanup =
            !menu.presentation.group.visible &&
            menu.runtime.selectionState.claims.size === 0 &&
            menu.runtime.selectionState.ownership === undefined &&
            menu.runtime.scrollState.ownerSourceId === null
          const nextSession = await fixture.reenterSession()
          const newSessionIdentity = nextSession !== previousSession

          update(
            withViewerPosition(
              fixture.nextFrame(564),
              facingViewer,
              fixture,
              sourceKind,
            ),
            564,
          )
          const before = menu.presentation.group.visible
          update(
            withViewerPosition(
              fixture.nextFrame(763),
              facingViewer,
              fixture,
              sourceKind,
            ),
            763,
          )
          const below = menu.presentation.group.visible
          update(
            withViewerPosition(
              fixture.nextFrame(764),
              facingViewer,
              fixture,
              sourceKind,
            ),
            764,
          )
          const at = menu.presentation.group.visible
          const durableModelAfter = presentationModelSignature(
            menu.presentation.group,
          )
          const intentsBefore = events.filter(
            ({ type }) => type === 'selection-intent',
          ).length
          if (sourceKind === 'controller') {
            setControllerRayAtPanelLocal(
              fixture,
              menu.presentation.group,
              three,
              0,
              0.0225,
            )
            update(
              withViewerPosition(
                fixture.nextFrame(780),
                facingViewer,
                fixture,
                sourceKind,
              ),
              780,
            )
            update(
              withViewerPosition(
                fixture.press(796),
                facingViewer,
                fixture,
                sourceKind,
              ),
              796,
            )
            update(
              withViewerPosition(
                fixture.release(812),
                facingViewer,
                fixture,
                sourceKind,
              ),
              812,
            )
          } else {
            const hoverFrame = withViewerPosition(
              fixture.nextFrame(780),
              facingViewer,
              fixture,
              sourceKind,
            )
            fixture.moveFingertipTo(
              hoverFrame,
              menu.presentation.group.localToWorld(
                new three.Vector3(0, 0.0225, 0.03),
              ),
            )
            update(
              withViewerPosition(
                fixture.nextFrame(796),
                facingViewer,
                fixture,
                sourceKind,
              ),
              796,
            )
            const pressFrame = withViewerPosition(
              fixture.nextFrame(812),
              facingViewer,
              fixture,
              sourceKind,
            )
            fixture.moveFingertipTo(
              pressFrame,
              menu.presentation.group.localToWorld(
                new three.Vector3(0, 0.0225, 0.008),
              ),
            )
            update(
              withViewerPosition(
                fixture.nextFrame(828),
                facingViewer,
                fixture,
                sourceKind,
              ),
              828,
            )
          }
          const postReentrySelectionIntents = events.filter(
            ({ type }) => type === 'selection-intent',
          ).length - intentsBefore
          Object.assign(detail, {
            visibilityHidden,
            visibilityRestored,
            sessionEnded,
            newSessionIdentity,
            sessionCleanup,
            durableModelBefore,
            durableModelAfter,
            freshDwell: { before, below, at },
            postReentrySelectionIntents,
          })
          casePassed =
            visibilityHidden && visibilityRestored && sessionEnded &&
            newSessionIdentity && sessionCleanup && !before && !below && at &&
            postReentrySelectionIntents === 1 &&
            durableModelBefore.length > 0 &&
            durableModelAfter.join('\n') === durableModelBefore.join('\n')
        }

        if (id === 'empty-unavailable') {
          syncThreeWristMenu(menu, {
            ...snapshotForWrist(crossInputSnapshot, wrist),
            menuDefinition: [],
          })
          update(fixture.nextFrame(32), 32)
          const emptyHidden = !menu.presentation.group.visible
          syncThreeWristMenu(menu, snapshotForWrist(crossInputSnapshot, wrist))
          fixture.menuInput.connected = false
          update(fixture.nextFrame(48), 48)
          const unavailableHidden = !menu.presentation.group.visible
          Object.assign(detail, { emptyHidden, unavailableHidden })
          casePassed = emptyHidden && unavailableHidden
        }

        passed &&= casePassed
        observations.push({
          ...detail,
          wrist,
          iwerFrames: fixture.frameCount,
          rendererFrames,
          wristMenuEvents: events,
        })
      } finally {
        disposeThreeWristMenu(menu)
        fixture.restoreGlobals()
      }
    }
    cases.push({
      id,
      status: passed ? 'passed' : 'failed',
      observations: {
        iwerFrames: observations.reduce(
          (total, observation) => total + observation.iwerFrames,
          0,
        ),
        rendererFrames: observations.reduce(
          (total, observation) => total + observation.rendererFrames,
          0,
        ),
        runs: observations,
      },
    })
  }
  return cases
}

export async function runPackedThreeControllerJourney({
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}) {
  const fixture = await createIwerControllerFixture(iwer)
  const wristMenuEvents = []
  let sceneActions = 0
  const renderer = {
    xr: {
      getSession: () => fixture.session,
      getReferenceSpace: () => fixture.referenceSpace,
    },
  }
  const menu = createThreeWristMenuState({
    renderer,
    snapshot: controllerActionSnapshot,
    onEvent: (event) => wristMenuEvents.push(event),
  })
  const scene = new three.Scene()
  scene.add(menu.presentation.group)
  const ray = new three.Raycaster(
    new three.Vector3(0, 0, 1),
    new three.Vector3(0, 0, -1),
  )

  try {
    updateThreeWristMenu(menu, { time: 16, frame: fixture.nextFrame(16) })
    assert.equal(ray.intersectObject(menu.presentation.group, true).length, 0)
    fixture.controller.position.set(
      menu.presentation.group.position.x,
      menu.presentation.group.position.y,
      menu.presentation.group.position.z + 1,
    )
    ray.set(
      new three.Vector3(
        menu.presentation.group.position.x,
        menu.presentation.group.position.y,
        menu.presentation.group.position.z + 1,
      ),
      new three.Vector3(0, 0, -1),
    )
    updateThreeWristMenu(menu, { time: 32, frame: fixture.nextFrame(32) })
    assert.ok(ray.intersectObject(menu.presentation.group, true).length > 0)

    fixture.session.addEventListener('selectend', ({ inputSource }) => {
      if (!threeWristMenuBlocksSceneInput(menu, inputSource)) sceneActions += 1
    })

    updateThreeWristMenu(menu, { time: 48, frame: fixture.press(48) })
    assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.inputSource), true)
    updateThreeWristMenu(menu, { time: 64, frame: fixture.release(64) })

    assert.equal(sceneActions, 0)
    assert.equal(
      wristMenuEvents.filter(({ type }) => type === 'selection-intent').length,
      1,
    )
    const evidence = await runRendererJourneyEvidence({
      rendererIntegration: 'three',
      sourceKind: 'controller',
      runSemanticCases: (scenarios) => runThreeSemanticMatrix({
        sourceKind: 'controller',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        syncThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, scenarios),
      runSceneEventShieldCases: (scenarios) => runThreeShieldMatrix({
        sourceKind: 'controller',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, scenarios),
    })
    const selectionIntents = wristMenuEvents.filter(
      ({ type }) => type === 'selection-intent',
    ).length
    return {
      id: 'iwer-vanilla-controller',
      status:
        selectionIntents === 1 &&
        sceneActions === 0 &&
        evidence.status === 'passed'
          ? 'passed'
          : 'failed',
      selectionIntents,
      blockedSceneActions: sceneActions,
      coverage: evidence.coverage,
      sceneEventShield: evidence.sceneEventShield,
    }
  } finally {
    disposeThreeWristMenu(menu)
    fixture.restoreGlobals()
  }
}

export async function runPackedThreeHandJourney({
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}) {
  const fixture = await createIwerHandFixture(iwer)
  const wristMenuEvents = []
  let sceneActions = 0
  const menu = createThreeWristMenuState({
    renderer: {
      xr: {
        getSession: () => fixture.session,
        getReferenceSpace: () => fixture.referenceSpace,
      },
    },
    snapshot: crossInputSnapshot,
    onEvent: (event) => wristMenuEvents.push(event),
  })
  const scene = new three.Scene()
  scene.add(menu.presentation.group)

  try {
    const initialFrame = fixture.nextFrame(16)
    updateThreeWristMenu(menu, { time: 16, frame: initialFrame })

    const hoverTarget = menu.presentation.group.localToWorld(
      new three.Vector3(0, 0.0225, 0.03),
    )
    fixture.moveFingertipTo(initialFrame, hoverTarget)
    const hoverFrame = fixture.nextFrame(32)
    updateThreeWristMenu(menu, { time: 32, frame: hoverFrame })
    assert.equal(threeWristMenuBlocksSceneInput(menu, fixture.inputSource), true)

    const pressTarget = menu.presentation.group.localToWorld(
      new three.Vector3(0, 0.0225, 0.008),
    )
    fixture.moveFingertipTo(hoverFrame, pressTarget)
    updateThreeWristMenu(menu, { time: 48, frame: fixture.nextFrame(48) })
    if (!threeWristMenuBlocksSceneInput(menu, fixture.inputSource)) sceneActions += 1

    assert.equal(sceneActions, 0)
    assert.deepEqual(
      wristMenuEvents
        .filter(({ type }) => type === 'selection-intent')
        .map(({ intent, source }) => [intent.itemId, source.kind]),
      [['first', 'hand']],
    )
    const evidence = await runRendererJourneyEvidence({
      rendererIntegration: 'three',
      sourceKind: 'hand',
      runSemanticCases: (scenarios) => runThreeSemanticMatrix({
        sourceKind: 'hand',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        syncThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, scenarios),
      runSceneEventShieldCases: (scenarios) => runThreeShieldMatrix({
        sourceKind: 'hand',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, scenarios),
    })
    const selectionIntents = wristMenuEvents.filter(
      ({ type }) => type === 'selection-intent',
    ).length
    return {
      id: 'iwer-vanilla-hand',
      status:
        selectionIntents === 1 &&
        sceneActions === 0 &&
        evidence.status === 'passed'
          ? 'passed'
          : 'failed',
      selectionIntents,
      blockedSceneActions: sceneActions,
      coverage: evidence.coverage,
      sceneEventShield: evidence.sceneEventShield,
    }
  } finally {
    disposeThreeWristMenu(menu)
    fixture.restoreGlobals()
  }
}

async function createReactRendererHarness({
  React,
  WristMenu,
  fiber,
  iwer,
  three,
  xr,
  sourceKind,
  wrist,
  snapshot,
}) {
  const base = await createReactIwerRendererHarness({
    React,
    fiber,
    iwer,
    three,
    xr,
    sourceKind,
    wrist,
  })
  const { canvas, fixture, state } = base

  const behindGeometry = new three.BoxGeometry(0.5, 0.5, 0.02)
  const behindMaterial = new three.MeshBasicMaterial()
  const behind = new three.Mesh(behindGeometry, behindMaterial)
  behind.position.z = -0.1
  const deliveries = new Map(sceneActionTypes.map((type) => [type, 0]))
  const reactHandlerByType = {
    pointerdown: 'onPointerDown',
    pointerup: 'onPointerUp',
    click: 'onClick',
    dblclick: 'onDoubleClick',
    contextmenu: 'onContextMenu',
  }
  const wristMenuEvents = []
  let currentSnapshot = snapshot
  let includeMenu = true

  const tree = () => {
    const children = []
    if (includeMenu) {
      children.push(React.createElement(WristMenu, {
        key: 'wrist-menu',
        snapshot: currentSnapshot,
        onEvent: (event) => wristMenuEvents.push(event),
      }))
    } else {
      children.push(React.createElement(React.Fragment, { key: 'wrist-menu' }))
    }
    const behindProps = { key: 'behind-target', object: behind }
    for (const type of sceneActionTypes) {
      behindProps[reactHandlerByType[type]] = () => {
        deliveries.set(type, deliveries.get(type) + 1)
      }
    }
    children.push(React.createElement('primitive', behindProps))
    return React.createElement(React.Fragment, null, ...children)
  }

  const render = async (nextSnapshot = currentSnapshot, nextIncludeMenu = includeMenu) => {
    currentSnapshot = nextSnapshot
    includeMenu = nextIncludeMenu
    await base.render(tree())
  }

  await render()
  const menuGroup = () => state.scene.children.find(
    ({ name }) => name === 'wrist-menu-attachment-root',
  )
  const placeBehindAtMenuLocalX = (localX) => {
    const group = menuGroup()
    assert.ok(group)
    behind.position.copy(
      group.localToWorld(new three.Vector3(localX, 0, -0.1)),
    )
    behind.quaternion.copy(group.getWorldQuaternion(new three.Quaternion()))
    behind.updateMatrixWorld(true)
    state.camera.position.copy(
      group.localToWorld(new three.Vector3(localX, 0, 1)),
    )
    state.camera.lookAt(behind.position)
    state.camera.updateProjectionMatrix()
    state.camera.updateMatrixWorld(true)
  }
  const placeBehindMenu = () => placeBehindAtMenuLocalX(0)
  const placeBehindOutsideMenu = () => placeBehindAtMenuLocalX(0.3)
  const dispatchSceneActions = () => sceneActionTypes.map((type) => {
    const before = deliveries.get(type)
    const listenerAttached = canvas.dispatch(type)
    const probe = new three.Raycaster()
    probe.setFromCamera(new three.Vector2(0, 0), state.camera)
    return {
      type,
      behindTargetDeliveries: deliveries.get(type) - before,
      listenerAttached,
      behindIntersections: probe.intersectObject(behind, false).length,
      behindAttached: behind.parent !== null,
      behindEventCount: behind.__r3f?.eventCount ?? null,
      interactionRegistered: state.internal.interaction.includes(behind),
    }
  })
  const dispose = async () => {
    try {
      await base.dispose()
    } finally {
      behindGeometry.dispose()
      behindMaterial.dispose()
    }
  }
  return {
    aimSelectionAtMenuLocal: base.aimSelectionAtMenuLocal,
    fixture,
    state,
    menuGroup,
    wristMenuEvents,
    advance: base.advance,
    nextFrame: base.nextFrame,
    placeSelectionAway: base.placeSelectionAway,
    releaseSelectionSource: base.releaseSelectionSource,
    render,
    placeBehindMenu,
    placeBehindOutsideMenu,
    dispatchSceneActions,
    endAndReenterSession: base.endAndReenterSession,
    dispose,
  }
}

async function runReactSemanticMatrix(dependencies, sourceKind, scenarios) {
  const { three } = dependencies
  const cases = []
  for (const { id } of scenarios) {
    const wrists = id === 'both-wrists' ? ['left', 'right'] : ['left']
    const runs = []
    for (const wrist of wrists) {
      const baseSnapshot = snapshotForWrist(crossInputSnapshot, wrist)
      const automaticDwellCase =
        id === 'fresh-reveal-hide-dwell' ||
        id === 'visibility-session-reentry'
      const initialSnapshot = automaticDwellCase
        ? { ...baseSnapshot, activationMode: 'automatic', comfort: { transitionMs: 0 } }
        : id === 'scrolling'
          ? {
              ...baseSnapshot,
              menuDefinition: Array.from({ length: 18 }, (_, index) => ({
                type: 'action', id: `row-${index}`, label: `Row ${index}`,
              })),
            }
          : baseSnapshot
      const harness = await createReactRendererHarness({
        ...dependencies, sourceKind, wrist, snapshot: initialSnapshot,
      })
      let rendererFrames = 0
      const step = async (time, frame) => {
        rendererFrames += 1
        await harness.advance(time, frame)
      }
      let passed = true
      const detail = {}
      try {
        let frame = harness.fixture.nextFrame(0)
        if (automaticDwellCase) {
          frame = withViewerPosition(frame, [0, -1, 0], harness.fixture, sourceKind)
        }
        await step(0, frame)
        const group = harness.menuGroup()
        assert.ok(group)
        let facingViewer = [0, -1, 0]
        let awayViewer = [0, 0, 1]
        if (automaticDwellCase) {
          const position = group.getWorldPosition(new three.Vector3())
          const normal = new three.Vector3(0, 0, 1).applyQuaternion(
            group.getWorldQuaternion(new three.Quaternion()),
          )
          facingViewer = position.clone().add(normal).toArray()
          awayViewer = position.clone().sub(normal).toArray()
        }
        frame = harness.fixture.nextFrame(16)
        if (automaticDwellCase) {
          frame = withViewerPosition(frame, facingViewer, harness.fixture, sourceKind)
        }
        await step(16, frame)

        if (id === 'fresh-reveal-hide-dwell') {
          const beforeDwell = group.visible
          await step(315, withViewerPosition(
            harness.fixture.nextFrame(315), facingViewer, harness.fixture, sourceKind,
          ))
          const belowDwell = group.visible
          await step(316, withViewerPosition(
            harness.fixture.nextFrame(316), facingViewer, harness.fixture, sourceKind,
          ))
          const atDwell = group.visible
          await step(332, withViewerPosition(
            harness.fixture.nextFrame(332), awayViewer, harness.fixture, sourceKind,
          ))
          const hidden = !group.visible
          passed = !beforeDwell && !belowDwell && atDwell && hidden
          Object.assign(detail, { beforeDwell, belowDwell, atDwell, hidden })
        } else if (id === 'both-wrists') {
          passed = group.visible
          Object.assign(detail, { wrist, visible: group.visible })
        } else if (id === 'scrolling') {
          let scrollTime = 32
          const releaseSource = async () => {
            harness.releaseSelectionSource()
            await step(scrollTime, harness.nextFrame(scrollTime))
            scrollTime += 16
            return observedPresentationScrollOffset(group)
          }
          const aimAtPanelY = async (positionY) => {
            if (sourceKind === 'controller') {
              harness.aimSelectionAtMenuLocal(group, { y: positionY })
              await step(scrollTime, harness.nextFrame(scrollTime))
              scrollTime += 16
            } else {
              const poseFrame = harness.nextFrame(scrollTime)
              scrollTime += 16
              harness.aimSelectionAtMenuLocal(group, {
                y: positionY,
                frame: poseFrame,
              })
              await step(scrollTime, harness.nextFrame(scrollTime))
              scrollTime += 16
            }
            return observedPresentationScrollOffset(group)
          }

          await releaseSource()
          const firstDownwardDrag = []
          for (const positionY of reachScrollGapYMeters) {
            firstDownwardDrag.push(await aimAtPanelY(positionY))
          }
          const ownershipAcquired =
            firstDownwardDrag.at(-1) > firstDownwardDrag[0]
          const releasedOffset = await releaseSource()
          const ownershipReleased = releasedOffset === firstDownwardDrag.at(-1)
          const secondDownwardDrag = []
          for (const positionY of reachScrollGapYMeters) {
            secondDownwardDrag.push(await aimAtPanelY(positionY))
          }
          const rearmed =
            secondDownwardDrag.at(-1) > secondDownwardDrag[0]
          const downwardSamples = [
            ...firstDownwardDrag,
            ...secondDownwardDrag.slice(1),
          ]
          const offsetSamples = downwardSamples
          const bottomClamp = observedPresentationScrollOffset(group)

          await releaseSource()
          const upwardGapYs = [...reachScrollGapYMeters].reverse()
          const firstUpwardDrag = []
          for (const positionY of upwardGapYs) {
            firstUpwardDrag.push(await aimAtPanelY(positionY))
          }
          await releaseSource()
          const secondUpwardDrag = []
          for (const positionY of upwardGapYs) {
            secondUpwardDrag.push(await aimAtPanelY(positionY))
          }
          const returnSamples = [
            ...firstUpwardDrag,
            ...secondUpwardDrag.slice(1),
          ]
          const topClamp = observedPresentationScrollOffset(group)
          const maxOffset = 18 - 12
          Object.assign(detail, {
            offsetSamples,
            downwardSamples,
            returnSamples,
            topClamp,
            bottomClamp,
            maxOffset,
            ownershipAcquired,
            ownershipReleased,
            rearmed,
          })
          passed =
            offsetSamples.every(Number.isFinite) &&
            offsetSamples.slice(1).every(
              (offset, index) => offset > offsetSamples[index],
            ) &&
            Math.abs(bottomClamp - maxOffset) < 1e-9 &&
            Math.abs(topClamp) < 1e-9 &&
            ownershipAcquired && ownershipReleased && rearmed
        } else if (id === 'invalid-disabled') {
          const before = harness.wristMenuEvents.filter(({ type }) => type === 'selection-intent').length
          if (sourceKind === 'controller') {
            harness.placeSelectionAway()
            await step(32, harness.fixture.press(32))
            await step(48, harness.fixture.release(48))
            harness.aimSelectionAtMenuLocal(group, { y: -0.0225 })
            await step(64, harness.fixture.nextFrame(64))
            await step(80, harness.fixture.press(80))
            await step(96, harness.fixture.release(96))
          } else {
            const target = harness.fixture.nextFrame(32)
            harness.aimSelectionAtMenuLocal(group, {
              y: -0.0225,
              handZ: 0.008,
              frame: target,
            })
            await step(48, harness.fixture.nextFrame(48))
          }
          const selectionIntents = harness.wristMenuEvents.filter(
            ({ type }) => type === 'selection-intent',
          ).length - before
          passed = selectionIntents === 0
          detail.selectionIntents = selectionIntents
        } else if (id === 'tracking-loss') {
          harness.fixture.menuInput.connected = false
          await step(32, harness.fixture.nextFrame(32))
          passed = !group.visible
          detail.hidden = !group.visible
        } else if (id === 'input-switching') {
          const durableModelBefore = presentationModelSignature(group)
          if (sourceKind === 'controller') {
            harness.aimSelectionAtMenuLocal(group, { y: 0.0225 })
            await step(32, harness.fixture.nextFrame(32))
            await step(48, harness.fixture.press(48))
          } else {
            const hoverFrame = harness.fixture.nextFrame(32)
            harness.aimSelectionAtMenuLocal(group, {
              y: 0.0225,
              handZ: 0.03,
              frame: hoverFrame,
            })
            await step(48, harness.fixture.nextFrame(48))
          }
          harness.placeBehindMenu()
          const activeClaimDispatches = harness.dispatchSceneActions()
          harness.fixture.device.primaryInputMode = sourceKind === 'controller' ? 'hand' : 'controller'
          await step(64, harness.fixture.nextFrame(64))
          if (sourceKind === 'controller') {
            await step(80, harness.fixture.release(80))
          } else {
            harness.releaseSelectionSource()
            await step(80, harness.fixture.nextFrame(80))
          }
          const terminalEvents = terminalWristMenuEvents(
            harness.wristMenuEvents,
          )
          const sourceSwitched =
            harness.fixture.device.primaryInputMode ===
              (sourceKind === 'controller' ? 'hand' : 'controller') &&
            !harness.fixture.session.inputSources.includes(
              harness.fixture.inputSource,
            )
          const activeTransientBefore = {
            kind: sourceKind === 'controller'
              ? 'selection-ownership'
              : 'scene-input-claim',
            claimed: activeClaimDispatches.every(
              ({ behindTargetDeliveries }) => behindTargetDeliveries === 0,
            ),
          }
          const transientCleared =
            sourceSwitched &&
            terminalEvents.length === 1 &&
            terminalEvents[0].type === 'selection-cancellation' &&
            harness.wristMenuEvents.filter(
              ({ type }) => type === 'selection-intent',
            ).length === 0
          const durableModelAfter = presentationModelSignature(group)
          Object.assign(detail, {
            activeTransientBefore,
            activeClaimDispatches,
            sourceSwitched,
            transientCleared,
            terminalEvents,
            durableModelBefore,
            durableModelAfter,
          })
          passed =
            activeTransientBefore.claimed && sourceSwitched &&
            transientCleared && durableModelBefore.length > 0 &&
            durableModelAfter.join('\n') === durableModelBefore.join('\n')
        } else if (id === 'visibility-session-reentry') {
          await step(315, withViewerPosition(
            harness.fixture.nextFrame(315), facingViewer, harness.fixture, sourceKind,
          ))
          await step(316, withViewerPosition(
            harness.fixture.nextFrame(316), facingViewer, harness.fixture, sourceKind,
          ))
          const durableModelBefore = presentationModelSignature(group)
          harness.fixture.device.updateVisibilityState('hidden')
          await step(332, withViewerPosition(
            harness.fixture.nextFrame(332), facingViewer, harness.fixture, sourceKind,
          ))
          const visibilityHidden = !group.visible
          harness.fixture.device.updateVisibilityState('visible')
          await step(348, withViewerPosition(
            harness.fixture.nextFrame(348), facingViewer, harness.fixture, sourceKind,
          ))
          await step(548, withViewerPosition(
            harness.fixture.nextFrame(548), facingViewer, harness.fixture, sourceKind,
          ))
          const visibilityRestored = group.visible

          const sessionTransition = await harness.endAndReenterSession()
          const sessionEnded =
            sessionTransition.iwerSessionEnded &&
            sessionTransition.endedStoreSession &&
            !group.visible
          const sessionCleanup =
            sessionTransition.endedStoreSession && !group.visible
          const newSessionIdentity =
            sessionTransition.nextSession !== sessionTransition.previousSession &&
            sessionTransition.reenteredStoreSession

          await step(564, withViewerPosition(
            harness.fixture.nextFrame(564), facingViewer, harness.fixture, sourceKind,
          ))
          const before = group.visible
          await step(763, withViewerPosition(
            harness.fixture.nextFrame(763), facingViewer, harness.fixture, sourceKind,
          ))
          const below = group.visible
          await step(764, withViewerPosition(
            harness.fixture.nextFrame(764), facingViewer, harness.fixture, sourceKind,
          ))
          const at = group.visible
          const durableModelAfter = presentationModelSignature(group)
          const intentsBefore = harness.wristMenuEvents.filter(
            ({ type }) => type === 'selection-intent',
          ).length
          if (sourceKind === 'controller') {
            harness.aimSelectionAtMenuLocal(group, { y: 0.0225 })
            await step(780, withViewerPosition(
              harness.fixture.nextFrame(780), facingViewer, harness.fixture, sourceKind,
            ))
            await step(796, withViewerPosition(
              harness.fixture.press(796), facingViewer, harness.fixture, sourceKind,
            ))
            await step(812, withViewerPosition(
              harness.fixture.release(812), facingViewer, harness.fixture, sourceKind,
            ))
          } else {
            const hoverFrame = withViewerPosition(
              harness.fixture.nextFrame(780), facingViewer, harness.fixture, sourceKind,
            )
            harness.aimSelectionAtMenuLocal(group, {
              y: 0.0225,
              handZ: 0.03,
              frame: hoverFrame,
            })
            await step(796, withViewerPosition(
              harness.fixture.nextFrame(796), facingViewer, harness.fixture, sourceKind,
            ))
            const pressFrame = withViewerPosition(
              harness.fixture.nextFrame(812), facingViewer, harness.fixture, sourceKind,
            )
            harness.aimSelectionAtMenuLocal(group, {
              y: 0.0225,
              handZ: 0.008,
              frame: pressFrame,
            })
            await step(828, withViewerPosition(
              harness.fixture.nextFrame(828), facingViewer, harness.fixture, sourceKind,
            ))
          }
          const postReentrySelectionIntents = harness.wristMenuEvents.filter(
            ({ type }) => type === 'selection-intent',
          ).length - intentsBefore
          Object.assign(detail, {
            visibilityHidden,
            visibilityRestored,
            sessionEnded,
            newSessionIdentity,
            sessionCleanup,
            durableModelBefore,
            durableModelAfter,
            freshDwell: { before, below, at },
            postReentrySelectionIntents,
          })
          passed =
            visibilityHidden && visibilityRestored && sessionEnded &&
            newSessionIdentity && sessionCleanup && !before && !below && at &&
            postReentrySelectionIntents === 1 &&
            durableModelBefore.length > 0 &&
            durableModelAfter.join('\n') === durableModelBefore.join('\n')
        } else if (id === 'empty-unavailable') {
          await harness.render({ ...baseSnapshot, menuDefinition: [] })
          await step(32, harness.fixture.nextFrame(32))
          const emptyHidden = !group.visible
          await harness.render(baseSnapshot)
          harness.fixture.menuInput.connected = false
          await step(48, harness.fixture.nextFrame(48))
          const unavailableHidden = !group.visible
          passed = emptyHidden && unavailableHidden
          Object.assign(detail, { emptyHidden, unavailableHidden })
        }
        runs.push({
          ...detail,
          wrist,
          iwerFrames: harness.fixture.frameCount,
          rendererFrames,
          wristMenuEvents: harness.wristMenuEvents,
        })
      } finally {
        await harness.dispose()
      }
      if (!passed) runs.at(-1).failed = true
    }
    cases.push({
      id,
      status: runs.every((run) => run.failed !== true) ? 'passed' : 'failed',
      observations: {
        iwerFrames: runs.reduce((total, run) => total + run.iwerFrames, 0),
        rendererFrames: runs.reduce((total, run) => total + run.rendererFrames, 0),
        runs,
      },
    })
  }
  return cases
}

async function runReactShieldMatrix(dependencies, sourceKind, scenarios) {
  const { three } = dependencies
  const cases = []
  for (const { id } of scenarios) {
    const harness = await createReactRendererHarness({
      ...dependencies,
      sourceKind,
      wrist: 'left',
      snapshot: crossInputSnapshot,
    })
    let rendererFrames = 0
    const step = async (time, frame) => {
      rendererFrames += 1
      await harness.advance(time, frame)
    }
    try {
      const initial = harness.fixture.nextFrame(0)
      await step(0, initial)
      await step(16, harness.fixture.nextFrame(16))
      const group = harness.menuGroup()
      assert.ok(group)
      if (sourceKind === 'controller') {
        harness.aimSelectionAtMenuLocal(group, { y: 0.0225 })
        await step(32, harness.fixture.nextFrame(32))
        await step(48, harness.fixture.press(48))
      } else {
        harness.aimSelectionAtMenuLocal(group, {
          y: 0.0225,
          handZ: 0.03,
          frame: initial,
        })
        await step(32, harness.fixture.nextFrame(32))
        if (id === 'hold') {
          const pressed = harness.fixture.nextFrame(48)
          harness.aimSelectionAtMenuLocal(group, {
            y: 0.0225,
            handZ: 0.008,
            frame: pressed,
          })
          await step(48, harness.fixture.nextFrame(48))
        }
      }
      if (id === 'hold') {
        await step(64, harness.fixture.nextFrame(64))
        await step(80, harness.fixture.nextFrame(80))
      }
      harness.placeBehindMenu()
      await step(96, harness.fixture.nextFrame(96))
      const dispatches = harness.dispatchSceneActions()

      let recoveryTime = 160
      let neutralTransitions = 0
      if (id === 'cancel') {
        harness.fixture.menuInput.connected = false
        await step(112, harness.fixture.nextFrame(112))
        neutralTransitions += 1
      } else if (sourceKind === 'controller') {
        if (id === 'commit' || id === 'hold') {
          await step(112, harness.fixture.release(112))
          neutralTransitions += 1
        } else if (id === 'rapid-actions') {
          await step(112, harness.fixture.release(112))
          neutralTransitions += 1
          await step(128, harness.fixture.nextFrame(128))
          await step(144, harness.fixture.press(144))
          await step(160, harness.fixture.release(160))
          neutralTransitions += 1
          recoveryTime = 192
        } else {
          harness.releaseSelectionSource()
          await step(112, harness.fixture.release(112))
          neutralTransitions += 1
        }
        harness.releaseSelectionSource()
        await step(recoveryTime - 16, harness.fixture.nextFrame(recoveryTime - 16))
      } else {
        if (id === 'commit' || id === 'rapid-actions') {
          const pressed = harness.fixture.nextFrame(112)
          harness.aimSelectionAtMenuLocal(group, {
            y: 0.0225,
            handZ: 0.008,
            frame: pressed,
          })
          await step(112, harness.fixture.nextFrame(112))
        }
        if (id === 'rapid-actions') {
          harness.releaseSelectionSource()
          await step(128, harness.fixture.nextFrame(128))
          neutralTransitions += 1
          const hover = harness.fixture.nextFrame(144)
          harness.aimSelectionAtMenuLocal(group, {
            y: 0.0225,
            handZ: 0.03,
            frame: hover,
          })
          await step(144, harness.fixture.nextFrame(144))
          const pressed = harness.fixture.nextFrame(160)
          harness.aimSelectionAtMenuLocal(group, {
            y: 0.0225,
            handZ: 0.008,
            frame: pressed,
          })
          await step(160, harness.fixture.nextFrame(160))
          recoveryTime = 208
        }
        harness.releaseSelectionSource()
        await step(recoveryTime - 16, harness.fixture.nextFrame(recoveryTime - 16))
        neutralTransitions += 1
      }
      const terminalEvents = terminalWristMenuEvents(
        harness.wristMenuEvents,
      )
      harness.placeBehindOutsideMenu()
      const mountedRecoveryMenuPresent = harness.menuGroup() === group
      const mountedRecoveryDispatches = harness.dispatchSceneActions()
      const sourceNeutralized =
        neutralTransitions > 0 &&
        mountedRecoveryDispatches.every(
          ({ behindTargetDeliveries }) => behindTargetDeliveries > 0,
        )
      harness.placeBehindMenu()
      await harness.render(crossInputSnapshot, false)
      await step(recoveryTime, harness.fixture.nextFrame(recoveryTime))
      const menuPresentAfterUnmount = harness.menuGroup() !== undefined
      const unmountRecoveryDispatches = harness.dispatchSceneActions()
      const observations = {
        dispatchPath: 'react-event-manager',
        dispatches,
        recoveryDispatches: mountedRecoveryDispatches,
        mountedRecoveryDispatches,
        unmountRecoveryDispatches,
        terminalEvents,
        neutralTransitions,
        mountedRecoveryMenuPresent,
        sourceNeutralized,
        menuPresentAfterUnmount,
        iwerFrames: harness.fixture.frameCount,
        rendererFrames,
        wristMenuEvents: harness.wristMenuEvents,
      }
      cases.push({
        id,
        observations,
      })
    } finally {
      await harness.dispose()
    }
  }
  return cases
}

async function runPackedReactJourney(dependencies, sourceKind) {
  return runRendererJourneyEvidence({
    rendererIntegration: 'react',
    sourceKind,
    runSemanticCases: (scenarios) =>
      runReactSemanticMatrix(dependencies, sourceKind, scenarios),
    runSceneEventShieldCases: (scenarios) =>
      runReactShieldMatrix(dependencies, sourceKind, scenarios),
  })
}

export async function runPackedReactControllerJourney(dependencies) {
  return runPackedReactJourney(dependencies, 'controller')
}

export async function runPackedReactHandJourney(dependencies) {
  return runPackedReactJourney(dependencies, 'hand')
}
