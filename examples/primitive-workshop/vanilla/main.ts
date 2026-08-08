import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import {
  createThreeWristMenuState,
  disposeThreeWristMenu,
  syncThreeWristMenu,
  threeWristMenuBlocksSceneInput,
  updateThreeWristMenu,
  WRIST_MENU_PACKAGE_VERSION,
  wristMenuSessionFeatures,
  type WristMenuEvent,
} from '@xleepy/wrist-menu/three'

import {
  WORKSHOP_BOUNDS_METERS,
  createWorkshopScenario,
  reduceWorkshop,
  reduceWorkshopMenuEvent,
  workshopHostSnapshot,
  type WorkshopAction,
  type WorkshopModel,
  type WorkshopObject,
} from '../shared/workshop-model.js'
import { createPhysicalActions } from './physical-actions.js'
import { createWorkshopLifecycle } from './lifecycle.js'

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) {
    throw new Error(`Primitive Workshop element is missing: ${selector}`)
  }
  return element
}

const canvas = requiredElement<HTMLCanvasElement>('#workshop')
const enterVrButton = requiredElement<HTMLButtonElement>('#enter-vr')
const spawnButton = requiredElement<HTMLButtonElement>('#spawn')
const status = requiredElement<HTMLElement>('#status')
const diagnostics = requiredElement<HTMLElement>('#diagnostics')

const query = new URLSearchParams(window.location.search)
const debugEnabled = query.get('debug') === '1'
let startupError: string | null = null
let scenario: ReturnType<typeof createWorkshopScenario>
try {
  scenario = createWorkshopScenario(query.get('fixture') ?? 'default')
} catch (error) {
  startupError = error instanceof Error ? error.message : String(error)
  scenario = createWorkshopScenario('default')
}

const scene = new Scene()
scene.background = new Color(0x06110f)
const camera = new PerspectiveCamera(55, 1, 0.01, 50)
camera.position.set(0, 1.55, 2.25)
camera.lookAt(0, 0.25, -0.35)

const renderer = new WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.xr.enabled = true
renderer.xr.setReferenceSpaceType('local-floor')
scene.add(renderer.xr.getController(0), renderer.xr.getController(1))

scene.add(new AmbientLight(0xa9d9c9, 1.4))
const keyLight = new DirectionalLight(0xffffff, 2.3)
keyLight.position.set(1.5, 3, 1)
scene.add(keyLight)

const workshopRoot = new Group()
workshopRoot.position.set(0, 0.72, -0.55)
scene.add(workshopRoot)

const table = new Mesh(
  new PlaneGeometry(WORKSHOP_BOUNDS_METERS * 2, WORKSHOP_BOUNDS_METERS * 2),
  new MeshStandardMaterial({ color: 0x12302a, roughness: 0.82, side: DoubleSide }),
)
table.rotation.x = -Math.PI / 2
table.name = 'workshop-table'
workshopRoot.add(table)

const grid = new GridHelper(WORKSHOP_BOUNDS_METERS * 2, 8, 0x65e6bd, 0x265c4d)
grid.position.y = 0.003
workshopRoot.add(grid)

const cursor = new Mesh(
  new RingGeometry(0.055, 0.072, 32),
  new MeshBasicMaterial({ color: 0x7effd4, side: DoubleSide }),
)
cursor.rotation.x = -Math.PI / 2
cursor.position.y = 0.008
workshopRoot.add(cursor)

const objectsRoot = new Group()
workshopRoot.add(objectsRoot)
const objectMeshes = new Map<string, Mesh>()

let model: WorkshopModel = scenario.model
let actionSequence = 0
let physicalActions: ReturnType<typeof createPhysicalActions>
let lifecycle: ReturnType<typeof createWorkshopLifecycle> | null = null
let lastSemanticEvent = 'none'

function renderDiagnostics(): void {
  const lifecycleState = lifecycle?.snapshot()
  if (lifecycleState === undefined) return
  const detail = `${lifecycleState.variant} · package ${WRIST_MENU_PACKAGE_VERSION} · ${model.objects.length}/12 objects · model revision ${model.revision} · last event ${lastSemanticEvent} · ${lifecycleState.runtimeStatus}`
  diagnostics.textContent = startupError === null
    ? `${detail} · ${lifecycleState.diagnostic.message} Next: ${lifecycleState.diagnostic.nextAction}.`
    : `${detail} · ${startupError}. Next: use fixture=default, full-workshop, empty-definition, or shield.`
  diagnostics.hidden =
    !debugEnabled &&
    startupError === null &&
    lifecycleState.diagnostic.level !== 'error'
}

