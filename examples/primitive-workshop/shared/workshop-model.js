/**
 * The framework-neutral Primitive Workshop state and transitions.
 *
 * This file deliberately has no renderer imports or browser-global access. Both
 * Example Variants consume this one portable model and render it independently.
 */

/** @typedef {import('@xleepy/wrist-menu').HostSnapshot} HostSnapshot */
/** @typedef {import('@xleepy/wrist-menu').MenuDefinitionEntry} MenuDefinitionEntry */
/** @typedef {import('@xleepy/wrist-menu').SelectionIntent} SelectionIntent */
/** @typedef {import('@xleepy/wrist-menu').WristMenuEvent} WristMenuEvent */

/** @typedef {'cube' | 'sphere' | 'cylinder'} WorkshopPrimitive */
/** @typedef {readonly [number, number, number]} WorkshopPosition */
/** @typedef {'unavailable' | 'valid' | 'occupied'} PlacementCursorStatus */
/**
 * @typedef {Readonly<{
 *   requestedPosition: WorkshopPosition,
 *   position: WorkshopPosition,
 *   requestedPositionObserved: boolean,
 *   valid: boolean,
 *   status: PlacementCursorStatus,
 * }>} PlacementCursor
 */
/**
 * @typedef {Readonly<{
 *   id: string,
 *   primitive: WorkshopPrimitive,
 *   position: WorkshopPosition,
 *   snapped: boolean,
 * }>} WorkshopObject
 */
/**
 * @typedef {Readonly<{
 *   revision: number,
 *   selectedPrimitive: WorkshopPrimitive,
 *   placementCursor: PlacementCursor,
 *   objects: readonly WorkshopObject[],
 *   selectedObjectId: string | null,
 *   gridVisible: boolean,
 *   snapToGrid: boolean,
 *   menuWrist: 'left' | 'right',
 *   nextObjectNumber: number,
 *   processedPhysicalActionIds: readonly string[],
 * }>} WorkshopModel
 */
/**
 * @typedef {
 *   | Readonly<{type: 'place-cursor', position: WorkshopPosition, valid: boolean}>
 *   | Readonly<{type: 'spawn'}>
 *   | Readonly<{type: 'select-object', objectId: string}>
 *   | Readonly<{type: 'remove-selection'}>
 *   | Readonly<{type: 'choose-primitive', primitive: WorkshopPrimitive}>
 *   | Readonly<{type: 'set-grid-visible', visible: boolean}>
 *   | Readonly<{type: 'set-snap-to-grid', enabled: boolean}>
 *   | Readonly<{type: 'set-menu-wrist', wrist: 'left' | 'right'}>
 *   | Readonly<{type: 'reset'}>
 * } WorkshopAction
 */
/**
 * @typedef {Readonly<{actionId: string, action: WorkshopAction}>} WorkshopCommand
 */
/** @typedef {'controller' | 'hand'} PhysicalActionKind */
/**
 * @typedef {Readonly<{
 *   kind: PhysicalActionKind,
 *   handedness: 'left' | 'right',
 * }>} PhysicalActionDescriptor
 */
/**
 * @typedef {{
 *   identity: string,
 *   descriptor: PhysicalActionDescriptor,
 *   expiresAt: number,
 *   menuConsumed: boolean,
 *   sceneConsumed: boolean,
 * }} PhysicalActionRecord
 */
/**
 * @typedef {Readonly<{
 *   source: object,
 *   descriptor: PhysicalActionDescriptor,
 * }>} PhysicalActionBinding
 */
/**
 * @typedef {Readonly<{
 *   prefix?: string,
 *   lifetimeMs?: number,
 *   now?: () => number,
 * }>} PhysicalActionCoordinatorOptions
 */
