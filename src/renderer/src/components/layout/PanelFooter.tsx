import type React from 'react'
import { Icon } from '../../lib/icons'
import { TEST_ID } from '../../lib/test-ids'

// Bottom strip of the left panel: the single App Settings opener (user
// decision 2026-10-02, after Zed). One strip, two hosts — the projects
// navigation and the Project Files panel — so App Settings stays reachable
// from every mode, as UX-UI §32 requires ("including when ... the project
// files view is open").
interface PanelFooterProps {
  onOpenAppSettings: () => void
}

export function PanelFooter({ onOpenAppSettings }: PanelFooterProps): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-edge px-2 py-1.5">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-ink-muted hover:bg-highlight hover:text-ink focus-visible:outline focus-visible:outline-info"
        data-testid={TEST_ID.appSettingsButton}
        aria-label="App Settings"
        title="App Settings"
        onClick={onOpenAppSettings}
      >
        <Icon.settings size={16} aria-hidden />
        <span className="text-sm">App Settings</span>
      </button>
    </div>
  )
}
