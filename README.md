# @xleepy/wrist-menu

An ESM-only WebXR Wrist Menu Package with framework-neutral, Three.js, and React
Three Fiber entry points.

This `0.0.0` bootstrap establishes the package and validation seams before wrist
menu behavior is implemented. The React component is intentionally inert.

```ts
import { wristMenuSessionFeatures } from '@xleepy/wrist-menu'
import '@xleepy/wrist-menu/three'
import { WristMenu } from '@xleepy/wrist-menu/react'
```

Only the package root, `/core`, `/three`, and `/react` are public. Deep imports
are unsupported.
