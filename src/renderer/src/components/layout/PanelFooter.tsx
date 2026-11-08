import type React from 'react'
import mascot from '../../assets/sleeping-cat.webp'
import { Icon } from '../../lib/icons'
import { buildIssueReportUrl, platformFromUserAgent } from '../../lib/issue-report'
import { TEST_ID } from '../../lib/test-ids'
import './PanelFooter.css'

const REPORT_ISSUE_URL = buildIssueReportUrl(
  __APP_VERSION__,
  platformFromUserAgent(navigator.userAgent),
)

// Shared by the projects navigation and Project Files panel.
interface PanelFooterProps {
  onOpenAppSettings: (options?: { scrollToUpdate?: boolean }) => void
  mascotVisible: boolean
  mascotError: string | null
  onToggleMascot: () => void
}

export function PanelFooter({
  onOpenAppSettings,
  mascotVisible,
  mascotError,
  onToggleMascot,
}: PanelFooterProps): React.JSX.Element {
  return (
    <div className="shrink-0">
      {mascotVisible ? (
        <div className="panel-mascot" data-testid={TEST_ID.panelMascot}>
          <img src={mascot} alt="" width={400} height={210} draggable={false} />
        </div>
      ) : null}
      {mascotError !== null ? (
        <p role="alert" className="px-3 py-1 text-xs text-error">
          {mascotError}
        </p>
      ) : null}
      <div className="nk-panel-footer">
        <button
          type="button"
          className="nk-app-settings nk-footer-action"
          data-testid={TEST_ID.appSettingsButton}
          aria-label="App settings"
          aria-haspopup="dialog"
          title="App Settings"
          onClick={() => {
            onOpenAppSettings()
          }}
        >
          <Icon.settings size={18} strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          className="nk-footer-action nk-mascot-toggle"
          data-testid={TEST_ID.mascotToggle}
          aria-label={mascotVisible ? 'Hide mascot' : 'Show mascot'}
          aria-pressed={mascotVisible}
          title={mascotVisible ? 'Hide mascot' : 'Show mascot'}
          onClick={onToggleMascot}
        >
          <Icon.mascot size={18} strokeWidth={1.8} aria-hidden />
        </button>
        {/* target=_blank reaches setWindowOpenHandler, which opens allowlisted
            URLs in the system browser (src/main/index.ts). */}
        <button
          type="button"
          className="nk-footer-action"
          data-testid={TEST_ID.reportIssueLink}
          onClick={() => window.open(REPORT_ISSUE_URL, '_blank', 'noopener,noreferrer')}
          aria-label="Report a bug"
          title="Report a bug"
        >
          <Icon.bug size={18} strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-mono text-[13px] text-ink-muted select-none hover:text-ink focus-visible:outline focus-visible:outline-info"
          data-testid={TEST_ID.panelAppVersion}
          title={`NeKode v${__APP_VERSION__}`}
          aria-label="Open app settings"
          onClick={() => onOpenAppSettings({ scrollToUpdate: true })}
        >
          v{__APP_VERSION__}
        </button>
      </div>
    </div>
  )
}
