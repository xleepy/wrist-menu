import { verifyImportSafety } from '../import-safety.mjs'

await verifyImportSafety({
  entries: ['@xleepy/wrist-menu/react'],
  reportFile: 'react-19-import-safety.json',
})
