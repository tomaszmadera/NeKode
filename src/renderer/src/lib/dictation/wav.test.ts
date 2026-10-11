import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

describe('dictation WAV', () => {
  it('resamples mono PCM to 16 kHz, little-endian signed 16-bit WAV', () => {
    const input = new Float32Array(48000).fill(0.5)
    const take = encodeWav([input], 48000)
    const header = new DataView(take.wav)
    expect(String.fromCharCode(...new Uint8Array(take.wav, 0, 4))).toBe('RIFF')
    expect(header.getUint16(22, true)).toBe(1)
    expect(header.getUint32(24, true)).toBe(16000)
    expect(header.getUint16(34, true)).toBe(16)
    expect(header.getUint32(40, true)).toBe(32000)
    expect(header.getInt16(44, true)).toBe(16384)
    expect(take.noSpeech).toBe(false)
  })
  it('gates short and silent takes before bridge submission', () => {
    expect(encodeWav([new Float32Array(4000).fill(0.8)], 16000).noSpeech).toBe(true)
    expect(encodeWav([new Float32Array(16000)], 16000).noSpeech).toBe(true)
  })
})
