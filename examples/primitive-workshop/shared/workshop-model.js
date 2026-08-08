/**
 * The framework-neutral Primitive Workshop state and transitions.
 *
 * This file deliberately has no renderer imports or browser-global access. Both
 * Example Variants consume this one portable model and render it independently.
 */

export const WORKSHOP_BOUNDS_METERS = 1
export const GRID_STEP_METERS = 0.25

const primitiveTypes = new Set(['cube', 'sphere', 'cylinder'])
const handednessValues = new Set(['left', 'right'])

function freezePosition(position) {
  return Object.freeze([position[0], position[1], position[2]])
}

function freezeObject(object) {
  return Object.freeze({
    id: object.id,
    primitive: object.primitive,
    position: freezePosition(object.position),
    snapped: object.snapped,
  })
}

function freezeModel(model) {
  return Object.freeze({
    revision: model.revision,
    selectedPrimitive: model.selectedPrimitive,
    placementCursor: Object.freeze({
      position: freezePosition(model.placementCursor.position),
      valid: model.placementCursor.valid,
    }),
    objects: Object.freeze(model.objects.map(freezeObject)),
    selectedObjectId: model.selectedObjectId,
    gridVisible: model.gridVisible,
    snapToGrid: model.snapToGrid,
    menuWrist: model.menuWrist,
    nextObjectNumber: model.nextObjectNumber,
    lastPhysicalActionId: model.lastPhysicalActionId,
  })
}

/** Create the deterministic initial Workshop Model. */
export function createWorkshopModel() {
  return freezeModel({
    revision: 0,
    selectedPrimitive: 'cube',
    placementCursor: { position: [0, 0, -0.5], valid: true },
    objects: [],
    selectedObjectId: null,
    gridVisible: true,
    snapToGrid: true,
    menuWrist: 'left',
    nextObjectNumber: 1,
    lastPhysicalActionId: null,
  })
}

function assertPhysicalActionId(actionId) {
  if (typeof actionId !== 'string' || actionId.length === 0) {
    throw new TypeError('Workshop physical action ID must be a non-empty string')
  }
}

function assertPosition(position) {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(Number.isFinite)
  ) {
    throw new TypeError('Placement Cursor position must contain three finite numbers')
  }
}

function nextModel(model, actionId, changes) {
  return freezeModel({
    ...model,
    ...changes,
    revision: model.revision + 1,
    lastPhysicalActionId: actionId,
  })
}

function snapCoordinate(coordinate) {
  return Math.round(coordinate / GRID_STEP_METERS) * GRID_STEP_METERS
}

/**
 * Apply one physical action. Repeated delivery of the same physical action ID
 * returns the existing model, making duplicate event paths harmless.
 */
export function reduceWorkshop(model, command) {
  assertPhysicalActionId(command?.actionId)
  if (model.lastPhysicalActionId === command.actionId) return model

  const action = command.action
  if (typeof action !== 'object' || action === null) {
    throw new TypeError('Workshop action must be an object')
  }

  switch (action.type) {
    case 'place-cursor': {
      assertPosition(action.position)
      const position = freezePosition(action.position)
      const valid = action.valid === true
      if (
        model.placementCursor.valid === valid &&
        model.placementCursor.position.every(
          (coordinate, index) => coordinate === position[index],
        )
      ) {
        return model
      }
      return nextModel(model, command.actionId, {
        placementCursor: { position, valid },
      })
    }

    case 'spawn': {
      if (!model.placementCursor.valid) return model
      const [x, y, z] = model.placementCursor.position
      const position = model.snapToGrid
        ? [snapCoordinate(x), y, snapCoordinate(z)]
        : [x, y, z]
      const object = {
        id: `workshop-object-${model.nextObjectNumber}`,
        primitive: model.selectedPrimitive,
        position,
        snapped: model.snapToGrid,
      }
      return nextModel(model, command.actionId, {
        objects: [...model.objects, object],
        nextObjectNumber: model.nextObjectNumber + 1,
      })
    }

    case 'select-object': {
      const selectedObject = model.objects.find(
        (object) => object.id === action.objectId,
      )
      if (selectedObject === undefined || model.selectedObjectId === action.objectId) {
        return model
      }
      return nextModel(model, command.actionId, {
        selectedObjectId: action.objectId,
      })
    }

    case 'remove-selection': {
      if (model.selectedObjectId === null) return model
      return nextModel(model, command.actionId, {
        objects: model.objects.filter(
          (object) => object.id !== model.selectedObjectId,
        ),
        selectedObjectId: null,
      })
    }

    case 'choose-primitive': {
      if (!primitiveTypes.has(action.primitive)) {
        throw new TypeError(`Unsupported Workshop primitive: ${action.primitive}`)
      }
      if (model.selectedPrimitive === action.primitive) return model
      return nextModel(model, command.actionId, {
        selectedPrimitive: action.primitive,
      })
    }

    case 'set-grid-visible': {
      if (typeof action.visible !== 'boolean') {
        throw new TypeError('Grid visibility must be a boolean')
      }
      if (model.gridVisible === action.visible) return model
      return nextModel(model, command.actionId, {
        gridVisible: action.visible,
      })
    }

    case 'set-snap-to-grid': {
      if (typeof action.enabled !== 'boolean') {
        throw new TypeError('Grid snapping must be a boolean')
      }
      if (model.snapToGrid === action.enabled) return model
      return nextModel(model, command.actionId, {
        snapToGrid: action.enabled,
      })
    }

    case 'set-menu-wrist': {
      if (!handednessValues.has(action.wrist)) {
        throw new TypeError(`Unsupported menu wrist: ${action.wrist}`)
      }
      if (model.menuWrist === action.wrist) return model
      return nextModel(model, command.actionId, {
        menuWrist: action.wrist,
      })
    }

    case 'reset': {
      const reset = createWorkshopModel()
      return freezeModel({
        ...reset,
        revision: model.revision + 1,
        lastPhysicalActionId: command.actionId,
      })
    }

    default:
      throw new TypeError(`Unsupported Workshop action: ${action.type}`)
  }
}

