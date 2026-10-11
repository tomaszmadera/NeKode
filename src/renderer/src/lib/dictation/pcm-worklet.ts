import { MAX_DICTATION_AUDIO_BYTES } from '../../../../shared/dictation-contract'
import { encodeWav } from './wav'

declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class DictationPcmProcessor extends AudioWorkletProcessor {
  private chunks: Float32Array[] = []
  private samples = 0
  private recording = true

  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data !== 'stop' || !this.recording) return
      this.recording = false
      try {
        const take = encodeWav(this.chunks, sampleRate)
        this.port.postMessage(take, [take.wav])
      } catch {
        this.port.postMessage({ error: true })
      }
      this.chunks = []
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.recording) return false
    const channels = inputs[0]
    if (!channels?.length) return true
    const mono = new Float32Array(channels[0].length)
    for (const channel of channels)
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
    this.samples += mono.length
    if (44 + ((this.samples * 16000) / sampleRate) * 2 > MAX_DICTATION_AUDIO_BYTES) {
      this.recording = false
      this.chunks = []
      this.port.postMessage({ error: true })
      return false
    }
    this.chunks.push(mono)
    return true
  }
}

registerProcessor('nekode-dictation-pcm', DictationPcmProcessor)
