import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const exampleRoot = new URL('../examples/primitive-workshop/', import.meta.url)

async function text(relativePath) {
  return readFile(new URL(relativePath, exampleRoot), 'utf8')
}

function selectionIntentEvent(
  id,
  { kind = 'hand', handedness = 'right', time = 100 } = {},
) {
  return {
    type: 'selection-intent',
    intent: { type: 'action', itemId: 'spawn-primitive' },
    source: { id, kind, handedness },
    menuWrist: 'left',
    time,
  }
}

class FakeSession {
  listeners = new Map()

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, inputSource, additions = {}) {
    const event = { type, inputSource, ...additions }
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

const variantHarnesses = [
  {
    name: 'vanilla',
    load: () =>
      import('../examples/primitive-workshop/vanilla/physical-actions.js'),
    create(module, options) {
      const menuSources = new Map()
      const actions = module.createPhysicalActions({
        ...options,
        inputSourceForMenuSourceId: (sourceId) =>
          menuSources.get(sourceId) ?? null,
      })
      return {
        actions,
        menu(event, inputSource) {
          menuSources.set(event.source.id, inputSource)
          return actions.menuAction(event)
        },
        scene(inputSource, occurrence = {}) {
          return actions.sceneAction({ ...occurrence, inputSource })
        },
      }
    },
  },
  {
    name: 'react',
    load: () =>
      import('../examples/primitive-workshop/react/physical-actions.js'),
    create(module, options) {
      const actions = module.createPhysicalActions(options)
      return {
        actions,
        menu: (event, inputSource) => actions.menuAction(event, inputSource),
        scene(inputSource, occurrence = {}) {
          return actions.sceneAction({
            ...occurrence,
            pointerState: { inputSource },
          })
        },
      }
    },
  },
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
  assert.match(
    vanillaSource,
    /from ['"]@xleepy\/wrist-menu\/three['"]/,
  )
  assert.match(
    reactSource,
    /from ['"]@xleepy\/wrist-menu\/react['"]/,
  )
  assert.doesNotMatch(`${vanillaSource}\n${reactSource}`, /(?:\.\.\/)+src\//)
  assert.equal(typeof manifest.scripts['build:vanilla'], 'string')
  assert.equal(typeof manifest.scripts['build:react'], 'string')
  assert.match(manifest.scripts.build, /build:vanilla/)
  assert.match(manifest.scripts.build, /build:react/)
})

test('the Example Variants share only the portable Workshop Model', async () => {
  const sources = await Promise.all([
    text('vanilla/main.ts'),
    text('vanilla/physical-actions.js'),
    text('vanilla/runtime.js'),
    text('react/main.tsx'),
    text('react/physical-actions.js'),
    text('react/runtime.js'),
  ])

  for (const source of sources) {
    const sharedImports = [
      ...source.matchAll(/from ['"](\.\.\/shared\/[^'"]+)['"]/g),
    ].map((match) => match[1])
    assert.deepEqual(
      [...new Set(sharedImports)],
      ['../shared/workshop-model.js'],
    )
  }
})

test('each Example Variant owns and wires its lifecycle integration', async () => {
  const [
    vanillaMain,
    vanillaLifecycle,
    vanillaRuntime,
    reactMain,
    reactLifecycle,
    reactRuntime,
  ] =
    await Promise.all([
      text('vanilla/main.ts'),
      text('vanilla/lifecycle.js'),
      text('vanilla/runtime.js'),
      text('react/main.tsx'),
      text('react/lifecycle.js'),
      text('react/runtime.js'),
    ])

  assert.match(
    vanillaMain,
    /from ['"]\.\/runtime\.js['"]/,
  )
  assert.match(
    reactMain,
    /from ['"]\.\/runtime\.js['"]/,
  )
  assert.match(vanillaMain, /lifecycle\?\.sessionActivated\(session\)/)
  assert.match(reactMain, /lifecycle\.sessionActivated\(session\)/)
  assert.match(vanillaRuntime, /createWorkshopLifecycle/)
  assert.match(reactRuntime, /createWorkshopLifecycle/)
  assert.match(vanillaMain, /createWorkshopScenario/)
  assert.match(reactMain, /createWorkshopScenario/)
  assert.doesNotMatch(vanillaLifecycle, /react\/(?:main|lifecycle)/i)
  assert.doesNotMatch(reactLifecycle, /vanilla\/(?:main|lifecycle)/i)
  assert.doesNotMatch(
    `${vanillaLifecycle}\n${reactLifecycle}`,
    /\.\.\/shared\//,
  )
})

test('the static chooser exposes direct query-preserving paths and diagnostics', async () => {
  const [chooser, manifest, vanillaHtml, vanillaMain, reactMain] =
    await Promise.all([
      text('index.html'),
      text('package.json'),
      text('vanilla/index.html'),
      text('vanilla/main.ts'),
      text('react/main.tsx'),
    ])
  const scripts = JSON.parse(manifest).scripts

  assert.match(chooser, /href="\.\/vanilla\/"/)
  assert.match(chooser, /href="\.\/react\/"/)
  assert.match(chooser, /target\.search = location\.search/)
  assert.match(scripts.build, /build:index/)
  assert.match(vanillaHtml, /id="diagnostics"/)
  assert.match(`${vanillaMain}\n${reactMain}`, /WRIST_MENU_PACKAGE_VERSION/)
  assert.match(`${vanillaMain}\n${reactMain}`, /debug/)
  assert.match(`${vanillaMain}\n${reactMain}`, /nextAction/)
})

for (const harness of variantHarnesses) {
  test(`${harness.name} listener wiring isolates same-descriptor XR sources`, async () => {
    const module = await harness.load()
    const fixture = harness.create(module, {})
    const session = new FakeSession()
    fixture.actions.attachSession(session)
    const descriptor = { kind: 'controller', handedness: 'right' }
    const firstSource = { handedness: 'right' }
    const secondSource = { handedness: 'right' }
    session.dispatch('selectstart', firstSource)
    session.dispatch('selectstart', secondSource)

    const secondMenu = fixture.menu(
      selectionIntentEvent('source-b', descriptor),
      secondSource,
    )
    const firstMenu = fixture.menu(
      selectionIntentEvent('source-a', descriptor),
      firstSource,
    )

    assert.notEqual(firstMenu, secondMenu)
    assert.match(firstMenu, /:1$/)
    assert.match(secondMenu, /:2$/)
    assert.equal(fixture.scene(firstSource), firstMenu)
    assert.equal(fixture.scene(secondSource), secondMenu)
    fixture.actions.dispose()
  })

  test(`${harness.name} gives rapid distinct hand commits distinct identities`, async () => {
    const module = await harness.load()
    const fixture = harness.create(module, { lifetimeMs: 250, now: () => 100 })
    const source = { handedness: 'right', hand: {} }
    const firstEvent = selectionIntentEvent('hand-source', { time: 100 })
    const secondEvent = selectionIntentEvent('hand-source', { time: 101 })

    const first = fixture.menu(firstEvent, source)
    assert.equal(fixture.menu(firstEvent, source), first)
    assert.notEqual(fixture.menu(secondEvent, source), first)
    fixture.actions.dispose()
  })

  test(`${harness.name} expires an unmatched direct-hand menu occurrence`, async () => {
    let now = 100
    const module = await harness.load()
    const fixture = harness.create(module, {
      lifetimeMs: 250,
      now: () => now,
    })
    const source = { handedness: 'right', hand: {} }
    const menu = fixture.menu(selectionIntentEvent('expiring-hand'), source)

    now += 251

    assert.notEqual(fixture.scene(source), menu)
    fixture.actions.dispose()
  })

  test(`${harness.name} correlates menu then scene by actual source`, async () => {
    const module = await harness.load()
    const fixture = harness.create(module, {})
    const source = { handedness: 'right', hand: {} }
    const menu = fixture.menu(selectionIntentEvent('menu-first'), source)

    assert.equal(fixture.scene(source), menu)
    fixture.actions.dispose()
  })

  test(`${harness.name} correlates scene then menu by actual source`, async () => {
    const module = await harness.load()
    const fixture = harness.create(module, {})
    const source = { handedness: 'right', hand: {} }
    const scene = fixture.scene(source)

    assert.equal(
      fixture.menu(selectionIntentEvent('scene-first'), source),
      scene,
    )
    fixture.actions.dispose()
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
  assert.ok(config.include.includes('vanilla/physical-actions.js'))
  assert.ok(config.include.includes('react/physical-actions.js'))
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
