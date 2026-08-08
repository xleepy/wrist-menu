import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const exampleRoot = new URL('../examples/primitive-workshop/', import.meta.url)

async function text(relativePath) {
  return readFile(new URL(relativePath, exampleRoot), 'utf8')
}

function selectionIntentEvent(source) {
  return {
    type: 'selection-intent',
    intent: { type: 'action', itemId: 'spawn-primitive' },
    source,
    menuWrist: 'left',
    time: 100,
  }
}

const variantPhysicalActionFactories = [
  [
    'vanilla',
    () => import('../examples/primitive-workshop/vanilla/physical-actions.js'),
  ],
  [
    'react',
    () => import('../examples/primitive-workshop/react/physical-actions.js'),
  ],
]

test('both Example Variants consume the packed public package exports', async () => {
  const [manifestText, vanillaSource, reactSource] = await Promise.all([
    text('package.json'),
    text('vanilla/main.ts'),
    text('react/main.tsx'),
  ])
  const manifest = JSON.parse(manifestText)

  assert.equal(
    manifest.dependencies['@xleepy/wrist-menu'],
    'file:../../artifacts/xleepy-wrist-menu-0.0.0.tgz',
  )
  assert.match(vanillaSource, /from ['"]@xleepy\/wrist-menu\/three['"]/)
  assert.match(reactSource, /from ['"]@xleepy\/wrist-menu\/react['"]/)
  assert.doesNotMatch(`${vanillaSource}\n${reactSource}`, /(?:\.\.\/)+src\//)
  assert.equal(typeof manifest.scripts['build:vanilla'], 'string')
  assert.equal(typeof manifest.scripts['build:react'], 'string')
  assert.match(manifest.scripts.build, /build:vanilla/)
  assert.match(manifest.scripts.build, /build:react/)
})

for (const [variant, loadModule] of variantPhysicalActionFactories) {
  test(`${variant} keeps overlapping XR input sources independent`, async () => {
    let now = 10
    const module = await loadModule()
    const physicalActions = module.createPhysicalActions({
      lifetimeMs: 25,
      now: () => now,
    })
    const firstSource = {}
    const secondSource = {}
    const firstDescriptor = { kind: 'controller', handedness: 'left' }
    const secondDescriptor = { kind: 'controller', handedness: 'right' }
    const first = physicalActions.selectStart(firstSource, firstDescriptor)
    const second = physicalActions.selectStart(secondSource, secondDescriptor)

    physicalActions.selectEnd(firstSource)
    now += 26

    assert.equal(
      physicalActions.sceneAction(secondSource, secondDescriptor),
      second,
    )
    assert.notEqual(
      physicalActions.sceneAction(firstSource, firstDescriptor),
      first,
    )
  })

  test(`${variant} shares controller identities across menu and scene paths`, async () => {
    const module = await loadModule()
    const physicalActions = module.createPhysicalActions()
    const source = {}
    const descriptor = { kind: 'controller', handedness: 'right' }
    const started = physicalActions.selectStart(source, descriptor)
    const menu = physicalActions.menuAction(
      selectionIntentEvent({
        id: 'right-controller',
        kind: 'controller',
        handedness: 'right',
      }),
    )

    assert.equal(menu, started)
    assert.equal(physicalActions.sceneAction(source, descriptor), started)
  })

  test(`${variant} expires direct-hand identities without XR selectend`, async () => {
    let now = 500
    const module = await loadModule()
    const physicalActions = module.createPhysicalActions({
      lifetimeMs: 30,
      now: () => now,
    })
    const handEvent = selectionIntentEvent({
      id: 'right-hand',
      kind: 'hand',
      handedness: 'right',
    })
    const first = physicalActions.menuAction(handEvent)
    const sceneSource = {}

    assert.equal(physicalActions.menuAction(handEvent), first)
    assert.equal(
      physicalActions.sceneAction(sceneSource, {
        kind: 'hand',
        handedness: 'right',
      }),
      first,
    )

    now += 31
    const laterScene = physicalActions.sceneAction(sceneSource, {
      kind: 'hand',
      handedness: 'right',
    })
    assert.notEqual(laterScene, first)
    assert.equal(physicalActions.menuAction(handEvent), laterScene)
  })
}

test('the local link and unlink workflow preserves packed-export consumption', async () => {
  const rootManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  )
  const workflow = await readFile(
    new URL('../scripts/examples-local-package.mjs', import.meta.url),
    'utf8',
  )

  assert.match(rootManifest.scripts['examples:link'], / link$/)
  assert.match(rootManifest.scripts['examples:unlink'], / unlink$/)
  assert.match(workflow, /xleepy-wrist-menu-0\.0\.0\.tgz/)
  assert.doesNotMatch(workflow, /npm[^\n]*\blink\b/)
})

test('the shared Workshop Model has no renderer coupling', async () => {
  const source = await text('shared/workshop-model.js')

  assert.doesNotMatch(source, /(?:from|import\()[^\n]*(?:three|react)/i)
  assert.doesNotMatch(source, /\b(?:window|document|navigator|XRSession)\b/)
})

test('strict checkJs validates the Workshop Model runtime as its type source', async () => {
  const config = JSON.parse(await text('tsconfig.json'))

  assert.equal(config.compilerOptions.allowJs, true)
  assert.equal(config.compilerOptions.checkJs, true)
  assert.ok(config.include.includes('shared/**/*.js'))
  await assert.rejects(text('shared/workshop-model.d.ts'), { code: 'ENOENT' })
})

test('the canonical Example App definition reflects its maintained repository location', async () => {
  const context = await readFile(new URL('../CONTEXT.md', import.meta.url), 'utf8')

  assert.match(
    context,
    /\*\*Example App\*\*:[\s\S]*under `examples\/` in this repository/,
  )
  assert.doesNotMatch(
    context,
    /\*\*Example App\*\*:[\s\S]*A separate repository/,
  )
})
