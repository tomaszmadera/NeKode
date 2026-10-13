// Shared navigator.clipboard stub for renderer tests: jsdom ships no clipboard,
// so copy/paste surfaces need one (Stage 2 W17). The original property
// descriptor is captured on first install and `restoreClipboard()` puts it
// back - register it in the file's afterEach so the stub cannot leak into the
// next test.
import { vi } from 'vitest'

export interface ClipboardStub {
  writeText: ReturnType<typeof vi.fn>
  readText: ReturnType<typeof vi.fn>
}

let original: PropertyDescriptor | undefined
let installed = false

export function stubClipboard(
  overrides: {
    writeText?: ReturnType<typeof vi.fn>
    readText?: ReturnType<typeof vi.fn>
    /** Simulate a missing clipboard (value null, e.g. permission denied). */
    missing?: boolean
  } = {},
): ClipboardStub {
  if (!installed) {
    original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    installed = true
  }
  const writeText = overrides.writeText ?? vi.fn(() => Promise.resolve())
  const readText = overrides.readText ?? vi.fn(() => Promise.resolve(''))
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: overrides.missing === true ? null : { writeText, readText },
  })
  return { writeText, readText }
}

/** Restores the pre-stub navigator.clipboard descriptor (call in afterEach). */
export function restoreClipboard(): void {
  if (!installed) return
  if (original === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard')
  } else {
    Object.defineProperty(navigator, 'clipboard', original)
  }
  original = undefined
  installed = false
}
