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
  onOpenAppSettings: () => void
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
      <div className="flex items-center gap-1 border-t border-edge px-3 py-1.5">
        <button
          type="button"
          className="nk-app-settings nk-footer-action flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-info"
          data-testid={TEST_ID.appSettingsButton}
          aria-label="App Settings"
          title="App Settings"
          onClick={onOpenAppSettings}
        >
          <Icon.settings size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="nk-footer-action flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-info aria-pressed:text-ink"
          data-testid={TEST_ID.mascotToggle}
          aria-label="Show mascot"
          aria-pressed={mascotVisible}
          title={mascotVisible ? 'Hide mascot' : 'Show mascot'}
          onClick={onToggleMascot}
        >
          <Icon.mascot size={16} aria-hidden />
        </button>
        {/* target=_blank reaches setWindowOpenHandler, which opens allowlisted
            URLs in the system browser (src/main/index.ts). */}
        <a
          className="nk-footer-action flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:text-ink focus-visible:outline focus-visible:outline-info"
          data-testid={TEST_ID.reportIssueLink}
          href={REPORT_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Report an issue on GitHub"
          title="Report an issue on GitHub"
        >
          <Icon.bug size={16} aria-hidden />
        </a>
      </div>
    </div>
  )
}
