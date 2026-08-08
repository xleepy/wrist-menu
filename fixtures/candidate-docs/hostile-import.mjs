import assert from 'node:assert/strict'

import * as three from 'three'

const entries = [
  '@xleepy/wrist-menu',
  '@xleepy/wrist-menu/core',
  '@xleepy/wrist-menu/three',
  '@xleepy/wrist-menu/react',
]
const hostileGlobalNames = [
  'OffscreenCanvas',
  'cancelAnimationFrame',
  'document',
  'HTMLCanvasElement',
  'navigator',
  'requestAnimationFrame',
  'setInterval',
  'setTimeout',
  'WebGL2RenderingContext',
  'WebGLRenderingContext',
  'window',
  'XRFrame',
  'XRHand',
  'XRSession',
  'XRSystem',
]

function allocationOrdinals() {
  const object = new three.Group()
  const geometry = new three.BufferGeometry()
  const material = new three.Material()
  const texture = new three.Texture()
  const result = {
    objects: object.id,
    geometries: geometry.id,
    materials: material.id,
    textures: texture.id,
  }
  object.clear()
  geometry.dispose()
  material.dispose()
  texture.dispose()
  return result
}

function activeResources() {
  const counts = {}
  for (const type of process.getActiveResourcesInfo?.() ?? []) {
    counts[type] = (counts[type] ?? 0) + 1
  }
  return counts
}

function descriptorChanged(before, after) {
  if (before === undefined || after === undefined) return before !== after
  return (
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.get !== after.get ||
    before.set !== after.set ||
    before.value !== after.value ||
    before.writable !== after.writable
  )
}

const originalDescriptors = new Map(
  hostileGlobalNames.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
)
const hostileDescriptors = new Map()
const hostileReads = []
const listeners = []
const subscriptions = []
let renderLoops = 0
const allocationsBefore = allocationOrdinals()
const resourcesBefore = activeResources()
const originalEventTargetAdd = EventTarget.prototype.addEventListener
const originalThreeAdd = three.EventDispatcher.prototype.addEventListener
const originalSetAnimationLoop = three.WebGLRenderer.prototype.setAnimationLoop
const originalProcessOn = process.on
const originalProcessAddListener = process.addListener

let changedGlobals
let imported
try {
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    listeners.push({ mechanism: 'EventTarget', type })
    return originalEventTargetAdd.call(this, type, listener, options)
  }
  three.EventDispatcher.prototype.addEventListener = function (type, listener) {
    listeners.push({ mechanism: 'Three.EventDispatcher', type })
    return originalThreeAdd.call(this, type, listener)
  }
  three.WebGLRenderer.prototype.setAnimationLoop = function (...args) {
    renderLoops += 1
    return originalSetAnimationLoop.apply(this, args)
  }
  process.on = function (type, listener) {
    subscriptions.push({ mechanism: 'process.on', type })
    return originalProcessOn.call(this, type, listener)
  }
  process.addListener = function (type, listener) {
    subscriptions.push({ mechanism: 'process.addListener', type })
    return originalProcessAddListener.call(this, type, listener)
  }

  for (const name of hostileGlobalNames) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        hostileReads.push(name)
        throw new Error(`candidate import touched hostile global ${name}`)
      },
    })
    hostileDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  }

  imported = new Map()
  for (const entry of entries) imported.set(entry, await import(entry))
  assert.equal(
    typeof imported.get('@xleepy/wrist-menu').createWristMenuRuntimeState,
    'function',
  )
  assert.equal(
    typeof imported.get('@xleepy/wrist-menu/three').createThreeWristMenuState,
    'function',
  )
  assert.equal(
    typeof imported.get('@xleepy/wrist-menu/react').WristMenu,
    'function',
  )
  assert.equal(
    'createWristMenuRuntime' in imported.get('@xleepy/wrist-menu/core'),
    false,
  )
  assert.equal(
    'createThreeWristMenu' in imported.get('@xleepy/wrist-menu/three'),
    false,
  )
  changedGlobals = hostileGlobalNames.filter((name) =>
    descriptorChanged(
      hostileDescriptors.get(name),
      Object.getOwnPropertyDescriptor(globalThis, name),
    ),
  )
} finally {
  EventTarget.prototype.addEventListener = originalEventTargetAdd
  three.EventDispatcher.prototype.addEventListener = originalThreeAdd
  three.WebGLRenderer.prototype.setAnimationLoop = originalSetAnimationLoop
  process.on = originalProcessOn
  process.addListener = originalProcessAddListener
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor === undefined) delete globalThis[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
}

const allocationsAfter = allocationOrdinals()
const resourcesAfter = activeResources()
const allocationGrowth = Object.fromEntries(
  Object.keys(allocationsBefore).map((name) => [
    name,
    allocationsAfter[name] - allocationsBefore[name] - 1,
  ]),
)
const resourceGrowth = Object.fromEntries(
  [...new Set([...Object.keys(resourcesBefore), ...Object.keys(resourcesAfter)])]
    .sort()
    .map((name) => [name, (resourcesAfter[name] ?? 0) - (resourcesBefore[name] ?? 0)]),
)

assert.deepEqual(hostileReads, [], 'public import read browser/XR/loop globals')
assert.deepEqual(changedGlobals, [], 'public import installed IWER/XR globals')
assert.deepEqual(listeners, [], 'public import installed event listeners')
assert.deepEqual(subscriptions, [], 'public import installed subscriptions')
assert.equal(renderLoops, 0, 'public import started a renderer loop')
assert.ok(
  Object.values(allocationGrowth).every((count) => count === 0),
  `public import constructed Three resources: ${JSON.stringify(allocationGrowth)}`,
)
assert.ok(
  Object.values(resourceGrowth).every((count) => count <= 0),
  `public import retained active resources: ${JSON.stringify(resourceGrowth)}`,
)

console.log('hostile public candidate imports passed')
