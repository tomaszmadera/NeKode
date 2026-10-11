import { useEffect, useRef, useState } from 'react'
import type {
  DesktopDictationSettings,
  DesktopDictationSetup,
} from '../../../shared/desktop-dictation-contract'
import type { AppApi } from '../../../shared/ipc-contract'
import { parseAppErrorPayload } from '../../../shared/ipc-error'

export interface DesktopDictationControl {
  disabledReason: string | null
  busy: boolean
  error: string | null
  activate(): Promise<void>
}

export function useDesktopDictation(app: AppApi) {
  const [setup, setSetup] = useState<DesktopDictationSetup>({
    settings: { enabled: false, confirmed: false },
    supported: false,
  })
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const savePending = useRef(false)
  useEffect(() => {
    let disposed = false
    app.dictation
      .desktopSetup()
      .then((next) => {
        if (!disposed) {
          setSetup(next)
          setReady(true)
        }
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(
            parseAppErrorPayload(reason)?.message ??
              'Desktop dictation settings could not load. Reopen NeKode and try again.',
          )
      })
    return () => {
      disposed = true
    }
  }, [app])

  const disabledReason = !ready
    ? error
      ? 'Desktop dictation settings are unavailable. Check Settings and try again.'
      : 'Loading desktop dictation settings.'
    : !setup.supported
      ? 'Desktop dictation requires Windows.'
      : !setup.settings.enabled
        ? 'Enable desktop dictation in Settings.'
        : !setup.settings.confirmed
          ? 'Confirm OpenWhispr Ctrl + Super / Tap in Settings.'
          : null

  async function configure(settings: DesktopDictationSettings): Promise<void> {
    if (savePending.current || pending.current) return
    savePending.current = true
    setSaving(true)
    setError(null)
    try {
      setSetup(await app.dictation.desktopConfigure(settings))
      setReady(true)
    } catch (reason) {
      setReady(false)
      setError(
        parseAppErrorPayload(reason)?.message ??
          'Desktop dictation settings could not save. Try again.',
      )
    } finally {
      savePending.current = false
      setSaving(false)
    }
  }

  async function activate(): Promise<void> {
    if (pending.current || savePending.current || disabledReason !== null) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await app.dictation.desktopActivate()
    } catch (reason) {
      setError(
        parseAppErrorPayload(reason)?.message ??
          'Shortcut outcome is uncertain. Inspect and stop OpenWhispr before trying again.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return {
    setup,
    saving,
    configure,
    control: {
      disabledReason: saving ? 'Saving desktop dictation settings.' : disabledReason,
      busy,
      error,
      activate,
    } satisfies DesktopDictationControl,
  }
}
