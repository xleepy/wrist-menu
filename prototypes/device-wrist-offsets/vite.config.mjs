import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

import { createVrLogHandler } from './scripts/vr-log-server.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))
const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const logFilePath = resolve(root, '.local', 'vr-test-logs', `device-wrist-offsets-${timestamp}.jsonl`)

export default defineConfig({
  base: './',
  plugins: [{
    name: 'vr-test-log-collector',
    configureServer(server) {
      server.middlewares.use(createVrLogHandler(logFilePath))
      console.info(`\n  VR test logs: ${logFilePath}\n`)
    },
  }],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
