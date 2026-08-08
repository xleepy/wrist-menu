import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'

const ROW_HEIGHT = 0.02
const ROW_SPACING = 0.0225
const HIT_DEPTH = 0.008

function presentationRows(items) {
  return items.flatMap((item) => {
    if (item.type === 'choice-group') {
      return [
        { itemId: null },
        ...item.options.map((option) => ({ itemId: option.id })),
      ]
    }
    if (item.type === 'separator') return [{ itemId: null }]
    return [{ itemId: item.id }]
  })
}

export function createEquivalentPresentationFactory(log = {}) {
  log.factoryModels ??= []
  log.updateModels ??= []
  log.disposals ??= 0

  return function equivalentPresentationFactory(...args) {
    if (args.length !== 1) {
      throw new Error('Presentation Factory must receive exactly one model')
    }
    const [initialModel] = args
    log.factoryModels.push(initialModel)

    const root = new Group()
    root.name = `custom-presentation-${log.name ?? 'fixture'}`
    const viewportGeometry = new BoxGeometry(1, 1, 0.004)
    const viewportMaterial = new MeshBasicMaterial({ visible: false })
    const viewport = new Mesh(viewportGeometry, viewportMaterial)
    viewport.position.z = -0.004
    root.add(viewport)
    const hitRegions = new Map()
    let disposed = false

    function ensureHitRegion(itemId) {
      let region = hitRegions.get(itemId)
      if (region !== undefined) return region
      const geometry = new BoxGeometry(1, ROW_HEIGHT, HIT_DEPTH)
      const material = new MeshBasicMaterial({ visible: false })
      const object = new Mesh(geometry, material)
      object.position.z = HIT_DEPTH
      root.add(object)
      region = { geometry, material, object }
      hitRegions.set(itemId, region)
      return region
    }

    return {
      root,
      get hitRegions() {
        return [...hitRegions.entries()]
          .filter(([, { object }]) => object.visible)
          .map(([itemId, { object }]) => ({ itemId, object }))
      },
      menuViewport: { object: viewport },
      update(model) {
        log.updateModels.push(model)
        root.visible = model.visible
        viewport.scale.set(
          model.theme.panelWidthMeters,
          model.theme.viewportHeightMeters,
          1,
        )
        for (const { object } of hitRegions.values()) object.visible = false

        const rows = presentationRows(model.items)
        const startRow = Math.floor(model.scrollOffset)
        const fractionalOffset = model.scrollOffset - startRow
        const visibleCount = Math.min(rows.length, model.visibleSlots)
        const viewportHalfHeight = model.theme.viewportHeightMeters / 2
        for (
          let rowIndex = startRow;
          rowIndex < rows.length && rowIndex <= startRow + model.visibleSlots;
          rowIndex += 1
        ) {
          const row = rows[rowIndex]
          if (row.itemId === null) continue
          const slotIndex = rowIndex - startRow
          const y =
            (visibleCount - 1) * (ROW_SPACING / 2) -
            slotIndex * ROW_SPACING +
            fractionalOffset * ROW_SPACING
          if (Math.abs(y) + ROW_HEIGHT / 2 > viewportHalfHeight) continue
          const region = ensureHitRegion(row.itemId)
          region.object.visible = model.visible
          region.object.position.y = y
          region.object.scale.x = model.theme.panelWidthMeters - 0.016
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        log.disposals += 1
        viewportGeometry.dispose()
        viewportMaterial.dispose()
        for (const { geometry, material } of hitRegions.values()) {
          geometry.dispose()
          material.dispose()
        }
        root.clear()
      },
    }
  }
}
