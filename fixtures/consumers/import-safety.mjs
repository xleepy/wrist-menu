import assert from 'node:assert/strict'

import { writeLaneReport } from './evidence-report.mjs'
import {
  allocationDelta,
  sampleThreeAllocationOrdinals,
} from './runtime-evidence.mjs'

const hostileGlobalNames = Object.freeze([
  'OffscreenCanvas',
  'cancelAnimationFrame',
  'document',
  'navigator',
  'requestAnimationFrame',
  'window',
  'WebGL2RenderingContext',
  'WebGLRenderingContext',
  'XRFrame',
  'XRHand',
  'XRSession',
  'XRSystem',
])

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

function activeResourceInventory() {
  const byType = {}
  for (const type of process.getActiveResourcesInfo?.() ?? []) {
    byType[type] = (byType[type] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(byType).sort(([left], [right]) =>
    left.localeCompare(right),
  ))
}

function resourceGrowth(before, after) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .map((type) => [type, (after[type] ?? 0) - (before[type] ?? 0)]),
  )
}

export async function verifyImportSafety({
  entries,
  reportFile,
  three,
  importEntry = (entry) => import(entry),
  validate,
  throwOnFailure = true,
}) {
  assert.ok(three, 'import safety requires the exact consumer Three namespace')
  const descriptors = new Map(
    hostileGlobalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  )
  const hostileGlobalReads = []
  const hostileDescriptors = new Map()
  const listeners = []
  const importedEntries = new Map()
  const importErrors = []
  const originalAddEventListener = globalThis.EventTarget?.prototype.addEventListener
  const originalThreeAddEventListener =
    three.EventDispatcher?.prototype.addEventListener
  const allocationsBefore = sampleThreeAllocationOrdinals(three)
  const activeResourcesBefore = activeResourceInventory()

  try {
    if (originalAddEventListener !== undefined) {
      globalThis.EventTarget.prototype.addEventListener = function (type, listener, options) {
        listeners.push({
          mechanism: 'event-target',
          target: this.constructor?.name ?? 'EventTarget',
          type,
        })
        return originalAddEventListener.call(this, type, listener, options)
      }
    }
    if (originalThreeAddEventListener !== undefined) {
      three.EventDispatcher.prototype.addEventListener = function (type, listener) {
        listeners.push({
          mechanism: 'three-event-dispatcher',
          target: this.constructor?.name ?? 'EventDispatcher',
          type,
        })
        return originalThreeAddEventListener.call(this, type, listener)
      }
    }

    for (const name of hostileGlobalNames) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          hostileGlobalReads.push(name)
          throw new Error(`import touched hostile global ${name}`)
        },
      })
      hostileDescriptors.set(
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      )
    }

    for (const entry of entries) {
      try {
        const imported = await importEntry(entry)
        assert.ok(Object.keys(imported).length > 0, `${entry} exported no API`)
        importedEntries.set(entry, imported)
      } catch (error) {
        importErrors.push({ entry, message: error.message })
      }
    }
    if (importErrors.length === 0 && validate !== undefined) {
      try {
        await validate(importedEntries)
      } catch (error) {
        importErrors.push({ entry: 'post-import-validation', message: error.message })
      }
    }
  } finally {
    if (originalAddEventListener !== undefined) {
      globalThis.EventTarget.prototype.addEventListener = originalAddEventListener
    }
    if (originalThreeAddEventListener !== undefined) {
      three.EventDispatcher.prototype.addEventListener =
        originalThreeAddEventListener
    }
  }

  const changedGlobals = hostileGlobalNames.filter((name) =>
    descriptorChanged(
      hostileDescriptors.get(name),
      Object.getOwnPropertyDescriptor(globalThis, name),
    ),
  )
  for (const [name, descriptor] of descriptors) {
    if (descriptor === undefined) delete globalThis[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }

  const allocationsAfter = sampleThreeAllocationOrdinals(three)
  const activeResourcesAfter = activeResourceInventory()
  const threeResourceAllocations = allocationDelta(
    allocationsBefore,
    allocationsAfter,
  )
  const activeResourceGrowth = resourceGrowth(
    activeResourcesBefore,
    activeResourcesAfter,
  )
  const positiveActiveResourceGrowth = Object.values(activeResourceGrowth)
    .filter((count) => count > 0)
    .reduce((total, count) => total + count, 0)
  const forbiddenEffectCounters = {
    rendererAndThreeResources: Object.values(threeResourceAllocations).reduce(
      (total, count) => total + count,
      0,
    ),
    listenersAndSubscriptions: listeners.length + positiveActiveResourceGrowth,
    iwerOrXrInstallation: changedGlobals.length,
    xrSessionRequestsOrEnds: hostileGlobalReads.filter(
      (name) => name === 'navigator' || name === 'XRSession' || name === 'XRSystem',
    ).length,
    renderLoops: hostileGlobalReads.filter(
      (name) => name === 'requestAnimationFrame',
    ).length,
  }
  const sideEffectFree =
    hostileGlobalReads.length === 0 &&
    changedGlobals.length === 0 &&
    listeners.length === 0 &&
    Object.values(threeResourceAllocations).every((count) => count === 0) &&
    Object.values(activeResourceGrowth).every((count) => count <= 0) &&
    importErrors.length === 0
  const report = {
    candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
    gate: 'import-safety',
    status: sideEffectFree ? 'passed' : 'failed',
    entries,
    instrumentation: {
      hostileGlobals: hostileGlobalNames,
      threeAllocationOrdinals: ['objects', 'geometries', 'materials', 'textures'],
      eventTargetListeners: true,
      threeEventDispatcherListeners: true,
      activeNodeResources: true,
      forbiddenEffects: {
        rendererAndThreeResources: [
          'Three allocation ordinals',
          'document/window/OffscreenCanvas/WebGL global access',
        ],
        listenersAndSubscriptions: [
          'EventTarget.addEventListener',
          'Three.EventDispatcher.addEventListener',
          'positive Node active-resource growth',
        ],
        iwerOrXrInstallation: ['hostile XR/global descriptor replacement'],
        xrSessionRequestsOrEnds: ['navigator/XRSession/XRSystem access'],
        renderLoops: ['requestAnimationFrame access'],
      },
    },
    sideEffects: {
      hostileGlobalReads,
      changedGlobals,
      threeResourceAllocations,
      listeners: {
        added: listeners.length,
        observations: listeners,
      },
      activeResourceGrowth,
      forbiddenEffectCounters,
    },
    importErrors,
  }
  await writeLaneReport(reportFile, report)
  if (!sideEffectFree && throwOnFailure) {
    throw new Error(`candidate public import safety failed: ${JSON.stringify(report.sideEffects)}`)
  }
  return report
}
