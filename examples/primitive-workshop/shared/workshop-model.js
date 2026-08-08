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
 *   placementCursor: Readonly<{position: WorkshopPosition, valid: boolean}>,
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
 * }} PhysicalActionRecord
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
 *   selectStart(source: object, descriptor: PhysicalActionDescriptor): string,
 *   sceneAction(source: object, descriptor: PhysicalActionDescriptor): string,
 *   selectEnd(source: object): void,
 *   menuAction(event: WristMenuEvent): string | undefined,
 *   removeSource(source: object): void,
 *   clear(): void,
 * }>} PhysicalActionCoordinator
 */

export const WORKSHOP_BOUNDS_METERS = 1
export const GRID_STEP_METERS = 0.25
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
      position: freezePosition(model.placementCursor.position),
      valid: model.placementCursor.valid,
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
    placementCursor: { position: [0, 0, -0.5], valid: true },
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
 * keyed by XRInputSource object identity, while semantic menu-only activity is
 * bounded by a short correlation lifetime. Hand activity is bounded even if a
 * runtime omits selectend.
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
  /** @type {Map<string, PhysicalActionRecord>} */
  const menuRecords = new Map()

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
    for (const [key, record] of menuRecords) {
      if (record.expiresAt <= time) menuRecords.delete(key)
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

  return Object.freeze({
    selectStart(source, descriptor) {
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
      return record.identity
    },
    sceneAction(source, descriptor) {
      assertDescriptor(descriptor)
      const time = readTime()
      pruneExpired(time)
      const current = sourceRecords.get(source)
      if (
        current !== undefined &&
        sameDescriptor(current.descriptor, descriptor)
      ) {
        return current.identity
      }
      const matchingMenuRecords = [...menuRecords.values()].filter((record) =>
        sameDescriptor(record.descriptor, descriptor),
      )
      if (matchingMenuRecords.length === 1) {
        const matchingMenuRecord = matchingMenuRecords[0]
        sourceRecords.set(source, matchingMenuRecord)
        return matchingMenuRecord.identity
      }
      const record = allocate(descriptor, time + lifetimeMs)
      sourceRecords.set(source, record)
      return record.identity
    },
    selectEnd(source) {
      const time = readTime()
      pruneExpired(time)
      const current = sourceRecords.get(source)
      if (current !== undefined) current.expiresAt = time + lifetimeMs
    },
    menuAction(event) {
      if (event.type !== 'selection-intent') return undefined
      const descriptor = event.source
      assertDescriptor(descriptor)
      const time = readTime()
      pruneExpired(time)
      const matchingSources = [...sourceRecords.values()].filter((record) =>
        sameDescriptor(record.descriptor, descriptor),
      )
      if (matchingSources.length === 1) return matchingSources[0].identity

      const menuKey = `${descriptor.kind}:${descriptor.handedness}:${event.source.id}`
      const current = menuRecords.get(menuKey)
      if (current !== undefined) return current.identity
      const record = allocate(descriptor, time + lifetimeMs)
      menuRecords.set(menuKey, record)
      return record.identity
    },
    removeSource(source) {
      sourceRecords.delete(source)
    },
    clear() {
      sourceRecords.clear()
      menuRecords.clear()
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
      /** @type {WorkshopPosition} */
      const position = model.snapToGrid
        ? [snapCoordinate(x), y, snapCoordinate(z)]
        : [x, y, z]
      /** @type {WorkshopObject} */
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
      return nextModel(model, command.actionId, {
        ...reset,
      })
    }

    default:
      throw new TypeError(`Unsupported Workshop action: ${action.type}`)
  }
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
 * @returns {HostSnapshot}
 */
export function workshopHostSnapshot(model) {
  const removeDisabled = model.selectedObjectId === null
  const spawnDisabled = !model.placementCursor.valid
  /** @type {MenuDefinitionEntry[]} */
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
