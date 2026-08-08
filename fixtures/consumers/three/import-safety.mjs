import { verifyImportSafety } from '../import-safety.mjs'

await verifyImportSafety({
  entries: [
    '@xleepy/wrist-menu',
    '@xleepy/wrist-menu/core',
    '@xleepy/wrist-menu/three',
  ],
  reportFile: 'core-three-import-safety.json',
})