/**
 * @typedef {Readonly<{
 *   bindMenuSource(sourceId: string, source: object, descriptor: PhysicalActionDescriptor): void,
 *   selectStart(source: object, descriptor: PhysicalActionDescriptor, occurrence: object): string,
 *   sceneAction(source: object, descriptor: PhysicalActionDescriptor, occurrence: object): string,
 *   selectEnd(source: object): void,
 *   menuAction(event: WristMenuEvent): string | undefined,
 *   removeSource(source: object): void,
 *   clear(): void,
 * }>} PhysicalActionCoordinator
 */
/**
 * @typedef {Readonly<{
 *   availableWrists?: readonly ('left' | 'right')[],
 *   cursorAvailable?: boolean,
 *   emptyDefinition?: boolean,
 * }>} WorkshopSnapshotOptions
 */

export const WORKSHOP_BOUNDS_METERS = 1
export const GRID_STEP_METERS = 0.25
export const WORKSHOP_OBJECT_CAPACITY = 12
export const WORKSHOP_CLEARANCE_METERS = 0.02
/** Processed identities expire after this many later successful transitions. */
export const PROCESSED_PHYSICAL_ACTION_CAPACITY = 64
/** Correlation lifetime for instantaneous menu/scene input deliveries. */
export const PHYSICAL_ACTION_IDENTITY_LIFETIME_MS = 250

/** @type {ReadonlySet<WorkshopPrimitive>} */
const primitiveTypes = new Set(['cube', 'sphere', 'cylinder'])
/** @type {ReadonlySet<'left' | 'right'>} */
const handednessValues = new Set(['left', 'right'])

/**
 * @param {WorkshopPosition} position
 * @returns {WorkshopPosition}
 */
function freezePosition(position) {
  return Object.freeze([position[0], position[1], position[2]])
}

/**
 * @param {WorkshopObject} object
 * @returns {WorkshopObject}
 */
function freezeObject(object) {
  return Object.freeze({
    id: object.id,
    primitive: object.primitive,
    position: freezePosition(object.position),
    snapped: object.snapped,
  })
}

/**
 * @param {WorkshopModel} model
 * @returns {WorkshopModel}
 */
function freezeModel(model) {
  return Object.freeze({
    revision: model.revision,
    selectedPrimitive: model.selectedPrimitive,
    placementCursor: Object.freeze({
      requestedPosition: freezePosition(
        model.placementCursor.requestedPosition,
      ),
      position: freezePosition(model.placementCursor.position),
      requestedPositionObserved:
        model.placementCursor.requestedPositionObserved,
      valid: model.placementCursor.valid,
      status: model.placementCursor.status,
    }),
    objects: Object.freeze(model.objects.map(freezeObject)),
    selectedObjectId: model.selectedObjectId,
    gridVisible: model.gridVisible,
    snapToGrid: model.snapToGrid,
    menuWrist: model.menuWrist,
    nextObjectNumber: model.nextObjectNumber,
    processedPhysicalActionIds: Object.freeze(
      [...model.processedPhysicalActionIds].slice(
        -PROCESSED_PHYSICAL_ACTION_CAPACITY,
      ),
    ),
  })
}

/** Create the deterministic initial Workshop Model. */
/** @returns {WorkshopModel} */
export function createWorkshopModel() {
  return freezeModel({
    revision: 0,
    selectedPrimitive: 'cube',
    placementCursor: {
      requestedPosition: [0, 0, 0],
      position: [0, 0, 0],
      requestedPositionObserved: false,
      valid: false,
      status: 'unavailable',
    },
    objects: [],
    selectedObjectId: null,
    gridVisible: true,
    snapToGrid: true,
    menuWrist: 'left',
    nextObjectNumber: 1,
    processedPhysicalActionIds: [],
  })
}

/**
 * Coordinate identities at the physical input boundary. Raw XR activity is
 * keyed by XRInputSource object identity. Each Renderer Integration explicitly
 * binds its opaque Wrist Menu source ID to that raw identity. Exact event-object
 * redispatch is deduplicated, while a distinct event consumes a distinct side
 * of the current action. Instantaneous activity has a bounded lifetime.
 * @param {PhysicalActionCoordinatorOptions} [options]
 * @returns {PhysicalActionCoordinator}
 */
