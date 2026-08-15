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

async function createThreeSceneEventShieldRun({
  sourceKind,
  createThreeWristMenuState,
  disposeThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}) {
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
  let unmounted = false
  let disposed = false

  return {
    dispatchPath: 'three-host-shield',
    sourceKind,
    async step(time, { input = 'next' } = {}) {
      const frame = input === 'press'
        ? fixture.press(time)
        : input === 'release'
          ? fixture.release(time)
          : fixture.nextFrame(time)
      rendererFrames += 1
      updateThreeWristMenu(menu, { time, frame })
    },
    async aim({ y, handZ = 0.03, time }) {
      if (sourceKind === 'controller') {
        setControllerRayAtPanelLocal(
          fixture,
          menu.presentation.group,
          three,
          0,
          y,
        )
      } else {
        fixture.moveFingertipTo(
          fixture.nextFrame(time),
          menu.presentation.group.localToWorld(
            new three.Vector3(0, y, handZ),
          ),
        )
      }
    },
    moveSelectionAway() {
      if (sourceKind === 'controller') fixture.controller.position.x += 2
      else fixture.selectionInput.position.x += 2
    },
    disconnectMenuSource() {
      fixture.menuInput.connected = false
    },
    placeBehindMenu() {},
    placeBehindOutsideMenu() {},
    dispatchSceneActions() {
      return behind.dispatch(
        !unmounted && threeWristMenuBlocksSceneInput(menu, fixture.inputSource),
      )
    },
    terminalEvents: () => terminalWristMenuEvents(events),
    sourceNeutralized: () =>
      !threeWristMenuBlocksSceneInput(menu, fixture.inputSource),
    menuPresent: () =>
      !unmounted && menu.presentation.group.children.length > 0,
    async unmount() {
      if (!unmounted) {
        disposeThreeWristMenu(menu)
        unmounted = true
      }
    },
    iwerFrames: () => fixture.frameCount,
    rendererFrames: () => rendererFrames,
    wristMenuEvents: () => events,
    async dispose() {
      if (!unmounted) disposeThreeWristMenu(menu)
      if (!disposed) fixture.restoreGlobals()
      unmounted = true
      disposed = true
    },
  }
}

