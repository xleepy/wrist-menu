function materialList(material) {
  if (material === undefined) return []
  return Array.isArray(material) ? material : [material]
}

function collectMaterialTextures(material, textures) {
  for (const value of Object.values(material)) {
    if (value?.isTexture === true) textures.add(value)
  }
  for (const uniform of Object.values(material.uniforms ?? {})) {
    const value = uniform?.value
    if (value?.isTexture === true) textures.add(value)
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry?.isTexture === true) textures.add(entry)
      }
    }
  }
}

export function inventoryThreeScene(root) {
  const objects = new Set()
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  const poolSlots = new Set()
  const programSignatures = new Set()
  let lines = 0

  root.traverse((object) => {
    objects.add(object)
    if (object.isLine === true) lines += 1
    if (object.geometry !== undefined) geometries.add(object.geometry)
    for (const material of materialList(object.material)) {
      materials.add(material)
      collectMaterialTextures(material, textures)
      programSignatures.add(
        `${material.type}:${material.customProgramCacheKey()}`,
      )
    }
    if (object.userData?.wristMenuItemId !== undefined) poolSlots.add(object)
  })

  return {
    identities: {
      objects,
      geometries,
      materials,
      textures,
      poolSlots,
      programSignatures,
    },
    counts: {
      objects: objects.size,
      geometries: geometries.size,
      materials: materials.size,
      textures: textures.size,
      poolSlots: poolSlots.size,
      lines,
      programSignatures: programSignatures.size,
      textureUploadVersions: [...textures].reduce(
        (total, texture) => total + texture.version,
        0,
      ),
      textureBytes: [...textures].reduce((total, texture) => {
        const image = texture.image
        if (ArrayBuffer.isView(image?.data)) return total + image.data.byteLength
        const width = Number.isFinite(image?.width) ? image.width : 0
        const height = Number.isFinite(image?.height) ? image.height : 0
        const depth = Number.isFinite(image?.depth) ? image.depth : 1
        return total + width * height * depth * 4
      }, 0),
    },
  }
}

export function sampleThreeAllocationOrdinals(three) {
  const object = new three.Group()
  const geometry = new three.BufferGeometry()
  const material = new three.Material()
  const texture = new three.Texture()
  const ordinals = {
    objects: object.id,
    geometries: geometry.id,
    materials: material.id,
    textures: texture.id,
  }
  object.clear()
  geometry.dispose()
  material.dispose()
  texture.dispose()
  return ordinals
}

export function allocationDelta(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((name) => [name, after[name] - before[name] - 1]),
  )
}

export function listenerInventory(source) {
  const byType = Object.fromEntries(
    [...(source?.listeners ?? new Map()).entries()]
      .map(([type, listeners]) => [type, listeners.size])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  return {
    total: Object.values(byType).reduce((total, count) => total + count, 0),
    byType,
  }
}

export function identityGrowth(before, after) {
  return Object.fromEntries(
    Object.keys(before.identities).map((name) => {
      const beforeSet = before.identities[name]
      const afterSet = after.identities[name]
      const added = [...afterSet].filter((value) => !beforeSet.has(value)).length
      const removed = [...beforeSet].filter((value) => !afterSet.has(value)).length
      return [name, { added, removed, net: afterSet.size - beforeSet.size }]
    }),
  )
}
