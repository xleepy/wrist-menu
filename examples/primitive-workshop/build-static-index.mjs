import { copyFile, mkdir } from 'node:fs/promises'

const exampleRoot = new URL('./', import.meta.url)
const outputRoot = new URL('./dist/', exampleRoot)

await mkdir(outputRoot, { recursive: true })
await copyFile(new URL('./index.html', exampleRoot), new URL('./index.html', outputRoot))
