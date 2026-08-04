import {
  copyControllerWristConfiguration,
  resolveControllerWristOffset,
  resolveRevealConfiguration,
  type ActivationMode,
  type ControllerWristConfiguration,
  type RevealConfiguration,
  type RevealConfigurationOverrides,
  type Vector3Tuple,
} from './activation-config.js'

export type Handedness = 'left' | 'right'

export type MenuValue = boolean | string | number
export type ChoiceValue = Exclude<MenuValue, boolean>

type InteractiveItemFields = Readonly<{
  id: string
  label: string
  iconKey?: string
  disabled?: boolean
  disabledReason?: string
}>

export type ActionItem = InteractiveItemFields &
  Readonly<{
    type: 'action'
  }>

export type ToggleItem = InteractiveItemFields &
  Readonly<{
    type: 'toggle'
    value: boolean
  }>

export type ChoiceOption = InteractiveItemFields &
  Readonly<{
    value: ChoiceValue
  }>

export type ChoiceGroup = Readonly<{
  type: 'choice-group'
  id: string
  label: string
  selectedValue: ChoiceValue
  options: readonly ChoiceOption[]
}>

export type SeparatorItem = Readonly<{
  type: 'separator'
  id?: string
  label?: string
}>

export type MenuDefinitionEntry =
  | ActionItem
  | ToggleItem
  | ChoiceGroup
  | SeparatorItem

/** Complete Host Application-owned input supported by this implementation slice. */
export type HostSnapshot = Readonly<{
  activationMode: ActivationMode
  wrist: Handedness
  menuDefinition: readonly MenuDefinitionEntry[]
  comfort?: RevealConfigurationOverrides
  controllerWrist?: ControllerWristConfiguration
}>

export type MenuInteraction = 'idle' | 'hovered' | 'armed'

export type PresentationActionItem = Readonly<{
  type: 'action'
  id: string
  label: string
  iconKey?: string
  disabled: boolean
  disabledReason?: string
  interaction: MenuInteraction
}>

export type PresentationToggleItem = Readonly<{
  type: 'toggle'
  id: string
  label: string
  iconKey?: string
  value: boolean
  selected: boolean
  disabled: boolean
  disabledReason?: string
  interaction: MenuInteraction
}>

export type PresentationChoiceOption = Readonly<{
  type: 'choice'
  id: string
  groupId: string
  label: string
  iconKey?: string
  value: ChoiceValue
  selected: boolean
  disabled: boolean
  disabledReason?: string
  interaction: MenuInteraction
}>

export type PresentationChoiceGroup = Readonly<{
  type: 'choice-group'
  id: string
  label: string
  selectedValue: ChoiceValue
  options: readonly PresentationChoiceOption[]
}>

export type PresentationSeparatorItem = Readonly<{
  type: 'separator'
  id?: string
  label?: string
}>

export type PresentationItem =
  | PresentationActionItem
  | PresentationToggleItem
  | PresentationChoiceGroup
  | PresentationSeparatorItem

export type InteractiveMenuItem = ActionItem | ToggleItem | ChoiceOption

export type LocatedInteractiveItem = Readonly<{
  item: InteractiveMenuItem
  group?: ChoiceGroup
}>

function assertRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`)
  }
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  name: string,
) {
  const allowed = new Set(allowedKeys)
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(`${name} contains unsupported field: ${String(key)}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${name} field ${key} must be portable data`)
    }
  }
}

function requireOwn(
  record: Record<string, unknown>,
  key: string,
  name: string,
): unknown {
  if (!Object.hasOwn(record, key)) {
    throw new TypeError(`${name} is required`)
  }
  return record[key]
}

function assertPortableArray(
  value: unknown,
  name: string,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be an array`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`${name} must be a dense array`)
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue
    if (
      typeof key !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    ) {
      throw new TypeError(`${name} contains an unsupported array field`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${name} field ${key} must be portable data`)
    }
  }
}

function copyOptionalComfort(
  snapshot: Record<string, unknown>,
): RevealConfiguration | undefined {
  if (!Object.hasOwn(snapshot, 'comfort')) return undefined
  const comfort = snapshot['comfort']
  assertRecord(comfort, 'Host Snapshot comfort')
  const keys = [
    'enterAngleDegrees',
    'exitAngleDegrees',
    'initialDwellMs',
    'reacquireDwellMs',
    'visualGraceMs',
    'transitionMs',
  ] as const
  assertKnownKeys(comfort, keys, 'Host Snapshot comfort')
  const overrides: Partial<Record<(typeof keys)[number], number>> = {}
  for (const key of keys) {
    if (!Object.hasOwn(comfort, key)) continue
    const value = comfort[key]
    if (typeof value !== 'number') {
      throw new TypeError(`comfort.${key} must be a number`)
    }
    overrides[key] = value
  }
  return resolveRevealConfiguration(overrides)
}

function copyVector3(value: unknown, name: string): Vector3Tuple {
  assertPortableArray(value, name)
  const [x, y, z] = value
  if (
    value.length !== 3 ||
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof z !== 'number' ||
    !Number.isFinite(z)
  ) {
    throw new TypeError(`${name} must contain exactly three finite numbers`)
  }
  return Object.freeze([x, y, z])
}

function copyOptionalControllerWrist(
  snapshot: Record<string, unknown>,
): ControllerWristConfiguration | undefined {
  if (!Object.hasOwn(snapshot, 'controllerWrist')) return undefined
  const raw = snapshot['controllerWrist']
  assertRecord(raw, 'Host Snapshot controllerWrist')
  assertKnownKeys(
    raw,
    ['deviceTarget', 'preset', 'offsets'],
    'Host Snapshot controllerWrist',
  )

  const configuration: {
    deviceTarget?: NonNullable<ControllerWristConfiguration['deviceTarget']>
    preset?: NonNullable<ControllerWristConfiguration['preset']>
    offsets?: Partial<Record<Handedness, Readonly<{
      translationMeters: Vector3Tuple
      rotationDegrees: Vector3Tuple
    }>>>
  } = {}
  if (Object.hasOwn(raw, 'deviceTarget')) {
    configuration.deviceTarget = raw['deviceTarget'] as NonNullable<
      ControllerWristConfiguration['deviceTarget']
    >
  }
  if (Object.hasOwn(raw, 'preset')) {
    configuration.preset = raw['preset'] as NonNullable<
      ControllerWristConfiguration['preset']
    >
  }
  if (Object.hasOwn(raw, 'offsets')) {
    const rawOffsets = raw['offsets']
    assertRecord(rawOffsets, 'Host Snapshot controllerWrist.offsets')
    assertKnownKeys(
      rawOffsets,
      ['left', 'right'],
      'Host Snapshot controllerWrist.offsets',
    )
    const offsets: NonNullable<typeof configuration.offsets> = {}
    for (const handedness of ['left', 'right'] as const) {
      if (!Object.hasOwn(rawOffsets, handedness)) continue
      const rawOffset = rawOffsets[handedness]
      assertRecord(
        rawOffset,
        `Host Snapshot controllerWrist.offsets.${handedness}`,
      )
      assertKnownKeys(
        rawOffset,
        ['translationMeters', 'rotationDegrees'],
        `Host Snapshot controllerWrist.offsets.${handedness}`,
      )
      offsets[handedness] = Object.freeze({
        translationMeters: copyVector3(
          requireOwn(
            rawOffset,
            'translationMeters',
            `controllerWrist.offsets.${handedness}.translationMeters`,
          ),
          `controllerWrist.offsets.${handedness}.translationMeters`,
        ),
        rotationDegrees: copyVector3(
          requireOwn(
            rawOffset,
            'rotationDegrees',
            `controllerWrist.offsets.${handedness}.rotationDegrees`,
          ),
          `controllerWrist.offsets.${handedness}.rotationDegrees`,
        ),
      })
    }
    configuration.offsets = offsets
  }
  return copyControllerWristConfiguration(configuration)
}

function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} must be a non-empty string`)
  }
  return value
}

function copyOptionalNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  name: string,
): string | undefined {
  if (!Object.hasOwn(record, key)) return undefined
  return requireNonEmptyString(record[key], name)
}

function copyDisabledFields(
  record: Record<string, unknown>,
  name: string,
): Readonly<{ disabled?: boolean; disabledReason?: string }> {
  const disabled = Object.hasOwn(record, 'disabled')
    ? record['disabled']
    : undefined
  if (disabled !== undefined && typeof disabled !== 'boolean') {
    throw new TypeError(`${name} disabled must be a boolean`)
  }
  const disabledReason = copyOptionalNonEmptyString(
    record,
    'disabledReason',
    `${name} disabledReason`,
  )
  if (disabledReason !== undefined && disabled !== true) {
    throw new TypeError(`${name} disabledReason requires disabled: true`)
  }
  return {
    ...(disabled === undefined ? {} : { disabled }),
    ...(disabledReason === undefined ? {} : { disabledReason }),
  }
}

function copyInteractiveFields(
  record: Record<string, unknown>,
  name: string,
): InteractiveItemFields {
  const iconKey = copyOptionalNonEmptyString(record, 'iconKey', `${name} iconKey`)
  return Object.freeze({
    id: requireNonEmptyString(
      requireOwn(record, 'id', `${name} id`),
      `${name} id`,
    ),
    label: requireNonEmptyString(
      requireOwn(record, 'label', `${name} label`),
      `${name} label`,
    ),
    ...(iconKey === undefined ? {} : { iconKey }),
    ...copyDisabledFields(record, name),
  })
}

