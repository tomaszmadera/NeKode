import type {
  DesktopDictationSettings,
  DesktopDictationSetup,
} from '@shared/contracts/desktop-dictation-contract'
import type { AppApi } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import { useEffect, useRef, useState } from 'react'

export interface DesktopDictationControl {
  /** Whether the OpenWhispr desktop shortcut is the selected dictation
      method (exactly one method is selected in Settings; AC-014). Null while
      the stored choice is unknown (loading, or a load or save failed): the
      prompt then fails closed instead of recording with an STT adapter. */
  selected?: boolean | null
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
        ? 'Select the OpenWhispr desktop shortcut in Settings.'
        : !setup.settings.confirmed
          ? 'Confirm OpenWhispr Ctrl + Super / Tap in Settings.'
          : null

  /** Resolves true once the settings are saved; false when skipped or failed
      (the failure is reported through `control.error`). */
  async function configure(settings: DesktopDictationSettings): Promise<boolean> {
    if (savePending.current || pending.current) return false
    savePending.current = true
    setSaving(true)
    setError(null)
    try {
      setSetup(await app.dictation.desktopConfigure(settings))
      setReady(true)
      return true
    } catch (reason) {
      setReady(false)
      setError(
        parseAppErrorPayload(reason)?.message ??
          'Desktop dictation settings could not save. Try again.',
      )
      return false
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
      selected: ready ? setup.supported && setup.settings.enabled : null,
      disabledReason: saving ? 'Saving desktop dictation settings.' : disabledReason,
      busy,
      error,
      activate,
    } satisfies DesktopDictationControl,
  }
}