function currentSnapshot() {
  const lifecycleState = lifecycle?.snapshot()
  const tracksSession =
    lifecycleState !== undefined &&
    !['pre-session', 'requesting', 'rejected', 'ended'].includes(
      lifecycleState.runtimeStatus,
    )
  return workshopHostSnapshot(model, {
    ...scenario.snapshotOptions,
    ...(tracksSession
      ? {
          availableWrists: lifecycleState.availableWrists,
          cursorAvailable: lifecycleState.cursorAvailable,
        }
      : {}),
  })
}

let menu: ReturnType<typeof createThreeWristMenuState> | null = null

function createMenu(): void {
  if (menu !== null) return
  menu = createThreeWristMenuState({
    renderer,
    snapshot: currentSnapshot(),
    onEvent: handleWristMenuEvent,
  })
  workshopRoot.add(menu.presentation.group)
}

function disposeMenu(): void {
  if (menu === null) return
  workshopRoot.remove(menu.presentation.group)
  disposeThreeWristMenu(menu)
  menu = null
}

createMenu()
physicalActions = createPhysicalActions({
  inputSourceForMenuSourceId: (sourceId) =>
    menu?.inputSourceById.get(sourceId) ?? null,
})
lifecycle = createWorkshopLifecycle({
  clearTransientInteraction: () => physicalActions.clearTransientInteraction(),
  onChange: () => {
    if (menu !== null) syncThreeWristMenu(menu, currentSnapshot())
    renderDiagnostics()
  },
})
renderDiagnostics()

function createGeometry(object: WorkshopObject): BufferGeometry {
  if (object.primitive === 'sphere') return new SphereGeometry(0.1, 24, 16)
  if (object.primitive === 'cylinder') {
    return new CylinderGeometry(0.085, 0.085, 0.2, 24)
  }
  return new BoxGeometry(0.18, 0.18, 0.18)
}

function objectHeight(object: WorkshopObject): number {
  return object.primitive === 'cube' ? 0.09 : 0.1
}

function renderWorkshop(): void {
  for (const mesh of objectMeshes.values()) {
    objectsRoot.remove(mesh)
    mesh.geometry.dispose()
    if (!Array.isArray(mesh.material)) mesh.material.dispose()
  }
  objectMeshes.clear()

  for (const object of model.objects) {
    const selected = object.id === model.selectedObjectId
    const mesh = new Mesh(
      createGeometry(object),
      new MeshStandardMaterial({
        color: selected ? 0xffd27e : 0x49b796,
        emissive: selected ? 0x5c3c10 : 0x071b15,
        roughness: 0.42,
      }),
    )
    mesh.position.set(
      object.position[0],
      object.position[1] + objectHeight(object),
      object.position[2],
    )
    mesh.userData['workshopObjectId'] = object.id
    objectsRoot.add(mesh)
    objectMeshes.set(object.id, mesh)
  }

  grid.visible = model.gridVisible
  const lifecycleState = lifecycle?.snapshot()
  const sessionOwnsCursor =
    lifecycleState !== undefined &&
    !['pre-session', 'requesting', 'rejected', 'ended'].includes(
      lifecycleState.runtimeStatus,
    )
  cursor.visible =
    model.placementCursor.status !== 'unavailable' &&
    (!sessionOwnsCursor || lifecycleState.cursorAvailable)
  ;(cursor.material as MeshBasicMaterial).color.set(
    model.placementCursor.status === 'occupied' ? 0xff6b6b : 0x7effd4,
  )
  cursor.position.set(
    model.placementCursor.position[0],
    0.008,
    model.placementCursor.position[2],
  )
  status.textContent = `${model.objects.length} object${model.objects.length === 1 ? '' : 's'} · ${model.selectedPrimitive} · grid ${model.gridVisible ? 'shown' : 'hidden'} · snap ${model.snapToGrid ? 'on' : 'off'} · ${model.menuWrist} wrist`
}

function applyModel(nextModel: WorkshopModel): void {
  if (nextModel === model) return
  model = nextModel
  if (menu !== null) syncThreeWristMenu(menu, currentSnapshot())
  renderWorkshop()
  renderDiagnostics()
}

function dispatch(action: WorkshopAction, physicalActionId?: string): void {
  actionSequence += 1
  applyModel(
    reduceWorkshop(model, {
      actionId: physicalActionId ?? `vanilla-action-${actionSequence}`,
      action,
    }),
  )
}

function handleWristMenuEvent(event: WristMenuEvent): void {
  lastSemanticEvent = event.type === 'selection-intent'
    ? `${event.type}:${event.intent.itemId}`
    : event.type
  applyModel(
    reduceWorkshopMenuEvent(model, event, physicalActions.menuAction(event)),
  )
  renderDiagnostics()
}