export function createPhysicalActionCoordinator(options = {}) {
  const prefix = options.prefix ?? 'physical-action'
  const lifetimeMs =
    options.lifetimeMs ?? PHYSICAL_ACTION_IDENTITY_LIFETIME_MS
  const now = options.now ?? Date.now
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError('Physical action identity prefix must be non-empty')
  }
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
    throw new TypeError('Physical action identity lifetime must be positive')
  }
  if (typeof now !== 'function') {
    throw new TypeError('Physical action clock must be a function')
  }

  let sequence = 0
  /** @type {Map<object, PhysicalActionRecord>} */
  const sourceRecords = new Map()
  /** @type {Map<string, PhysicalActionBinding>} */
  const menuSourceBindings = new Map()
  /** @type {WeakMap<object, string>} */
  let selectStartOccurrences = new WeakMap()
  /** @type {WeakMap<object, string>} */
  let sceneOccurrences = new WeakMap()
  /** @type {WeakMap<object, string>} */
  let menuOccurrences = new WeakMap()

  function readTime() {
    const time = now()
    if (!Number.isFinite(time)) {
      throw new TypeError('Physical action clock must return a finite number')
    }
    return time
  }

  /** @param {number} time */
  function pruneExpired(time) {
    for (const [source, record] of sourceRecords) {
      if (record.expiresAt <= time) sourceRecords.delete(source)
    }
  }

  /** @param {PhysicalActionDescriptor} descriptor */
  function assertDescriptor(descriptor) {
    if (
      (descriptor.kind !== 'controller' && descriptor.kind !== 'hand') ||
      (descriptor.handedness !== 'left' && descriptor.handedness !== 'right')
    ) {
      throw new TypeError('Physical action descriptor must identify kind and hand')
    }
  }

  /** @param {unknown} occurrence */
  function assertOccurrence(occurrence) {
    if (typeof occurrence !== 'object' || occurrence === null) {
      throw new TypeError('Physical action occurrence must be an object')
    }
  }

  /**
   * @param {PhysicalActionDescriptor} descriptor
   * @param {number} expiresAt
   * @returns {PhysicalActionRecord}
   */
  function allocate(descriptor, expiresAt) {
    sequence += 1
    return {
      identity: `${prefix}:${sequence}`,
      descriptor: Object.freeze({ ...descriptor }),
      expiresAt,
      menuConsumed: false,
      sceneConsumed: false,
    }
  }

  /**
   * @param {PhysicalActionDescriptor} first
   * @param {PhysicalActionDescriptor} second
   */
  function sameDescriptor(first, second) {
    return (
      first.kind === second.kind && first.handedness === second.handedness
    )
  }

  /**
   * @param {object} source
   * @param {PhysicalActionDescriptor} descriptor
   * @param {'menuConsumed' | 'sceneConsumed'} side
   * @param {number} time
   */
  function consume(source, descriptor, side, time) {
    let record = sourceRecords.get(source)
    if (
      record === undefined ||
      !sameDescriptor(record.descriptor, descriptor) ||
      record[side]
    ) {
      record = allocate(descriptor, time + lifetimeMs)
      sourceRecords.set(source, record)
    }
    record[side] = true
    return record.identity
  }

  return Object.freeze({
    bindMenuSource(sourceId, source, descriptor) {
      if (typeof sourceId !== 'string' || sourceId.length === 0) {
        throw new TypeError('Wrist Menu source ID must be non-empty')
      }
      assertDescriptor(descriptor)
      menuSourceBindings.set(
        sourceId,
        Object.freeze({ source, descriptor: Object.freeze({ ...descriptor }) }),
      )
    },
    selectStart(source, descriptor, occurrence) {
      assertOccurrence(occurrence)
      const existing = selectStartOccurrences.get(occurrence)
      if (existing !== undefined) return existing
      assertDescriptor(descriptor)
      const time = readTime()
      pruneExpired(time)
      const record = allocate(
        descriptor,
        descriptor.kind === 'hand'
          ? time + lifetimeMs
          : Number.POSITIVE_INFINITY,
      )
      sourceRecords.set(source, record)
      selectStartOccurrences.set(occurrence, record.identity)
      return record.identity
    },
    sceneAction(source, descriptor, occurrence) {
      assertOccurrence(occurrence)
      const existing = sceneOccurrences.get(occurrence)
      if (existing !== undefined) return existing
      assertDescriptor(descriptor)
      const time = readTime()
      pruneExpired(time)
      const identity = consume(source, descriptor, 'sceneConsumed', time)
      sceneOccurrences.set(occurrence, identity)
      return identity
    },
    selectEnd(source) {
      const time = readTime()
      pruneExpired(time)
      const current = sourceRecords.get(source)
      if (current !== undefined) current.expiresAt = time + lifetimeMs
    },
    menuAction(event) {
      if (event.type !== 'selection-intent') return undefined
      const existing = menuOccurrences.get(event)
      if (existing !== undefined) return existing
      const descriptor = event.source
      assertDescriptor(descriptor)
      const time = readTime()
      pruneExpired(time)
      const binding = menuSourceBindings.get(event.source.id)
      const identity =
        binding !== undefined &&
        sameDescriptor(binding.descriptor, descriptor)
          ? consume(binding.source, descriptor, 'menuConsumed', time)
          : allocate(descriptor, time + lifetimeMs).identity
      menuOccurrences.set(event, identity)
      return identity
    },
    removeSource(source) {
      sourceRecords.delete(source)
      for (const [sourceId, binding] of menuSourceBindings) {
        if (binding.source === source) menuSourceBindings.delete(sourceId)
      }
    },
    clear() {
      sourceRecords.clear()
      menuSourceBindings.clear()
      selectStartOccurrences = new WeakMap()
      sceneOccurrences = new WeakMap()
      menuOccurrences = new WeakMap()
    },
  })
}

