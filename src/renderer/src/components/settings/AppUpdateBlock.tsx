import type React from 'react'
import { useEffect, useRef, useState } from 'react'
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
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'starting'>('idle')
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

  async function onUpdate(): Promise<void> {
    if (phaseRef.current !== 'idle') return
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

  return (
    <div id="app-update" data-testid={TEST_ID.appUpdate}>
      <SettingsGroup label="Version">
        <SectionLabel title="Version" />
        <GroupBox>
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[13px] font-medium text-ink">v{__APP_VERSION__}</span>
              {canInstall && status?.version !== null && status?.version !== undefined ? (
                <span className="text-xs text-ink-muted">{`Latest release ${status.version}`}</span>
              ) : null}
              {status?.error !== null && status?.error !== undefined ? (
                <span className="text-xs text-error">{status.error}</span>
              ) : null}
              {canInstall ? (
                <span className="text-xs text-ink-muted">
                  Windows may show a SmartScreen warning because the installer is unsigned.
                </span>
              ) : status !== null ? (
                <span className="text-xs text-ink-muted">
                  Update from this screen is only for an installed Windows build.
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
            {canInstall ? (
              <button
                type="button"
                className={secondaryClass}
                data-testid={TEST_ID.appUpdateButton}
                disabled={phase !== 'idle'}
                onClick={() => {
                  void onUpdate()
                }}
              >
                Update
              </button>
            ) : null}
          </div>
        </GroupBox>
      </SettingsGroup>
    </div>
  )
}
