const definition = [
  { id: "spawn-cube", type: "action", label: "Spawn cube", secondary: "Place at cursor", icon: "plus" },
  { id: "spawn-sphere", type: "action", label: "Spawn sphere", secondary: "Place at cursor", icon: "sphere" },
  { id: "shape-cube", type: "choice", group: "shape", selected: true, label: "Cube tool", secondary: "Current primitive", icon: "cube" },
  { id: "shape-cylinder", type: "choice", group: "shape", selected: false, label: "Cylinder tool", secondary: "Select primitive", icon: "cylinder" },
  { id: "placement-separator", type: "separator", label: "PLACEMENT" },
  { id: "snap-grid", type: "toggle", value: true, label: "Snap grid", secondary: "10 cm increments", icon: "grid" },
  { id: "surface-align", type: "toggle", value: false, label: "Surface align", secondary: "Match table normal", icon: "align" },
  { id: "duplicate", type: "action", label: "Duplicate selected", secondary: "Offset by one grid cell", icon: "duplicate" },
  { id: "selection-separator", type: "separator", label: "SELECTION" },
  { id: "select-next", type: "action", label: "Select next", secondary: "Cycle workshop objects", icon: "next" },
  { id: "clear-selection", type: "action", disabled: true, label: "Clear selection", secondary: "No object selected", icon: "clear" },
  { id: "appearance-separator", type: "separator", label: "APPEARANCE" },
  { id: "material-matte", type: "choice", group: "material", selected: true, label: "Matte material", secondary: "Low reflection", icon: "matte" },
  { id: "material-gloss", type: "choice", group: "material", selected: false, label: "Gloss material", secondary: "High reflection", icon: "gloss" },
  { id: "comfort", type: "toggle", value: false, label: "Comfort outline", secondary: "Boost edge contrast", icon: "comfort" },
  { id: "world-separator", type: "separator", label: "WORKSHOP" },
  { id: "grid-visible", type: "toggle", value: true, label: "Grid visible", secondary: "Host-owned value", icon: "grid" },
  { id: "remove-selected", type: "action", disabled: true, label: "Remove selected", secondary: "Selection required", icon: "remove" },
  { id: "reset-world", type: "action", label: "Reset workshop", secondary: "Restore initial scene", icon: "reset" },
];

export function createMenuDefinition() {
  return definition.map((item) => ({ ...item }));
}

export function applySelectionIntent(items, itemId) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item || item.disabled || item.type === "separator") return items;

  if (item.type === "toggle") {
    return items.map((candidate) => candidate.id === itemId ? { ...candidate, value: !candidate.value } : candidate);
  }

  if (item.type === "choice") {
    return items.map((candidate) => candidate.group === item.group ? { ...candidate, selected: candidate.id === itemId } : candidate);
  }

  return items;
}
