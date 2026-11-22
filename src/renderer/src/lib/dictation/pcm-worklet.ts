import { MAX_DICTATION_AUDIO_BYTES } from '@shared/contracts/dictation-contract'
import { DICTATION_LEVEL_WINDOW_SECONDS, dictationLevelFromRms } from './level'
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
  private levelSamples = 0
  private levelSumSquares = 0

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
    this.reportLevel(mono)
    return true
  }

  private reportLevel(mono: Float32Array): void {
    for (let i = 0; i < mono.length; i++) this.levelSumSquares += mono[i] * mono[i]
    this.levelSamples += mono.length
    if (this.levelSamples < sampleRate * DICTATION_LEVEL_WINDOW_SECONDS) return
    const level = dictationLevelFromRms(Math.sqrt(this.levelSumSquares / this.levelSamples))
    this.levelSumSquares = 0
    this.levelSamples = 0
    this.port.postMessage({ level })
  }
}

registerProcessor('nekode-dictation-pcm', DictationPcmProcessor)
