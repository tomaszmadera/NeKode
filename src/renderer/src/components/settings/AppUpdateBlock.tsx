import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { isNewerRelease } from '../../../../shared/app-version'
import type { AppApi, AppUpdateLatest } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { GroupBox, SectionLabel, SettingsGroup, secondaryClass } from './settings-ui'

interface AppUpdateBlockProps {
  app: AppApi
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return 'Could not update NeKode.'
}

export function AppUpdateBlock({ app }: AppUpdateBlockProps): React.JSX.Element {
  const windows = (app.platform ?? 'win32') === 'win32'
  const [status, setStatus] = useState<AppUpdateLatest | null>(
    windows ? null : { canInstall: false, version: null, error: null },
  )
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'downloading' | 'starting'>('idle')
  const phaseRef = useRef(phase)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!windows) return
    let cancelled = false
    void app.appUpdate.latest().then(
      (next) => {
        if (!cancelled) setStatus(next)
      },
      () => {
        if (!cancelled) {
          setStatus({
            canInstall: true,
            version: null,
            error: 'Could not read the latest release.',
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [app, windows])

  function onAsk(): void {
    if (phaseRef.current !== 'idle') return
    phaseRef.current = 'confirm'
    setPhase('confirm')
    setActionError(null)
  }

  function onCancel(): void {
    if (phaseRef.current !== 'confirm') return
    phaseRef.current = 'idle'
    setPhase('idle')
  }

  async function onUpdate(): Promise<void> {
    if (phaseRef.current !== 'confirm') return
    phaseRef.current = 'downloading'
    setPhase('downloading')
    setActionError(null)
    try {
      await app.appUpdate.download()
      phaseRef.current = 'starting'
      setPhase('starting')
      await app.appUpdate.launch()
    } catch (error) {
      phaseRef.current = 'idle'
      setPhase('idle')
      setActionError(errorMessage(error))
    }
  }

  const canInstall = status?.canInstall === true
  const published = status?.version ?? null
  const newer =
    canInstall &&
    published !== null &&
    status?.error == null &&
    isNewerRelease(published, __APP_VERSION__)
  const checkFailed = canInstall && status?.error != null
  const offerUpdate = newer || checkFailed

  return (
    <div id="app-update" data-testid={TEST_ID.appUpdate}>
      <SettingsGroup label="Version">
        <SectionLabel title="Version" />
        <GroupBox>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[13px] font-medium text-ink">v{__APP_VERSION__}</span>
              {canInstall && published !== null ? (
                <span className="text-xs text-ink-muted">{`Latest release ${published}`}</span>
              ) : null}
              {status?.error !== null && status?.error !== undefined ? (
                <span className="text-xs text-error">{status.error}</span>
              ) : null}
              {canInstall && published !== null && !newer && !checkFailed ? (
                <span className="text-xs text-ink-muted">No newer release is published.</span>
              ) : null}
              {offerUpdate ? (
                <span className="text-xs text-ink-muted">
                  Windows may show a SmartScreen warning because the installer is unsigned.
                </span>
              ) : status !== null && !canInstall ? (
                <span className="text-xs text-ink-muted">
                  Update from this screen is only for an installed Windows build.
                </span>
              ) : null}
              {phase === 'confirm' ? (
                <span className="text-xs text-ink-muted">
                  Save your work first. NeKode closes only after you continue.
                </span>
              ) : null}
              {phase === 'downloading' ? (
                <span className="text-xs text-ink-muted">Downloading the installer...</span>
              ) : null}
              {phase === 'starting' ? (
                <span className="text-xs text-ink-muted">Starting the installer...</span>
              ) : null}
              {actionError !== null ? (
                <span className="text-xs text-error">{actionError}</span>
              ) : null}
            </div>
            {offerUpdate ? (
              <div className="flex shrink-0 items-center gap-2">
                {phase === 'idle' ? (
                  <button
                    type="button"
                    className={secondaryClass}
                    data-testid={TEST_ID.appUpdateButton}
                    onClick={onAsk}
                  >
                    Update
                  </button>
                ) : (
                  <button
                    type="button"
                    className={secondaryClass}
                    data-testid={TEST_ID.appUpdateButton}
                    disabled={phase !== 'confirm'}
                    onClick={() => {
                      void onUpdate()
                    }}
                  >
                    Close and update
                  </button>
                )}
                {phase === 'confirm' ? (
                  <button type="button" className={secondaryClass} onClick={onCancel}>
                    Cancel
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </GroupBox>
      </SettingsGroup>
    </div>
  )
}
