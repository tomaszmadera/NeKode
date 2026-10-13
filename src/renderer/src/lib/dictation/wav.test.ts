import { describe, expect, it } from 'vitest'
import { MAX_DICTATION_AUDIO_BYTES } from '../../../../shared/dictation-contract'
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
  it('merges multiple chunks in order into the PCM stream', () => {
    const take = encodeWav([new Float32Array(4).fill(0.5), new Float32Array(4).fill(-0.5)], 16000)
    const view = new DataView(take.wav)
    expect(view.getUint32(40, true)).toBe(16)
    const sample = (index: number): number => view.getInt16(44 + index * 2, true)
    expect([0, 1, 2, 3].map(sample)).toEqual([16384, 16384, 16384, 16384])
    expect([4, 5, 6, 7].map(sample)).toEqual([-16384, -16384, -16384, -16384])
  })
  it('rejects a take whose encoded size exceeds the audio byte limit', () => {
    const overLimitSamples = Math.floor((MAX_DICTATION_AUDIO_BYTES - 44) / 2) + 1
    expect(() => encodeWav([new Float32Array(overLimitSamples)], 16000)).toThrow(
      'Recording is too long',
    )
  })
  it.each([0, 8000, 15999, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid sample rate %s',
    (sampleRate) => {
      expect(() => encodeWav([new Float32Array(100)], sampleRate)).toThrow('Invalid sample rate')
    },
  )
  it('rejects a NaN PCM sample instead of encoding it', () => {
    const input = new Float32Array(16000)
    input[123] = Number.NaN
    expect(() => encodeWav([input], 16000)).toThrow('Invalid PCM')
  })
  it.each([
    ['holds silent just below the RMS gate', 0.0029, 16000, true],
    ['passes speech just above the RMS gate', 0.0031, 16000, false],
    ['holds silent below the length floor', 0.5, 4799, true],
    ['passes loud audio at the length floor', 0.5, 4800, false],
  ] as const)('%s', (_name, fill, count, noSpeech) => {
    expect(encodeWav([new Float32Array(count).fill(fill)], 16000).noSpeech).toBe(noSpeech)
  })
})
