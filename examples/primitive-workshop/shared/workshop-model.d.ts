import type { HostSnapshot, WristMenuEvent } from '@xleepy/wrist-menu'

export type WorkshopPrimitive = 'cube' | 'sphere' | 'cylinder'
export type WorkshopPosition = readonly [number, number, number]
export type WorkshopObject = Readonly<{
  id: string
  primitive: WorkshopPrimitive
  position: WorkshopPosition
  snapped: boolean
}>
export type WorkshopModel = Readonly<{
  revision: number
  selectedPrimitive: WorkshopPrimitive
  placementCursor: Readonly<{
    position: WorkshopPosition
    valid: boolean
  }>
  objects: readonly WorkshopObject[]
  selectedObjectId: string | null
  gridVisible: boolean
  snapToGrid: boolean
  menuWrist: 'left' | 'right'
  nextObjectNumber: number
  lastPhysicalActionId: string | null
}>

export type WorkshopAction =
  | Readonly<{
      type: 'place-cursor'
      position: WorkshopPosition
      valid: boolean
    }>
  | Readonly<{ type: 'spawn' }>
  | Readonly<{ type: 'select-object'; objectId: string }>
  | Readonly<{ type: 'remove-selection' }>
  | Readonly<{ type: 'choose-primitive'; primitive: WorkshopPrimitive }>
  | Readonly<{ type: 'set-grid-visible'; visible: boolean }>
  | Readonly<{ type: 'set-snap-to-grid'; enabled: boolean }>
  | Readonly<{ type: 'set-menu-wrist'; wrist: 'left' | 'right' }>
  | Readonly<{ type: 'reset' }>

export const WORKSHOP_BOUNDS_METERS: number
export const GRID_STEP_METERS: number

export function createWorkshopModel(): WorkshopModel
export function reduceWorkshop(
  model: WorkshopModel,
  command: Readonly<{ actionId: string; action: WorkshopAction }>,
): WorkshopModel
export function reduceWorkshopMenuEvent(
  model: WorkshopModel,
  event: WristMenuEvent,
): WorkshopModel
export function workshopHostSnapshot(model: WorkshopModel): HostSnapshot
