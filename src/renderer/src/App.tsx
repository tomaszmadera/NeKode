import type React from 'react'
import { useCallback, useEffect } from 'react'
import { CenterHeader } from './components/layout/CenterHeader'
import { LeftNavigation } from './components/layout/LeftNavigation'
import { ResizeHandle } from './components/layout/ResizeHandle'
import { TopBar } from './components/layout/TopBar'
import { useResizableRegion } from './hooks/useResizableRegion'

export const TEST_ID = {
  appShell: 'app-shell',
  topBar: 'region-top',
  leftNav: 'region-left',
  centerHeader: 'region-center-header',
  centerSurface: 'region-center-surface',
  rightRegion: 'region-right',
  bottomRegion: 'region-bottom',
  leftResizeHandle: 'resize-handle-left',
  bottomResizeHandle: 'resize-handle-bottom',
  projectList: 'project-list',
  emptyProjectList: 'project-list-empty',
  addProjectButton: 'add-project-button',
  welcomeSurface: 'welcome-surface',
} as const

export function App({ app = window.app }: { app?: typeof window.app }): React.JSX.Element {
  const leftRegion = useResizableRegion({ id: 'left', axis: 'x', initialSize: 280, minSize: 220 })
  const bottomRegion = useResizableRegion({
    id: 'bottom',
    axis: 'y',
    initialSize: 220,
    minSize: 160,
  })

  useEffect(() => {
    app.projects
      .list()
      .then((projects) => {
        // Stage 1: stub returns a fixed empty list; Stage 2 wires real data.
        void projects
      })
      .catch(() => {
        // Stub channel failures must not break the shell.
      })
  }, [app])

  const handleAddProject = useCallback(() => {
    // Intentionally non-functional in Stage 1 (spec Scope: affordance only).
  }, [])

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100 antialiased"
      data-testid={TEST_ID.appShell}
    >
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftNavigation
          width={leftRegion.size}
          onResizeStart={leftRegion.startResize}
          projects={[]}
          onAddProject={handleAddProject}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <CenterHeader />
          <main
            className="flex min-h-0 flex-1 flex-col items-center justify-center px-6"
            data-testid={TEST_ID.centerSurface}
          >
            <WelcomeSurface />
          </main>
          <div data-testid={TEST_ID.rightRegion} style={{ display: 'none' }}>
            Right Panel
          </div>
        </div>
      </div>
      <div
        className="flex shrink-0 flex-col bg-neutral-900/60"
        data-testid={TEST_ID.bottomRegion}
        style={{ display: 'none' }}
      >
        <div className="flex-1 px-4 py-2 text-xs text-neutral-500">Auxiliary Terminal</div>
        <ResizeHandle
          axis="y"
          onResizeStart={bottomRegion.startResize}
          testId={TEST_ID.bottomResizeHandle}
        />
      </div>
    </div>
  )
}

function WelcomeSurface(): React.JSX.Element {
  return (
    <section
      className="flex max-w-md flex-col items-center gap-3 text-center"
      data-testid={TEST_ID.welcomeSurface}
    >
      <h1 className="text-lg font-medium text-neutral-100">Welcome to NeKode</h1>
      <p className="text-sm leading-relaxed text-neutral-400">
        Add a local project to start working. Tasks you create will run in dedicated terminals
        attached to the project directory.
      </p>
    </section>
  )
}

export default App