/** @param {unknown} actionId */
function assertPhysicalActionId(actionId) {
  if (typeof actionId !== 'string' || actionId.length === 0) {
    throw new TypeError('Workshop physical action ID must be a non-empty string')
  }
}

/**
 * @param {unknown} position
 * @returns {asserts position is WorkshopPosition}
 */
function assertPosition(position) {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(Number.isFinite)
  ) {
    throw new TypeError('Placement Cursor position must contain three finite numbers')
  }
}

/**
 * @param {WorkshopModel} model
 * @param {string} actionId
 * @param {Partial<WorkshopModel>} changes
 * @returns {WorkshopModel}
 */
function nextModel(model, actionId, changes) {
  return freezeModel({
    ...model,
    ...changes,
    revision: model.revision + 1,
    processedPhysicalActionIds: [
      ...model.processedPhysicalActionIds,
      actionId,
    ],
  })
}

/** @param {number} coordinate */
function snapCoordinate(coordinate) {
  return Math.round(coordinate / GRID_STEP_METERS) * GRID_STEP_METERS
}

/** @param {WorkshopPrimitive} primitive */
function primitiveFootprintRadius(primitive) {
  if (primitive === 'sphere') return 0.1
  if (primitive === 'cylinder') return 0.085
  return 0.09
}

/**
 * @param {WorkshopPosition} requestedPosition
 * @param {boolean} snapToGrid
 * @returns {WorkshopPosition}
 */
function effectiveCursorPosition(requestedPosition, snapToGrid) {
  return snapToGrid
    ? [
        snapCoordinate(requestedPosition[0]),
        requestedPosition[1],
        snapCoordinate(requestedPosition[2]),
      ]
    : requestedPosition
}

/**
 * @param {readonly WorkshopObject[]} objects
 * @param {WorkshopPrimitive} primitive
 * @param {WorkshopPosition} position
 */