function menuAction(intent) {
  if (intent.type === 'action') {
    if (intent.itemId === 'spawn-primitive') return { type: 'spawn' }
    if (intent.itemId === 'remove-selection') {
      return { type: 'remove-selection' }
    }
    if (intent.itemId === 'reset-workshop') return { type: 'reset' }
    return null
  }

  if (intent.type === 'toggle') {
    if (intent.itemId === 'grid-visible') {
      return { type: 'set-grid-visible', visible: intent.proposedValue }
    }
    if (intent.itemId === 'snap-to-grid') {
      return { type: 'set-snap-to-grid', enabled: intent.proposedValue }
    }
    return null
  }

  if (intent.type === 'choice') {
    if (intent.groupId === 'primitive-choice') {
      return { type: 'choose-primitive', primitive: intent.proposedValue }
    }
    if (intent.groupId === 'menu-wrist') {
      return { type: 'set-menu-wrist', wrist: intent.proposedValue }
    }
  }
  return null
}

/** Apply a semantic Wrist Menu Event to the Workshop Model. */
export function reduceWorkshopMenuEvent(model, event) {
  if (event.type !== 'selection-intent') return model
  const action = menuAction(event.intent)
  if (action === null) return model
  const itemId = event.intent.itemId
  return reduceWorkshop(model, {
    actionId: `menu:${event.source.id}:${event.time}:${itemId}`,
    action,
  })
}

/** Derive the complete immutable Host Snapshot for one Workshop Model revision. */
export function workshopHostSnapshot(model) {
  const removeDisabled = model.selectedObjectId === null
  const spawnDisabled = !model.placementCursor.valid
  const menuDefinition = [
    {
      type: 'action',
      id: 'spawn-primitive',
      label: `Spawn ${model.selectedPrimitive}`,
      iconKey: 'add',
      disabled: spawnDisabled,
      ...(spawnDisabled
        ? { disabledReason: 'Move the Placement Cursor onto the table' }
        : {}),
    },
    { type: 'separator', id: 'objects-section', label: 'Objects' },
    {
      type: 'action',
      id: 'remove-selection',
      label: 'Remove selection',
      iconKey: 'remove',
      disabled: removeDisabled,
      ...(removeDisabled
        ? { disabledReason: 'Select a Workshop Object first' }
        : {}),
    },
    { type: 'separator', id: 'primitive-section', label: 'Primitive' },
    {
      type: 'choice-group',
      id: 'primitive-choice',
      label: 'Primitive shape',
      selectedValue: model.selectedPrimitive,
      options: [
        { id: 'primitive-cube', label: 'Cube', value: 'cube' },
        { id: 'primitive-sphere', label: 'Sphere', value: 'sphere' },
        { id: 'primitive-cylinder', label: 'Cylinder', value: 'cylinder' },
      ],
    },
    { type: 'separator', id: 'grid-section', label: 'Grid' },
    {
      type: 'toggle',
      id: 'grid-visible',
      label: 'Show grid',
      value: model.gridVisible,
    },
    {
      type: 'toggle',
      id: 'snap-to-grid',
      label: 'Snap placement',
      value: model.snapToGrid,
    },
    { type: 'separator', id: 'wrist-section', label: 'Menu wrist' },
    {
      type: 'choice-group',
      id: 'menu-wrist',
      label: 'Attach menu to',
      selectedValue: model.menuWrist,
      options: [
        { id: 'wrist-left', label: 'Left wrist', value: 'left' },
        { id: 'wrist-right', label: 'Right wrist', value: 'right' },
      ],
    },
    {
      type: 'action',
      id: 'reset-workshop',
      label: 'Reset workshop',
      iconKey: 'reset',
    },
  ]

  for (const entry of menuDefinition) {
    if (entry.type === 'choice-group') {
      for (const option of entry.options) Object.freeze(option)
      Object.freeze(entry.options)
    }
    Object.freeze(entry)
  }

  return Object.freeze({
    activationMode: 'automatic',
    wrist: model.menuWrist,
    menuDefinition: Object.freeze(menuDefinition),
  })
}
