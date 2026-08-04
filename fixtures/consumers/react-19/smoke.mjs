import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '@xleepy/wrist-menu/react'

const packageVersion = async (packageName) => {
  const manifestUrl = new URL(`./node_modules/${packageName}/package.json`, import.meta.url)
  return JSON.parse(await readFile(manifestUrl, 'utf8')).version
}

assert.equal(renderToString(createElement(WristMenu)), '')
assert.equal(await packageVersion('react'), '19.2.7')
assert.equal(await packageVersion('react-dom'), '19.2.7')
assert.equal(await packageVersion('three'), '0.185.1')
assert.equal(await packageVersion('@react-three/fiber'), '9.6.1')
assert.equal(await packageVersion('@react-three/xr'), '6.6.30')
