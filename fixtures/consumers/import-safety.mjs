import assert from 'node:assert/strict'

import { writeLaneReport } from './evidence-report.mjs'

export async function verifyImportSafety({ entries, reportFile }) {
  const hostileGlobals = [
    'document',
    'navigator',
    'requestAnimationFrame',
    'window',
    'XRFrame',
    'XRHand',
    'XRSession',
  ]
  const descriptors = new Map(
    hostileGlobals.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  )
  const touched = []

  try {
    for (const name of hostileGlobals) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name)
          throw new Error(`import touched hostile global ${name}`)
        },
      })
    }

    for (const entry of entries) {
      const imported = await import(entry)
      assert.ok(Object.keys(imported).length > 0, `${entry} exported no API`)
    }
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor === undefined) delete globalThis[name]
      else Object.defineProperty(globalThis, name, descriptor)
    }
  }

  assert.deepEqual(touched, [])
  await writeLaneReport(reportFile, {
    candidateSha256: process.env.WRIST_MENU_CANDIDATE_SHA256,
    gate: 'import-safety',
    status: 'passed',
    entries,
    hostileGlobals,
    touched,
  })
}
