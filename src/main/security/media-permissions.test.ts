import { describe, expect, it } from 'vitest'
import { allowsMicrophone, allowsRendererClipboard } from './media-permissions'

describe('microphone permissions', () => {
  const urls = ['file:///app/index.html']
  it('permits only audio from the trusted main document', () => {
    expect(allowsMicrophone('media', urls[0], true, ['audio'], urls)).toBe(true)
    for (const media of [undefined, [], ['video'], ['audio', 'video'], ['unknown']])
      expect(allowsMicrophone('media', urls[0], true, media, urls)).toBe(false)
    expect(allowsMicrophone('media', urls[0], false, ['audio'], urls)).toBe(false)
    expect(allowsMicrophone('media', 'https://outside.test', true, ['audio'], urls)).toBe(false)
    expect(allowsMicrophone('display-capture', urls[0], true, ['audio'], urls)).toBe(false)
    expect(allowsMicrophone('media', urls[0], true, ['audio'], [])).toBe(false)
  })
  it('preserves existing trusted renderer clipboard actions without granting other permissions', () => {
    expect(allowsRendererClipboard('clipboard-read', urls[0], true, urls)).toBe(true)
    expect(allowsRendererClipboard('clipboard-sanitized-write', urls[0], true, urls)).toBe(true)
    expect(allowsRendererClipboard('clipboard-read', urls[0], false, urls)).toBe(false)
    expect(allowsRendererClipboard('clipboard-read', 'https://outside.test', true, urls)).toBe(
      false,
    )
    expect(allowsRendererClipboard('geolocation', urls[0], true, urls)).toBe(false)
  })
})
