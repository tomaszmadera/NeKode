import type {
  DesktopDictationSetup,
  DesktopDictationSettings as Settings,
} from '../../../../shared/desktop-dictation-contract'

export function DesktopDictationSettings({
  setup,
  saving,
  onChange,
}: {
  setup: DesktopDictationSetup
  saving: boolean
  onChange: (settings: Settings) => Promise<void>
}) {
  return (
    <div className="mt-4 space-y-3 text-sm text-ink-secondary">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={setup.settings.enabled}
          disabled={!setup.supported || saving}
          onChange={(event) => {
            void onChange({ enabled: event.target.checked, confirmed: false })
          }}
        />
        Enable desktop dictation
      </label>
      {!setup.supported ? <p>Desktop dictation requires Windows.</p> : null}
      <p>Supported shortcut: Ctrl + Super (Windows key). Activation: Tap only.</p>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={setup.settings.confirmed}
          disabled={!setup.supported || !setup.settings.enabled || saving}
          onChange={(event) => {
            void onChange({ ...setup.settings, confirmed: event.target.checked })
          }}
        />
        I confirm OpenWhispr is running with Ctrl + Super / Tap configured.
      </label>
      <p>
        Dictation focuses this button's prompt and sends the shortcut once. Tap toggles OpenWhispr
        and may start or stop a recording. Sending the shortcut does not confirm recording or
        transcription.
      </p>
      <p>
        OpenWhispr controls the microphone, language, model and Cloud or Local processing. In Cloud
        mode, OpenWhispr handles your audio according to its selected mode.
      </p>
      <p>
        Stop or cancel in OpenWhispr or with its configured shortcut. OpenWhispr pastes into the
        currently focused field. Keep your intended prompt focused until insertion; sending it
        remains a separate action.
      </p>
    </div>
  )
}
