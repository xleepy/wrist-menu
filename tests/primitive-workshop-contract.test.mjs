import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const exampleRoot = new URL('../examples/primitive-workshop/', import.meta.url)

async function text(relativePath) {
  return readFile(new URL(relativePath, exampleRoot), 'utf8')
}

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