function copyChoiceValue(value: unknown, name: string): ChoiceValue {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new TypeError(`${name} must be a string or finite number`)
}

function registerId(ids: Set<string>, id: string) {
  if (ids.has(id)) throw new TypeError(`Menu item id must be unique: ${id}`)
  ids.add(id)
  return id
}

function copyAction(
  record: Record<string, unknown>,
  ids: Set<string>,
): ActionItem {
  assertKnownKeys(
    record,
    ['type', 'id', 'label', 'iconKey', 'disabled', 'disabledReason'],
    'Action Item',
  )
  const fields = copyInteractiveFields(record, 'Action Item')
  registerId(ids, fields.id)
  return Object.freeze({ type: 'action', ...fields })
}

function copyToggle(
  record: Record<string, unknown>,
  ids: Set<string>,
): ToggleItem {
  assertKnownKeys(
    record,
    ['type', 'id', 'label', 'iconKey', 'disabled', 'disabledReason', 'value'],
    'Toggle Item',
  )
  const fields = copyInteractiveFields(record, 'Toggle Item')
  registerId(ids, fields.id)
  const value = requireOwn(record, 'value', `Toggle Item ${fields.id} value`)
  if (typeof value !== 'boolean') {
    throw new TypeError(`Toggle Item ${fields.id} value must be a boolean`)
  }
  return Object.freeze({ type: 'toggle', ...fields, value })
}

function copyChoiceGroup(
  record: Record<string, unknown>,
  ids: Set<string>,
): ChoiceGroup {
  assertKnownKeys(
    record,
    ['type', 'id', 'label', 'selectedValue', 'options'],
    'Choice Group',
  )
  const id = registerId(
    ids,
    requireNonEmptyString(
      requireOwn(record, 'id', 'Choice Group id'),
      'Choice Group id',
    ),
  )
  const label = requireNonEmptyString(
    requireOwn(record, 'label', `Choice Group ${id} label`),
    `Choice Group ${id} label`,
  )
  const selectedValue = copyChoiceValue(
    requireOwn(
      record,
      'selectedValue',
      `Choice Group ${id} selectedValue`,
    ),
    `Choice Group ${id} selectedValue`,
  )
  const rawOptions = requireOwn(record, 'options', `Choice Group ${id} options`)
  assertPortableArray(rawOptions, `Choice Group ${id} options`)
  if (rawOptions.length === 0) {
    throw new TypeError(`Choice Group ${id} options must be non-empty`)
  }

  const values: ChoiceValue[] = []
  const options = rawOptions.map((option, index) => {
    const name = `Choice Group ${id} option ${index}`
    assertRecord(option, name)
    assertKnownKeys(
      option,
      ['id', 'label', 'iconKey', 'disabled', 'disabledReason', 'value'],
      name,
    )
    const fields = copyInteractiveFields(option, name)
    registerId(ids, fields.id)
    const value = copyChoiceValue(
      requireOwn(option, 'value', `${name} value`),
      `${name} value`,
    )
    if (values.some((existing) => existing === value)) {
      throw new TypeError(`Choice Group ${id} option values must be unique`)
    }
    values.push(value)
    return Object.freeze({ ...fields, value })
  })

  if (values.filter((value) => value === selectedValue).length !== 1) {
    throw new TypeError(
      `Choice Group ${id} selectedValue must match exactly one option`,
    )
  }

  return Object.freeze({
    type: 'choice-group',
    id,
    label,
    selectedValue,
    options: Object.freeze(options),
  })
}

function copySeparator(
  record: Record<string, unknown>,
  ids: Set<string>,
): SeparatorItem {
  assertKnownKeys(record, ['type', 'id', 'label'], 'Separator')
  const id = copyOptionalNonEmptyString(record, 'id', 'Separator id')
  const label = copyOptionalNonEmptyString(record, 'label', 'Separator label')
  if (id !== undefined) registerId(ids, id)
  return Object.freeze({
    type: 'separator',
    ...(id === undefined ? {} : { id }),
    ...(label === undefined ? {} : { label }),
  })
}

