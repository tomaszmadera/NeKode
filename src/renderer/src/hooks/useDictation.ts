import { useEffect, useRef, useState } from 'react'
import { DictationController, type DictationView } from '../lib/dictation/controller'
import { microphoneRecorder } from '../lib/dictation/recorder'

export function useDictation() {
  const [view, setView] = useState<DictationView>({ state: 'idle', chatId: null, result: null })
  const controller = useRef<DictationController | null>(null)
  useEffect(() => {
    const current = new DictationController(window.app.dictation, microphoneRecorder, setView)
    controller.current = current
    const discard = () => current.dispose()
    window.addEventListener('pagehide', discard)
    return () => {
      window.removeEventListener('pagehide', discard)
      current.dispose()
      controller.current = null
    }
  }, [])
  return {
    ...view,
    start: (chatId: string, retrySessionId: string | null = null) =>
      controller.current?.start(chatId, retrySessionId),
    stop: () => controller.current?.stop(),
    cancel: () => controller.current?.cancel(),
  }
}