function overlapsWorkshopObject(objects, primitive, position) {
  const nextRadius = primitiveFootprintRadius(primitive)
  return objects.some((object) => {
    const minimumDistance =
      nextRadius +
      primitiveFootprintRadius(object.primitive) +
      WORKSHOP_CLEARANCE_METERS
    const deltaX = position[0] - object.position[0]
    const deltaZ = position[2] - object.position[2]
    return deltaX * deltaX + deltaZ * deltaZ < minimumDistance * minimumDistance
  })
}

/**
 * @param {WorkshopModel} model
 * @param {WorkshopPosition} requestedPosition
 * @param {boolean} requestedPositionObserved
 * @param {Partial<Pick<WorkshopModel, 'objects' | 'selectedPrimitive' | 'snapToGrid'>>} [changes]
 * @returns {PlacementCursor}
 */
function resolvePlacementCursor(
  model,
  requestedPosition,
  requestedPositionObserved,
  changes = {},
) {
  const objects = changes.objects ?? model.objects
  const selectedPrimitive = changes.selectedPrimitive ?? model.selectedPrimitive
  const snapToGrid = changes.snapToGrid ?? model.snapToGrid
  const position = effectiveCursorPosition(requestedPosition, snapToGrid)
  const footprintRadius = primitiveFootprintRadius(selectedPrimitive)
  const onTable =
    requestedPositionObserved &&
    Math.abs(position[0]) <= WORKSHOP_BOUNDS_METERS - footprintRadius &&
    Math.abs(position[2]) <= WORKSHOP_BOUNDS_METERS - footprintRadius
  const status = !onTable
    ? 'unavailable'
    : overlapsWorkshopObject(objects, selectedPrimitive, position)
      ? 'occupied'
      : 'valid'
  return Object.freeze({
    requestedPosition: freezePosition(requestedPosition),
    position: freezePosition(position),
    requestedPositionObserved,
    valid: status === 'valid',
    status,
  })
}

/** @param {WorkshopModel} model */
function workshopCanReset(model) {
  return (
    model.objects.length > 0 ||
    model.selectedObjectId !== null ||
    model.placementCursor.status !== 'unavailable' ||
    model.selectedPrimitive !== 'cube' ||
    model.gridVisible !== true ||
    model.snapToGrid !== true
  )
}

/**
 * Apply one physical action. Repeated delivery of the same physical action ID
 * returns the existing model even after intervening transitions. Identities
 * expire after PROCESSED_PHYSICAL_ACTION_CAPACITY later successful transitions.
 * @param {WorkshopModel} model
 * @param {WorkshopCommand} command
 * @returns {WorkshopModel}
 */
