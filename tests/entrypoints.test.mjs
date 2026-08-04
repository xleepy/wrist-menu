import assert from 'node:assert/strict'
import test from 'node:test'

const entries = [
  ['root', '../dist/core/index.js'],
  ['core', '../dist/core/index.js'],
  ['three', '../dist/three/index.js'],
  ['react', '../dist/react/index.js'],
]

for (const [name, relativePath] of entries) {
  test(`${name} entry point imports without browser globals`, async () => {
    const trappedGlobals = [
      'window',
      'document',
      'navigator',
      'fetch',
      'requestAnimationFrame',
      'setInterval',
      'setTimeout',
      'addEventListener',
      'removeEventListener',
      'HTMLCanvasElement',
      'OffscreenCanvas',
      'WebGLRenderingContext',
      'WebGL2RenderingContext',
      'XRSession',
      'XRSystem',
    ]
    const originalDescriptors = new Map(
      trappedGlobals.map((globalName) => [
        globalName,
        Object.getOwnPropertyDescriptor(globalThis, globalName),
      ]),
    )

    const originalEventTargetMethods = {
      addEventListener: EventTarget.prototype.addEventListener,
      removeEventListener: EventTarget.prototype.removeEventListener,
    }

    try {
      for (const globalName of trappedGlobals) {
        Object.defineProperty(globalThis, globalName, {
          configurable: true,
          get() {
            throw new Error(`read browser global: ${globalName}`)
          },
        })
      }

      EventTarget.prototype.addEventListener = () => {
        throw new Error('installed an event listener')
      }
      EventTarget.prototype.removeEventListener = () => {
        throw new Error('removed an event listener')
      }

      const entryUrl = new URL(relativePath, import.meta.url)
      entryUrl.searchParams.set('entrypoint-test', name)
      const module = await import(entryUrl.href)
      assert.ok(module)
    } finally {
      Object.assign(EventTarget.prototype, originalEventTargetMethods)

      for (const [globalName, descriptor] of originalDescriptors) {
        if (descriptor === undefined) {
          delete globalThis[globalName]
        } else {
          Object.defineProperty(globalThis, globalName, descriptor)
        }
      }
    }
  })
}
