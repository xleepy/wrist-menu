import { verifyImportSafety } from '../import-safety.mjs'

await verifyImportSafety({
  entries: ['@xleepy/wrist-menu/react'],
  reportFile: 'react-18-import-safety.json',
})
