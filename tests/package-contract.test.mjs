import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
)

const expectedExports = {
  '.': {
    types: './dist/core/index.d.ts',
    import: './dist/core/index.js',
  },
  './core': {
    types: './dist/core/index.d.ts',
    import: './dist/core/index.js',
  },
  './three': {
    types: './dist/three/index.d.ts',
    import: './dist/three/index.js',
  },
  './react': {
    types: './dist/react/index.d.ts',
    import: './dist/react/index.js',
  },
}

test('publishes only the approved ESM entry points', () => {
  assert.equal(manifest.name, '@xleepy/wrist-menu')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.sideEffects, false)
  assert.deepEqual(manifest.exports, expectedExports)
  assert.deepEqual(manifest.files, ['dist', 'README.md', 'LICENSE', 'compatibility.json'])
  assert.equal(manifest.main, undefined)
})

test('has no runtime dependencies or install lifecycle scripts', () => {
  assert.deepEqual(manifest.dependencies ?? {}, {})

  for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
    assert.equal(manifest.scripts?.[lifecycle], undefined)
  }
})

test('contains the required public package metadata', () => {
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.repository?.url, 'git+https://github.com/xleepy/wrist-menu.git')
  assert.deepEqual(manifest.publishConfig, { access: 'public' })
})

test('declares the exact approved peer ranges', () => {
  assert.deepEqual(manifest.peerDependencies, {
    '@react-three/fiber': '>=8.18.0 <10',
    react: '>=18 <19.3',
    three: '>=0.185.1 <0.186.0',
  })
  assert.deepEqual(manifest.peerDependenciesMeta, {
    '@react-three/fiber': { optional: true },
    react: { optional: true },
  })
})
