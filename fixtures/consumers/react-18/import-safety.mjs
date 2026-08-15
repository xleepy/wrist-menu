import { verifyImportSafety } from '../import-safety.mjs'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as three from 'three'

await verifyImportSafety({
  entries: ['@xleepy/wrist-menu/react'],
  reportFile: 'react-18-import-safety.json',
  three,
  importEntry: (entry) => import(entry),
  validate(importedEntries) {
    const { WristMenu } = importedEntries.get('@xleepy/wrist-menu/react')
    if (renderToString(createElement(WristMenu)) !== '') {
      throw new Error('React server render produced host output')
    }
  },
})