async function createThreeSemanticRun({
  sourceKind,
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  iwer,
  three,
}, { scenario, wrist }) {
  const createFixture = (wrist = 'left') =>
    sourceKind === 'controller'
      ? createIwerControllerFixture(iwer, wrist)
      : createIwerHandFixture(iwer, wrist)
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
  const automaticDwellCase = scenario.automaticDwell
  const initialSnapshot =
    automaticDwellCase
      ? {
          ...snapshotForWrist(crossInputSnapshot, wrist),
          activationMode: 'automatic',
          comfort: { transitionMs: 0 },
        }
      : scenario.menuDefinition === 'long'
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
  const update = (frame, time) => {
    rendererFrames += 1
    updateThreeWristMenu(menu, { time, frame })
  }
  let viewerPositions
  const viewerPosition = (mode) => {
    if (mode === 'neutral') return null
    if (viewerPositions === undefined) return [0, -1, 0]
    return viewerPositions[mode]
  }
  const captureViewerPositions = () => {
    const position = menu.presentation.group.getWorldPosition(
      new three.Vector3(),
    )
    const normal = new three.Vector3(0, 0, 1).applyQuaternion(
      menu.presentation.group.getWorldQuaternion(new three.Quaternion()),
    )
    viewerPositions = {
      facing: position.clone().add(normal).toArray(),
      away: position.clone().sub(normal).toArray(),
    }
  }
  return {
    sourceKind,
    async step(time, { input = 'next', viewer = 'neutral' } = {}) {
      let frame = input === 'press'
        ? fixture.press(time)
        : input === 'release'
          ? fixture.release(time)
          : fixture.nextFrame(time)
      const position = viewerPosition(viewer)
      if (position !== null) {
        frame = withViewerPosition(frame, position, fixture, sourceKind)
      }
      update(frame, time)
      if (viewerPositions === undefined) captureViewerPositions()
    },
    async aim({ y, handZ = 0.03, time }) {
      if (sourceKind === 'controller') {
        setControllerRayAtPanelLocal(
          fixture,
          menu.presentation.group,
          three,
          0,
          y,
        )
      } else {
        const frame = fixture.nextFrame(time)
        fixture.moveFingertipTo(
          frame,
          menu.presentation.group.localToWorld(
            new three.Vector3(0, y, handZ),
          ),
        )
      }
    },
    moveSelectionAway() {
      if (sourceKind === 'controller') fixture.controller.position.x += 2
      else fixture.selectionInput.position.x += 2
    },
    disconnectMenuSource() {
      fixture.menuInput.connected = false
    },
    switchInputMode() {
      fixture.device.primaryInputMode =
        sourceKind === 'controller' ? 'hand' : 'controller'
    },
    sourceSwitched() {
      return (
        fixture.device.primaryInputMode ===
          (sourceKind === 'controller' ? 'hand' : 'controller') &&
        !fixture.session.inputSources.includes(fixture.inputSource)
      )
    },
    async activeTransient() {
      return {
        kind: sourceKind === 'controller'
          ? 'selection-ownership'
          : 'scene-input-claim',
        claimed: threeWristMenuBlocksSceneInput(
          menu,
          fixture.inputSource,
        ),
      }
    },
    transientCleared() {
      return (
        !threeWristMenuBlocksSceneInput(menu, fixture.inputSource) &&
        menu.runtime.selectionState.claims.size === 0 &&
        menu.runtime.selectionState.ownership === undefined &&
        menu.runtime.scrollState.ownerSourceId === null
      )
    },
    visible: () => menu.presentation.group.visible,
    revealPhase: () => menu.runtime.revealState.phase,
    scrollOffset: () => menu.runtime.scrollState.offset,
    presentationSignature: () =>
      presentationModelSignature(menu.presentation.group),
    selectionIntentCount: () => events.filter(
      ({ type }) => type === 'selection-intent',
    ).length,
    terminalEvents: () => terminalWristMenuEvents(events),
    setVisibility(state) {
      fixture.device.updateVisibilityState(state)
    },
    async endAndReenterSession() {
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
      return {
        sessionEnded,
        sessionCleanup,
        newSessionIdentity: nextSession !== previousSession,
      }
    },
    async setMenuDefinition(kind) {
      syncThreeWristMenu(menu, {
        ...snapshotForWrist(crossInputSnapshot, wrist),
        ...(kind === 'empty' ? { menuDefinition: [] } : {}),
      })
    },
    iwerFrames: () => fixture.frameCount,
    rendererFrames: () => rendererFrames,
    wristMenuEvents: () => events,
    async dispose() {
      disposeThreeWristMenu(menu)
      fixture.restoreGlobals()
    },
  }
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
      createSemanticRun: (input) => createThreeSemanticRun({
        sourceKind: 'controller',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        syncThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, input),
      createSceneEventShieldRun: () => createThreeSceneEventShieldRun({
        sourceKind: 'controller',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }),
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
      createSemanticRun: (input) => createThreeSemanticRun({
        sourceKind: 'hand',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        syncThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }, input),
      createSceneEventShieldRun: () => createThreeSceneEventShieldRun({
        sourceKind: 'hand',
        createThreeWristMenuState,
        disposeThreeWristMenu,
        threeWristMenuBlocksSceneInput,
        updateThreeWristMenu,
        iwer,
        three,
      }),
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

async function createReactSemanticRun(
  dependencies,
  sourceKind,
  { scenario, wrist },
) {
  const { three } = dependencies
  const baseSnapshot = snapshotForWrist(crossInputSnapshot, wrist)
  const initialSnapshot = scenario.automaticDwell
    ? {
        ...baseSnapshot,
        activationMode: 'automatic',
        comfort: { transitionMs: 0 },
      }
    : scenario.menuDefinition === 'long'
      ? {
          ...baseSnapshot,
          menuDefinition: Array.from({ length: 18 }, (_, index) => ({
            type: 'action',
            id: `row-${index}`,
            label: `Row ${index}`,
          })),
        }
      : baseSnapshot
  const harness = await createReactRendererHarness({
    ...dependencies,
    sourceKind,
    wrist,
    snapshot: initialSnapshot,
  })
  let rendererFrames = 0
  let viewerPositions
  const group = () => {
    const current = harness.menuGroup()
    assert.ok(current)
    return current
  }
  const viewerPosition = (mode) => {
    if (mode === 'neutral') return null
    if (viewerPositions === undefined) return [0, -1, 0]
    return viewerPositions[mode]
  }
  const captureViewerPositions = () => {
    const current = group()
    const position = current.getWorldPosition(new three.Vector3())
    const normal = new three.Vector3(0, 0, 1).applyQuaternion(
      current.getWorldQuaternion(new three.Quaternion()),
    )
    viewerPositions = {
      facing: position.clone().add(normal).toArray(),
      away: position.clone().sub(normal).toArray(),
    }
  }

  return {
    sourceKind,
    async step(time, { input = 'next', viewer = 'neutral' } = {}) {
      let frame = input === 'press'
        ? harness.fixture.press(time)
        : input === 'release'
          ? harness.fixture.release(time)
          : harness.fixture.nextFrame(time)
      const position = viewerPosition(viewer)
      if (position !== null) {
        frame = withViewerPosition(frame, position, harness.fixture, sourceKind)
      }
      rendererFrames += 1
      await harness.advance(time, frame)
      if (viewerPositions === undefined) captureViewerPositions()
    },
    async aim({ y, handZ = 0.03, time }) {
      harness.aimSelectionAtMenuLocal(group(), {
        y,
        handZ,
        ...(sourceKind === 'hand'
          ? { frame: harness.fixture.nextFrame(time) }
          : {}),
      })
    },
    moveSelectionAway: harness.releaseSelectionSource,
    disconnectMenuSource() {
      harness.fixture.menuInput.connected = false
    },
    switchInputMode() {
      harness.fixture.device.primaryInputMode =
        sourceKind === 'controller' ? 'hand' : 'controller'
    },
    sourceSwitched() {
      return (
        harness.fixture.device.primaryInputMode ===
          (sourceKind === 'controller' ? 'hand' : 'controller') &&
        !harness.fixture.session.inputSources.includes(harness.fixture.inputSource)
      )
    },
    async activeTransient() {
      harness.placeBehindMenu()
      const dispatches = harness.dispatchSceneActions()
      return {
        kind: sourceKind === 'controller'
          ? 'selection-ownership'
          : 'scene-input-claim',
        claimed: dispatches.every(
          ({ behindTargetDeliveries }) => behindTargetDeliveries === 0,
        ),
      }
    },
    transientCleared() {
      const events = terminalWristMenuEvents(harness.wristMenuEvents)
      return (
        harness.fixture.device.primaryInputMode ===
          (sourceKind === 'controller' ? 'hand' : 'controller') &&
        !harness.fixture.session.inputSources.includes(harness.fixture.inputSource) &&
        events.length === 1 &&
        events[0].type === 'selection-cancellation' &&
        harness.wristMenuEvents.every(({ type }) => type !== 'selection-intent')
      )
    },
    visible: () => group().visible,
    revealPhase: () => undefined,
    scrollOffset: () => observedPresentationScrollOffset(group()),
    presentationSignature: () => presentationModelSignature(group()),
    selectionIntentCount: () => harness.wristMenuEvents.filter(
      ({ type }) => type === 'selection-intent',
    ).length,
    terminalEvents: () => terminalWristMenuEvents(harness.wristMenuEvents),
    setVisibility(state) {
      harness.fixture.device.updateVisibilityState(state)
    },
    async endAndReenterSession() {
      const transition = await harness.endAndReenterSession()
      return {
        sessionEnded:
          transition.iwerSessionEnded &&
          transition.endedStoreSession &&
          !group().visible,
        sessionCleanup: transition.endedStoreSession && !group().visible,
        newSessionIdentity:
          transition.nextSession !== transition.previousSession &&
          transition.reenteredStoreSession,
      }
    },
    async setMenuDefinition(kind) {
      await harness.render({
        ...baseSnapshot,
        ...(kind === 'empty' ? { menuDefinition: [] } : {}),
      })
    },
    iwerFrames: () => harness.fixture.frameCount,
    rendererFrames: () => rendererFrames,
    wristMenuEvents: () => harness.wristMenuEvents,
    dispose: harness.dispose,
  }
}

async function createReactSceneEventShieldRun(dependencies, sourceKind) {
  const harness = await createReactRendererHarness({
    ...dependencies,
    sourceKind,
    wrist: 'left',
    snapshot: crossInputSnapshot,
  })
  let rendererFrames = 0
  let lastDispatch = []
  let unmounted = false
  const group = () => {
    const current = harness.menuGroup()
    assert.ok(current)
    return current
  }

  return {
    dispatchPath: 'react-event-manager',
    sourceKind,
    async step(time, { input = 'next' } = {}) {
      const frame = input === 'press'
        ? harness.fixture.press(time)
        : input === 'release'
          ? harness.fixture.release(time)
          : harness.fixture.nextFrame(time)
      rendererFrames += 1
      await harness.advance(time, frame)
    },
    async aim({ y, handZ = 0.03, time }) {
      harness.aimSelectionAtMenuLocal(group(), {
        y,
        handZ,
        ...(sourceKind === 'hand'
          ? { frame: harness.fixture.nextFrame(time) }
          : {}),
      })
    },
    moveSelectionAway: harness.releaseSelectionSource,
    disconnectMenuSource() {
      harness.fixture.menuInput.connected = false
    },
    placeBehindMenu: harness.placeBehindMenu,
    placeBehindOutsideMenu: harness.placeBehindOutsideMenu,
    dispatchSceneActions() {
      lastDispatch = harness.dispatchSceneActions()
      return lastDispatch
    },
    terminalEvents: () => terminalWristMenuEvents(harness.wristMenuEvents),
    sourceNeutralized: () => lastDispatch.every(
      ({ behindTargetDeliveries }) => behindTargetDeliveries > 0,
    ),
    menuPresent: () => harness.menuGroup() !== undefined,
    async unmount(time) {
      await harness.render(crossInputSnapshot, false)
      rendererFrames += 1
      await harness.advance(time, harness.fixture.nextFrame(time))
      unmounted = true
    },
    iwerFrames: () => harness.fixture.frameCount,
    rendererFrames: () => rendererFrames,
    wristMenuEvents: () => harness.wristMenuEvents,
    async dispose() {
      if (!unmounted) await harness.render(crossInputSnapshot, false)
      await harness.dispose()
    },
  }
}

async function runPackedReactJourney(dependencies, sourceKind) {
  return runRendererJourneyEvidence({
    rendererIntegration: 'react',
    sourceKind,
    createSemanticRun: (input) =>
      createReactSemanticRun(dependencies, sourceKind, input),
    createSceneEventShieldRun: () =>
      createReactSceneEventShieldRun(dependencies, sourceKind),
  })
}

export async function runPackedReactControllerJourney(dependencies) {
  return runPackedReactJourney(dependencies, 'controller')
}

export async function runPackedReactHandJourney(dependencies) {
  return runPackedReactJourney(dependencies, 'hand')
}