export function reduceWorkshop(model, command) {
  assertPhysicalActionId(command?.actionId)
  if (model.processedPhysicalActionIds.includes(command.actionId)) return model

  const action = command.action
  if (typeof action !== 'object' || action === null) {
    throw new TypeError('Workshop action must be an object')
  }

  switch (action.type) {
    case 'place-cursor': {
      assertPosition(action.position)
      const placementCursor = resolvePlacementCursor(
        model,
        action.position,
        action.valid === true,
      )
      if (
        model.placementCursor.status === placementCursor.status &&
        model.placementCursor.requestedPosition.every(
          (coordinate, index) =>
            coordinate === placementCursor.requestedPosition[index],
        ) &&
        model.placementCursor.position.every(
          (coordinate, index) => coordinate === placementCursor.position[index],
        )
      ) {
        return model
      }
      return nextModel(model, command.actionId, {
        placementCursor,
      })
    }

    case 'spawn': {
      if (
        !model.placementCursor.valid ||
        model.objects.length >= WORKSHOP_OBJECT_CAPACITY
      ) {
        return model
      }
      const position = model.placementCursor.position
      /** @type {WorkshopObject} */
      const object = {
        id: `workshop-object-${model.nextObjectNumber}`,
        primitive: model.selectedPrimitive,
        position,
        snapped: model.snapToGrid,
      }
      const objects = [...model.objects, object]
      return nextModel(model, command.actionId, {
        objects,
        placementCursor: resolvePlacementCursor(
          model,
          model.placementCursor.requestedPosition,
          true,
          { objects },
        ),
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
      const objects = model.objects.filter(
        (object) => object.id !== model.selectedObjectId,
      )
      return nextModel(model, command.actionId, {
        objects,
        placementCursor: resolvePlacementCursor(
          model,
          model.placementCursor.requestedPosition,
          model.placementCursor.requestedPositionObserved,
          { objects },
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
        placementCursor: resolvePlacementCursor(
          model,
          model.placementCursor.requestedPosition,
          model.placementCursor.requestedPositionObserved,
          { selectedPrimitive: action.primitive },
        ),
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
        placementCursor: resolvePlacementCursor(
          model,
          model.placementCursor.requestedPosition,
          model.placementCursor.requestedPositionObserved,
          { snapToGrid: action.enabled },
        ),
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
      if (!workshopCanReset(model)) return model
      const reset = createWorkshopModel()
      return nextModel(model, command.actionId, {
        ...reset,
        menuWrist: model.menuWrist,
      })
    }

    default:
      throw new TypeError(`Unsupported Workshop action: ${action.type}`)
  }
}

const scenarioCapacityPositions = Object.freeze([
  freezePosition([-0.75, 0, -0.5]),
  freezePosition([-0.5, 0, -0.5]),
  freezePosition([-0.25, 0, -0.5]),
  freezePosition([0, 0, -0.5]),
  freezePosition([0.25, 0, -0.5]),
  freezePosition([0.5, 0, -0.5]),
  freezePosition([-0.75, 0, -0.25]),
  freezePosition([-0.5, 0, -0.25]),
  freezePosition([-0.25, 0, -0.25]),
  freezePosition([0, 0, -0.25]),
  freezePosition([0.25, 0, -0.25]),
  freezePosition([0.5, 0, -0.25]),
])

/**
 * Create a portable scenario selected by the static Example App query string.
 * The fixture contains model data only; each Example Variant still owns its
 * renderer, scene shielding, XR source mapping, and lifecycle integration.
 * @param {string} name
 */
export function createWorkshopScenario(name) {
  if (name === 'default' || name === 'empty-definition') {
    return Object.freeze({
      name,
      model: createWorkshopModel(),
      snapshotOptions: Object.freeze({
        ...(name === 'empty-definition' ? { emptyDefinition: true } : {}),
      }),
      shieldObjectId: null,
    })
  }

  if (name === 'full-workshop') {
    let model = createWorkshopModel()
    for (const [index, position] of scenarioCapacityPositions.entries()) {
      model = reduceWorkshop(model, {
        actionId: `fixture-place-${index}`,
        action: { type: 'place-cursor', position, valid: true },
      })
      model = reduceWorkshop(model, {
        actionId: `fixture-spawn-${index}`,
        action: { type: 'spawn' },
      })
    }
    return Object.freeze({
      name,
      model,
      snapshotOptions: Object.freeze({}),
      shieldObjectId: null,
    })
  }

  if (name === 'shield') {
    let model = reduceWorkshop(createWorkshopModel(), {
      actionId: 'fixture-shield-place',
      action: { type: 'place-cursor', position: [0, 0, -0.5], valid: true },
    })
    model = reduceWorkshop(model, {
      actionId: 'fixture-shield-spawn',
      action: { type: 'spawn' },
    })
    model = reduceWorkshop(model, {
      actionId: 'fixture-shield-clear-cursor',
      action: { type: 'place-cursor', position: [0, 0, -0.5], valid: false },
    })
    return Object.freeze({
      name,
      model,
      snapshotOptions: Object.freeze({}),
      shieldObjectId: 'workshop-object-1',
    })
  }

  throw new TypeError(`Unknown Workshop scenario: ${name}`)
}

/**
 * @param {SelectionIntent} intent
 * @returns {WorkshopAction | null}
 */
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

/**
 * Apply a semantic Wrist Menu Event to the Workshop Model. A Renderer
 * Integration may supply the identity allocated at select start so another
 * delivery path for that physical action is deduplicated.
 * @param {WorkshopModel} model
 * @param {WristMenuEvent} event
 * @param {string} [physicalActionId]
 * @returns {WorkshopModel}
 */
export function reduceWorkshopMenuEvent(model, event, physicalActionId) {
  if (event.type !== 'selection-intent') return model
  const action = menuAction(event.intent)
  if (action === null) return model
  const itemId = event.intent.itemId
  return reduceWorkshop(model, {
    actionId:
      physicalActionId ??
      `menu:${event.source.id}:${event.time}:${itemId}`,
    action,
  })
}

/** Derive the complete immutable Host Snapshot for one Workshop Model revision. */
/**
 * @param {WorkshopModel} model
 * @param {WorkshopSnapshotOptions} [options]
 * @returns {HostSnapshot}
 */
export function workshopHostSnapshot(model, options = {}) {
  /** @type {Set<'left' | 'right'>} */
  const availableWrists = new Set(options.availableWrists ?? ['left', 'right'])
  for (const wrist of availableWrists) {
    if (!handednessValues.has(wrist)) {
      throw new TypeError(`Unsupported available wrist: ${wrist}`)
    }
  }
  if (options.emptyDefinition === true) {
    return Object.freeze({
      activationMode: 'automatic',
      wrist: model.menuWrist,
      menuDefinition: Object.freeze([]),
    })
  }
  const removeDisabled = model.selectedObjectId === null
  const workshopFull = model.objects.length >= WORKSHOP_OBJECT_CAPACITY
  const cursorAvailable = options.cursorAvailable ?? true
  const spawnDisabled =
    workshopFull || !cursorAvailable || !model.placementCursor.valid
  const spawnDisabledReason = workshopFull
    ? 'Workshop is full'
    : cursorAvailable && model.placementCursor.status === 'occupied'
      ? 'Choose an empty spot'
      : 'Aim at the table first'
  const resetDisabled = !workshopCanReset(model)
  /** @type {MenuDefinitionEntry[]} */
  const menuDefinition = [
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
    {
      type: 'action',
      id: 'spawn-primitive',
      label: `Spawn ${model.selectedPrimitive}`,
      iconKey: 'add',
      disabled: spawnDisabled,
      ...(spawnDisabled ? { disabledReason: spawnDisabledReason } : {}),
    },
    { type: 'separator', id: 'objects-section', label: 'Objects' },
    {
      type: 'action',
      id: 'remove-selection',
      label: 'Remove selection',
      iconKey: 'remove',
      disabled: removeDisabled,
      ...(removeDisabled
        ? { disabledReason: 'Select an object first' }
        : {}),
    },
    { type: 'separator', id: 'grid-section', label: 'Grid' },
    {
      type: 'toggle',
      id: 'snap-to-grid',
      label: 'Snap placement',
      value: model.snapToGrid,
    },
    {
      type: 'toggle',
      id: 'grid-visible',
      label: 'Show grid',
      value: model.gridVisible,
    },
    {
      type: 'action',
      id: 'reset-workshop',
      label: 'Reset workshop',
      iconKey: 'reset',
      disabled: resetDisabled,
      ...(resetDisabled ? { disabledReason: 'Workshop already empty' } : {}),
    },
    { type: 'separator', id: 'wrist-section', label: 'Menu wrist' },
    {
      type: 'choice-group',
      id: 'menu-wrist',
      label: 'Attach menu to',
      selectedValue: model.menuWrist,
      options: [
        {
          id: 'wrist-left',
          label: 'Left wrist',
          value: 'left',
          disabled: !availableWrists.has('left'),
          ...(!availableWrists.has('left')
            ? { disabledReason: 'Hand not tracked' }
            : {}),
        },
        {
          id: 'wrist-right',
          label: 'Right wrist',
          value: 'right',
          disabled: !availableWrists.has('right'),
          ...(!availableWrists.has('right')
            ? { disabledReason: 'Hand not tracked' }
            : {}),
        },
      ],
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
