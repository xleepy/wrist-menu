export const completeSnapshot = {
  activationMode: 'forced-open',
  wrist: 'right',
  menuDefinition: [
    { type: 'action', id: 'reset', label: 'Reset' },
    { type: 'separator', label: 'Scene' },
    { type: 'toggle', id: 'grid', label: 'Grid', value: true },
    {
      type: 'choice-group',
      id: 'shape',
      label: 'Shape',
      selectedValue: 1,
      options: [
        { id: 'cube', label: 'Cube', value: 1 },
        { id: 'sphere', label: 'Sphere', value: 2 },
      ],
    },
  ],
} as const