const pointer = new Vector2()
const raycaster = new Raycaster()

function setPointer(event: PointerEvent): void {
  const bounds = canvas.getBoundingClientRect()
  pointer.set(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  )
  raycaster.setFromCamera(pointer, camera)
}

function placeCursorFromRay(actionId: string): boolean {
  const hit = raycaster.intersectObject(table, false)[0]
  if (hit === undefined) return false
  const local = workshopRoot.worldToLocal(hit.point.clone())
  const valid =
    Math.abs(local.x) <= WORKSHOP_BOUNDS_METERS &&
    Math.abs(local.z) <= WORKSHOP_BOUNDS_METERS
  dispatch(
    { type: 'place-cursor', position: [local.x, 0, local.z], valid },
    actionId,
  )
  lifecycle?.markCursorAvailable()
  return true
}

function interactFromCurrentRay(actionId: string): void {
  const objectHit = raycaster.intersectObjects([...objectMeshes.values()], false)[0]
  const objectId = objectHit?.object.userData['workshopObjectId']
  if (typeof objectId === 'string') {
    dispatch({ type: 'select-object', objectId }, actionId)
    return
  }
  placeCursorFromRay(actionId)
}

canvas.addEventListener('pointermove', (event) => {
  if (renderer.xr.isPresenting) return
  setPointer(event)
  placeCursorFromRay(`desktop-move:${event.pointerId}:${event.timeStamp}`)
})
canvas.addEventListener('click', (event) => {
  if (renderer.xr.isPresenting) return
  setPointer(event)
  interactFromCurrentRay(`desktop-select:${event.pointerId}:${event.timeStamp}`)
})
spawnButton.addEventListener('click', (event) => {
  dispatch({ type: 'spawn' }, `desktop-spawn:${event.timeStamp}`)
})

const controllerOrigin = new Vector3()
const controllerDirection = new Vector3()
const controllerRotation = new Matrix4()

function interactFromController(inputSource: XRInputSource, actionId: string): void {
  if (menu !== null && threeWristMenuBlocksSceneInput(menu, inputSource)) return
  const session = renderer.xr.getSession()
  const inputIndex = session === null ? -1 : [...session.inputSources].indexOf(inputSource)
  if (inputIndex < 0) return
  const controller = renderer.xr.getController(inputIndex)
  controller.updateWorldMatrix(true, false)
  controllerOrigin.setFromMatrixPosition(controller.matrixWorld)
  controllerRotation.extractRotation(controller.matrixWorld)
  controllerDirection.set(0, 0, -1).applyMatrix4(controllerRotation).normalize()
  raycaster.set(controllerOrigin, controllerDirection)
  interactFromCurrentRay(actionId)
}

async function enterVr(): Promise<void> {
  if (navigator.xr === undefined) {
    status.textContent = 'WebXR is unavailable in this browser.'
    lifecycle?.sessionRejected(
      new Error('WebXR requires an HTTPS or localhost WebXR-capable browser'),
    )
    return
  }
  createMenu()
  lifecycle?.beginSessionRequest()
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-vr')
    if (!supported) {
      status.textContent = 'Immersive VR is unavailable on this device.'
      lifecycle?.sessionRejected(
        new Error('Immersive VR is not supported; use an HTTPS WebXR-capable device'),
      )
      return
    }
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: [...wristMenuSessionFeatures.optionalFeatures],
    })
    physicalActions.attachSession(session)
    lifecycle?.sessionActivated(session)
    session.addEventListener('select', (event) => {
      const physicalActionId = physicalActions.sceneAction(event)
      if (physicalActionId === null) return
      interactFromController(
        event.inputSource,
        physicalActionId,
      )
    })
    session.addEventListener('end', () => {
      enterVrButton.textContent = 'Enter VR'
      disposeMenu()
    })
    await renderer.xr.setSession(session)
    enterVrButton.textContent = 'VR active'
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error)
    lifecycle?.sessionRejected(error)
  }
}

enterVrButton.addEventListener('click', () => void enterVr())

function resize(): void {
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  renderer.setSize(width, height, false)
  camera.aspect = width / Math.max(height, 1)
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()
renderWorkshop()

renderer.setAnimationLoop((time, frame) => {
  if (menu !== null) updateThreeWristMenu(menu, { time, frame })
  renderer.render(scene, camera)
})

window.addEventListener('pagehide', () => {
  physicalActions.dispose()
  lifecycle?.dispose()
  disposeMenu()
  renderer.dispose()
})
