import {
  inter400Woff2Base64,
  inter600Woff2Base64,
} from './inter-font-data.js'

type FontFaceSetLike = {
  add(face: unknown): void
}

type FontFaceConstructor = new (
  family: string,
  source: ArrayBuffer,
  descriptors: Readonly<{ style: string; weight: string }>,
) => unknown

type FontEnvironment = {
  atob?: (encoded: string) => string
  FontFace?: FontFaceConstructor
  document?: { fonts?: FontFaceSetLike }
}

let installed = false

function decodeBase64(encoded: string, atob: (value: string) => string) {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

/** Install bundled Inter synchronously from binary FontFace sources when available. */
export function installEmbeddedInterFont(): boolean {
  if (installed) return true
  const environment = globalThis as unknown as FontEnvironment
  const FontFace = environment.FontFace
  const fonts = environment.document?.fonts
  const atob = environment.atob
  if (FontFace === undefined || fonts === undefined || atob === undefined) {
    return false
  }

  try {
    fonts.add(
      new FontFace(
        'WristMenuInter',
        decodeBase64(inter400Woff2Base64, atob),
        { style: 'normal', weight: '400' },
      ),
    )
    fonts.add(
      new FontFace(
        'WristMenuInter',
        decodeBase64(inter600Woff2Base64, atob),
        { style: 'normal', weight: '600' },
      ),
    )
    installed = true
    return true
  } catch {
    // Import and construction remain browser-global safe. A browser without
    // binary FontFace support receives the atlas's generic sans-serif fallback.
    return false
  }
}
