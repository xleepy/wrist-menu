import { assertReactLane } from '../assert-react-lane.mjs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

import { WristMenu } from '@xleepy/wrist-menu/react'

const [fiber, xr] = await Promise.all([
  import('@react-three/fiber'),
  import('@react-three/xr'),
])

if (fiber.Canvas === undefined || xr.createXRStore === undefined) {
  throw new Error('React renderer lane did not expose its expected public APIs')
}

await assertReactLane(
  renderToString(createElement(WristMenu)),
  {
    react: '18.3.1',
    'react-dom': '18.3.1',
    three: '0.185.1',
    '@react-three/fiber': '8.18.0',
    '@react-three/xr': '6.6.30',
  },
  import.meta.url,
)
