import { rm } from 'node:fs/promises'

await Promise.all([
  rm(new URL('../dist', import.meta.url), { force: true, recursive: true }),
  rm(new URL('../artifacts', import.meta.url), { force: true, recursive: true }),
])
