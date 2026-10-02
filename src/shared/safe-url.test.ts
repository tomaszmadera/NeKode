import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './safe-url'

describe('isSafeExternalUrl', () => {
  it('accepts plain web URLs', () => {
    expect(isSafeExternalUrl('https://example.com/docs?q=1')).toBe(true)
    expect(isSafeExternalUrl('http://localhost:5173/')).toBe(true)
  })

  it('rejects dangerous or non-web protocols', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
    expect(isSafeExternalUrl('data:text/html,<script>x</script>')).toBe(false)
    expect(isSafeExternalUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeExternalUrl('chrome://settings')).toBe(false)
    expect(isSafeExternalUrl('smb://server/share')).toBe(false)
  })

  it('rejects embedded credentials', () => {
    expect(isSafeExternalUrl('https://user:pass@example.com/')).toBe(false)
    expect(isSafeExternalUrl('https://user@example.com/')).toBe(false)
  })

  it('rejects malformed or non-string input', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('example.com/x')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
    expect(isSafeExternalUrl('   ')).toBe(false)
    expect(isSafeExternalUrl(null)).toBe(false)
    expect(isSafeExternalUrl(42)).toBe(false)
    expect(isSafeExternalUrl({})).toBe(false)
  })
})
