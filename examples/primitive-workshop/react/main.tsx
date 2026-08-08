import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { createXRStore, XR } from '@react-three/xr'
import { DoubleSide } from 'three'
import {
  WristMenu,
  wristMenuSessionFeatures,
  type WristMenuEvent,
} from '@xleepy/wrist-menu/react'

import {
  WORKSHOP_BOUNDS_METERS,
  createWorkshopModel,
  reduceWorkshop,
  reduceWorkshopMenuEvent,
  workshopHostSnapshot,
  type WorkshopAction,
  type WorkshopModel,
  type WorkshopObject,
} from '../shared/workshop-model.js'

import './style.css'

const xrStore = createXRStore({
  customSessionInit: {
    optionalFeatures: [...wristMenuSessionFeatures.optionalFeatures],
  },
})

type SceneEvent = ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>

function eventActionId(prefix: string, event: SceneEvent): string {
  return `${prefix}:${event.nativeEvent.timeStamp}`
}

function PrimitiveObjectView({
  object,
  selected,
  dispatch,
}: Readonly<{
  object: WorkshopObject
  selected: boolean
  dispatch: (action: WorkshopAction, actionId: string) => void
}>) {
  const geometry =
    object.primitive === 'sphere' ? (
      <sphereGeometry args={[0.1, 24, 16]} />
    ) : object.primitive === 'cylinder' ? (
      <cylinderGeometry args={[0.085, 0.085, 0.2, 24]} />
    ) : (
      <boxGeometry args={[0.18, 0.18, 0.18]} />
    )
  const height = object.primitive === 'cube' ? 0.09 : 0.1

  return (
    <mesh
      position={[object.position[0], object.position[1] + height, object.position[2]]}
      onClick={(event) => {
        event.stopPropagation()
        dispatch(
          { type: 'select-object', objectId: object.id },
          eventActionId(`object:${object.id}`, event),
        )
      }}
    >
      {geometry}
      <meshStandardMaterial
        color={selected ? '#ffd27e' : '#cb70dc'}
        emissive={selected ? '#5c3c10' : '#25102a'}
        roughness={0.42}
      />
    </mesh>
  )
}

function WorkshopScene({
  model,
  dispatch,
  onMenuEvent,
}: Readonly<{
  model: WorkshopModel
  dispatch: (action: WorkshopAction, actionId: string) => void
  onMenuEvent: (event: WristMenuEvent) => void
}>) {
  const snapshot = useMemo(() => workshopHostSnapshot(model), [model])

  const placeCursor = useCallback(
    (event: SceneEvent, prefix: string) => {
      const localX = event.point.x
      const localZ = event.point.z + 0.55
      const valid =
        Math.abs(localX) <= WORKSHOP_BOUNDS_METERS &&
        Math.abs(localZ) <= WORKSHOP_BOUNDS_METERS
      dispatch(
        { type: 'place-cursor', position: [localX, 0, localZ], valid },
        eventActionId(prefix, event),
      )
    },
    [dispatch],
  )

  return (
    <>
      <ambientLight intensity={1.4} color="#f3c9f5" />
      <directionalLight intensity={2.3} position={[1.5, 3, 1]} />
      <group position={[0, 0.72, -0.55]}>
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerMove={(event) => placeCursor(event, 'table-move')}
          onClick={(event) => placeCursor(event, 'table-select')}
        >
          <planeGeometry args={[WORKSHOP_BOUNDS_METERS * 2, WORKSHOP_BOUNDS_METERS * 2]} />
          <meshStandardMaterial color="#2d1733" roughness={0.82} side={DoubleSide} />
        </mesh>
        {model.gridVisible ? (
          <gridHelper args={[WORKSHOP_BOUNDS_METERS * 2, 8, '#ed8df4', '#603866']} position={[0, 0.003, 0]} />
        ) : null}
        {model.placementCursor.valid ? (
          <mesh
            position={[model.placementCursor.position[0], 0.008, model.placementCursor.position[2]]}
            rotation={[-Math.PI / 2, 0, 0]}
          >
            <ringGeometry args={[0.055, 0.072, 32]} />
            <meshBasicMaterial color="#ffb4ff" side={DoubleSide} />
          </mesh>
        ) : null}
        {model.objects.map((object) => (
          <PrimitiveObjectView
            key={object.id}
            object={object}
            selected={object.id === model.selectedObjectId}
            dispatch={dispatch}
          />
        ))}
        <WristMenu snapshot={snapshot} onEvent={onMenuEvent} />
      </group>
    </>
  )
}

function App() {
  const [model, setModel] = useState(createWorkshopModel)
  const [message, setMessage] = useState('Ready for VR')
  const desktopActionSequence = model.revision + 1

  const dispatch = useCallback((action: WorkshopAction, actionId: string) => {
    setModel((current) => reduceWorkshop(current, { actionId, action }))
  }, [])
  const onMenuEvent = useCallback((event: WristMenuEvent) => {
    setModel((current) => reduceWorkshopMenuEvent(current, event))
  }, [])

  const enterVr = async () => {
    try {
      await xrStore.enterVR()
      setMessage('VR active · Wrist Menu ready')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="app">
      <header className="hud">
        <div>
          <p className="eyebrow">React Three Fiber + XR Example Variant</p>
          <h1>Primitive Workshop</h1>
          <p className="status">
            {message} · {model.objects.length} object{model.objects.length === 1 ? '' : 's'} · {model.menuWrist} wrist
          </p>
        </div>
        <div className="actions">
          <button type="button" onClick={() => void enterVr()}>Enter VR</button>
          <button
            type="button"
            onClick={(event) =>
              dispatch(
                { type: 'spawn' },
                `desktop-spawn:${desktopActionSequence}:${event.timeStamp}`,
              )
            }
          >
            Spawn at cursor
          </button>
        </div>
      </header>
      <Canvas camera={{ position: [0, 1.55, 2.25], fov: 55 }}>
        <color attach="background" args={['#100916']} />
        <XR store={xrStore}>
          <WorkshopScene model={model} dispatch={dispatch} onMenuEvent={onMenuEvent} />
        </XR>
      </Canvas>
      <aside className="help">
        Point at the table to move the Placement Cursor. Use the Wrist Menu to
        choose and spawn shapes, remove a selected object, toggle grid behavior,
        switch wrists, and drag the long menu to scroll.
      </aside>
    </div>
  )
}

const rootElement = document.querySelector('#root')
if (rootElement === null) throw new Error('Primitive Workshop root is missing')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
