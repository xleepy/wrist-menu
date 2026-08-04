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
  activationMode: 'forced-open'
  wrist: Handedness
  menuDefinition: readonly MenuDefinitionEntry[]
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
  const unknown = Object.keys(record).find((key) => !allowed.has(key))
  if (unknown !== undefined) {
    throw new TypeError(`${name} contains unsupported field: ${unknown}`)
  }
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
  if (!(key in record)) return undefined
  return requireNonEmptyString(record[key], name)
}

function copyDisabledFields(
  record: Record<string, unknown>,
  name: string,
): Readonly<{ disabled?: boolean; disabledReason?: string }> {
  const disabled = record['disabled']
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
    id: requireNonEmptyString(record['id'], `${name} id`),
    label: requireNonEmptyString(record['label'], `${name} label`),
    ...(iconKey === undefined ? {} : { iconKey }),
    ...copyDisabledFields(record, name),
  })
}

function copyChoiceValue(value: unknown, name: string): ChoiceValue {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new TypeError(`${name} must be a string or finite number`)
}

function registerId(ids: Set<string>, id: string, name: string) {
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
  registerId(ids, fields.id, 'Action Item')
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
  registerId(ids, fields.id, 'Toggle Item')
  if (typeof record['value'] !== 'boolean') {
    throw new TypeError(`Toggle Item ${fields.id} value must be a boolean`)
  }
  return Object.freeze({ type: 'toggle', ...fields, value: record['value'] })
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
    requireNonEmptyString(record['id'], 'Choice Group id'),
    'Choice Group',
  )
  const label = requireNonEmptyString(record['label'], `Choice Group ${id} label`)
  const selectedValue = copyChoiceValue(
    record['selectedValue'],
    `Choice Group ${id} selectedValue`,
  )
  if (!Array.isArray(record['options']) || record['options'].length === 0) {
    throw new TypeError(`Choice Group ${id} options must be a non-empty array`)
  }

  const values: ChoiceValue[] = []
  const options = record['options'].map((option, index) => {
    const name = `Choice Group ${id} option ${index}`
    assertRecord(option, name)
    assertKnownKeys(
      option,
      ['id', 'label', 'iconKey', 'disabled', 'disabledReason', 'value'],
      name,
    )
    const fields = copyInteractiveFields(option, name)
    registerId(ids, fields.id, name)
    const value = copyChoiceValue(option['value'], `${name} value`)
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
  if (id !== undefined) registerId(ids, id, 'Separator')
  return Object.freeze({
    type: 'separator',
    ...(id === undefined ? {} : { id }),
    ...(label === undefined ? {} : { label }),
  })
}

/** Validate and deeply copy the v1 content portion of a Host Snapshot. */
export function copyHostSnapshot(snapshot: HostSnapshot): HostSnapshot {
  assertRecord(snapshot, 'Host Snapshot')
  if (snapshot['activationMode'] !== 'forced-open') {
    throw new TypeError('Host Snapshot activationMode must be "forced-open"')
  }
  if (snapshot['wrist'] !== 'left' && snapshot['wrist'] !== 'right') {
    throw new TypeError('Host Snapshot wrist must be "left" or "right"')
  }
  if (!Array.isArray(snapshot['menuDefinition'])) {
    throw new TypeError('Host Snapshot menuDefinition must be an array')
  }

  const ids = new Set<string>()
  const menuDefinition = snapshot['menuDefinition'].map((entry, index) => {
    const name = `Menu Definition entry ${index}`
    assertRecord(entry, name)
    switch (entry['type']) {
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
    activationMode: 'forced-open',
    wrist: snapshot['wrist'],
    menuDefinition: Object.freeze(menuDefinition),
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
