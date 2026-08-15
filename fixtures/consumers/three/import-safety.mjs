import { verifyImportSafety } from '../import-safety.mjs'
import * as three from 'three'

await verifyImportSafety({
  entries: [
    '@xleepy/wrist-menu',
    '@xleepy/wrist-menu/core',
    '@xleepy/wrist-menu/three',
  ],
  reportFile: 'core-three-import-safety.json',
  three,
  importEntry: (entry) => import(entry),
})
