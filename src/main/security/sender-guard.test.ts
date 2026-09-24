import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl, isTrustedSender } from './sender-guard'

const TRUSTED = ['file:///F:/projects/NeKode/out/renderer/index.html']
const DEV = ['http://localhost:5173']

describe('isTrustedRendererUrl', () => {
  it('trusts the loaded app document and dev-server routes', () => {
    expect(isTrustedRendererUrl(TRUSTED[0], TRUSTED)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/', DEV)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/src/main.tsx', DEV)).toBe(true)
  })

  it('rejects lookalike prefixes and foreign origins', () => {
    expect(isTrustedRendererUrl('http://localhost:5173evil.com/', DEV)).toBe(false)
    expect(isTrustedRendererUrl('https://evil.com/', DEV)).toBe(false)
    expect(isTrustedRendererUrl('file:///C:/other/app.html', TRUSTED)).toBe(false)
    expect(
      isTrustedRendererUrl('file:///F:/projects/NeKode/out/renderer/index.html.evil', TRUSTED),
    ).toBe(false)
  })

  it('fails closed on missing or invalid inputs', () => {
    expect(isTrustedRendererUrl(TRUSTED[0], [])).toBe(false)
    expect(isTrustedRendererUrl(null, TRUSTED)).toBe(false)
    expect(isTrustedRendererUrl(undefined, TRUSTED)).toBe(false)
    expect(isTrustedRendererUrl(123, TRUSTED)).toBe(false)
  })
})

describe('isTrustedSender', () => {
  it('accepts the trusted main frame', () => {
    expect(isTrustedSender({ url: TRUSTED[0], isMainFrame: true }, TRUSTED)).toBe(true)
  })

  it('rejects subframes even with a trusted URL', () => {
    expect(isTrustedSender({ url: TRUSTED[0], isMainFrame: false }, TRUSTED)).toBe(false)
  })

  it('rejects frames without a URL', () => {
    expect(isTrustedSender({ url: null, isMainFrame: true }, TRUSTED)).toBe(false)
    expect(isTrustedSender({ url: undefined, isMainFrame: true }, TRUSTED)).toBe(false)
  })
})