/** Validate and deeply copy the complete portable Host Snapshot boundary. */
export function copyHostSnapshot(snapshot: HostSnapshot): HostSnapshot {
  assertRecord(snapshot, 'Host Snapshot')
  assertKnownKeys(
    snapshot,
    [
      'activationMode',
      'wrist',
      'menuDefinition',
      'comfort',
      'controllerWrist',
    ],
    'Host Snapshot',
  )
  const activationMode = requireOwn(
    snapshot,
    'activationMode',
    'Host Snapshot activationMode',
  )
  if (
    activationMode !== 'automatic' &&
    activationMode !== 'forced-open' &&
    activationMode !== 'forced-closed' &&
    activationMode !== 'disabled'
  ) {
    throw new TypeError('Host Snapshot activationMode is not supported')
  }
  const wrist = requireOwn(snapshot, 'wrist', 'Host Snapshot wrist')
  if (wrist !== 'left' && wrist !== 'right') {
    throw new TypeError('Host Snapshot wrist must be "left" or "right"')
  }
  const rawMenuDefinition = requireOwn(
    snapshot,
    'menuDefinition',
    'Host Snapshot menuDefinition',
  )
  assertPortableArray(rawMenuDefinition, 'Menu Definition')
  const comfort = copyOptionalComfort(snapshot)
  const controllerWrist = copyOptionalControllerWrist(snapshot)

  const ids = new Set<string>()
  const menuDefinition = rawMenuDefinition.map((entry, index) => {
    const name = `Menu Definition entry ${index}`
    assertRecord(entry, name)
    const type = requireOwn(entry, 'type', `${name} type`)
    switch (type) {
      case 'action':
        return copyAction(entry, ids)
      case 'toggle':
        return copyToggle(entry, ids)
      case 'choice-group':
        return copyChoiceGroup(entry, ids)
      case 'separator':
        return copySeparator(entry, ids)
      default:
        throw new TypeError(`${name} has an unsupported type`)
    }
  })

  return Object.freeze({
    activationMode,
    wrist,
    menuDefinition: Object.freeze(menuDefinition),
    ...(comfort === undefined ? {} : { comfort }),
    ...(controllerWrist === undefined ? {} : { controllerWrist }),
  })
}

/** Compare only resolved settings that require a fresh wrist acquisition. */
export function anchoringSettingsEqual(
  left: HostSnapshot,
  right: HostSnapshot,
): boolean {
  if (left.wrist !== right.wrist) return false
  const leftComfort = resolveRevealConfiguration(left.comfort)
  const rightComfort = resolveRevealConfiguration(right.comfort)
  if (
    Object.keys(leftComfort).some(
      (key) =>
        leftComfort[key as keyof RevealConfiguration] !==
        rightComfort[key as keyof RevealConfiguration],
    )
  ) {
    return false
  }
  return (['left', 'right'] as const).every((handedness) => {
    const leftOffset = resolveControllerWristOffset(
      left.controllerWrist,
      handedness,
    )
    const rightOffset = resolveControllerWristOffset(
      right.controllerWrist,
      handedness,
    )
    return (
      leftOffset.translationMeters.every(
        (value, index) => value === rightOffset.translationMeters[index],
      ) &&
      leftOffset.rotationDegrees.every(
        (value, index) => value === rightOffset.rotationDegrees[index],
      )
    )
  })
}

export function findInteractiveItem(
  menuDefinition: readonly MenuDefinitionEntry[],
  itemId: string,
): LocatedInteractiveItem | undefined {
  for (const entry of menuDefinition) {
    if (entry.type === 'action' || entry.type === 'toggle') {
      if (entry.id === itemId) return Object.freeze({ item: entry })
    } else if (entry.type === 'choice-group') {
      const option = entry.options.find(({ id }) => id === itemId)
      if (option !== undefined) {
        return Object.freeze({ item: option, group: entry })
      }
    }
  }
  return undefined
}

export function createPresentationItems(
  menuDefinition: readonly MenuDefinitionEntry[],
  interactionFor: (itemId: string) => MenuInteraction,
): readonly PresentationItem[] {
  return Object.freeze(
    menuDefinition.map((entry): PresentationItem => {
      if (entry.type === 'separator') return entry
      if (entry.type === 'choice-group') {
        return Object.freeze({
          type: 'choice-group',
          id: entry.id,
          label: entry.label,
          selectedValue: entry.selectedValue,
          options: Object.freeze(
            entry.options.map((option) =>
              Object.freeze({
                type: 'choice',
                ...option,
                groupId: entry.id,
                selected: option.value === entry.selectedValue,
                disabled: option.disabled ?? false,
                interaction: interactionFor(option.id),
              }),
            ),
          ),
        })
      }
      if (entry.type === 'toggle') {
        return Object.freeze({
          ...entry,
          selected: entry.value,
          disabled: entry.disabled ?? false,
          interaction: interactionFor(entry.id),
        })
      }
      return Object.freeze({
        ...entry,
        disabled: entry.disabled ?? false,
        interaction: interactionFor(entry.id),
      })
    }),
  )
}
