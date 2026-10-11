import workletUrl from './pcm-worklet?worker&url'
import type { RecordedTake } from './wav'

export class RecordingFailure extends Error {}

export interface Recording {
  stop(): Promise<RecordedTake>
  discard(): void
}
export interface DictationRecorder {
  start(signal: AbortSignal, onFailure: () => void): Promise<Recording>
}

export const microphoneRecorder: DictationRecorder = {
  async start(signal, onFailure) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000 },
      video: false,
    })
    let context: AudioContext | null = null
    let node: AudioWorkletNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let stopped = false
    let rejectStop: ((reason: Error) => void) | null = null
    let stopTimeout: ReturnType<typeof setTimeout> | null = null
    const release = () => {
      stopped = true
      if (stopTimeout !== null) clearTimeout(stopTimeout)
      signal.removeEventListener('abort', discard)
      for (const track of stream.getTracks()) {
        track.onended = null
        track.stop()
      }
      source?.disconnect()
      node?.disconnect()
      if (node) {
        node.port.onmessage = null
        node.port.close()
      }
      if (context) void context.close()
    }
    const discard = () => {
      rejectStop?.(new Error('Recording cancelled'))
      release()
    }
    const fail = () => {
      if (stopped) return
      rejectStop?.(new Error('Recording failed'))
      release()
      onFailure()
    }
    try {
      if (signal.aborted) {
        discard()
        throw new Error('Recording cancelled')
      }
      signal.addEventListener('abort', discard, { once: true })
      context = new AudioContext({ sampleRate: 16000 })
      await context.audioWorklet.addModule(workletUrl)
      if (signal.aborted) throw new Error('Recording cancelled')
      node = new AudioWorkletNode(context, 'nekode-dictation-pcm')
      source = context.createMediaStreamSource(stream)
      source.connect(node)
      // The processor emits silence to destination; microphone audio is never monitored.
      node.connect(context.destination)
      node.onprocessorerror = fail
      node.port.onmessage = ({ data }) => {
        if (data?.error) fail()
      }
      for (const track of stream.getAudioTracks()) track.onended = fail
      await context.resume()
      if (signal.aborted) throw new Error('Recording cancelled')
      return {
        discard,
        stop: () =>
          new Promise<RecordedTake>((resolve, reject) => {
            if (stopped || !node) {
              reject(new Error('Recording failed'))
              return
            }
            rejectStop = reject
            stopTimeout = setTimeout(fail, 5000)
            node.port.onmessage = ({ data }) => {
              if (data?.error) {
                fail()
                return
              }
              if (!(data?.wav instanceof ArrayBuffer) || typeof data.noSpeech !== 'boolean') {
                fail()
                return
              }
              release()
              resolve(data as RecordedTake)
            }
            node.port.postMessage('stop')
          }),
      }
    } catch {
      release()
      throw new RecordingFailure('Recording failed')
    }
  },
}
