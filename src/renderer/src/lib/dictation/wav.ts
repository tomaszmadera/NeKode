import { MAX_DICTATION_AUDIO_BYTES } from '../../../../shared/dictation-contract'

export interface RecordedTake {
  wav: ArrayBuffer
  noSpeech: boolean
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): RecordedTake {
  if (!Number.isFinite(sampleRate) || sampleRate < 16000) throw new Error('Invalid sample rate')
  const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const length = Math.floor((count * 16000) / sampleRate)
  if (44 + length * 2 > MAX_DICTATION_AUDIO_BYTES) throw new Error('Recording is too long')
  const pcm = new Float32Array(count)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk, offset)
    offset += chunk.length
  }
  const wav = new ArrayBuffer(44 + length * 2)
  const view = new DataView(wav)
  const tag = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
  }
  tag(0, 'RIFF')
  view.setUint32(4, wav.byteLength - 8, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  tag(36, 'data')
  view.setUint32(40, length * 2, true)
  let energy = 0
  for (let i = 0; i < length; i++) {
    // Average the source interval to avoid aliasing when the device ignores 16 kHz.
    const start = Math.floor((i * sampleRate) / 16000)
    const end = Math.min(count, Math.max(start + 1, Math.floor(((i + 1) * sampleRate) / 16000)))
    let value = 0
    for (let j = start; j < end; j++) {
      if (!Number.isFinite(pcm[j])) throw new Error('Invalid PCM')
      value += pcm[j]
    }
    value = Math.max(-1, Math.min(1, value / (end - start)))
    energy += value * value
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return { wav, noSpeech: length < 4800 || Math.sqrt(energy / Math.max(1, length)) < 0.003 }
}
