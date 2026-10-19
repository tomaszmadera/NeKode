import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActionControl,
  AgentProfile,
  AgentProfilesDocument,
  ChatInfo,
  HandoffCandidatesResult,
  KanbanBoard as KanbanBoardData,
  ProjectInfo,
} from '../../shared/ipc-contract'
import {
  APP_STATE_KEY,
  type AppApi,
  emptyGitWorktree,
  projectHandoffDirKey,
  projectKanbanAdapterKey,
} from '../../shared/ipc-contract'
import { AppError } from '../../shared/ipc-error'
import { App, TEST_ID, testIdFor } from './App'
import { playAttentionChime } from './lib/chime'
import { TERMINAL_FONT_SIZE_STORAGE_KEY } from './lib/terminal-font'
import { TERMINAL_CTRL_V_PASTE_STORAGE_KEY } from './lib/terminal-paste'
import { QUICK_THEME_SWITCH_STORAGE_KEY, THEME_STORAGE_KEY } from './lib/theme'
import { createAppApiStub as appApiStub } from './test/app-api-stub'
import { resetMockFitAddons } from './test/fit-addon-mock'
import { mockTerminalInstances, resetMockTerminals } from './test/xterm-mock'

// xterm.js needs a real canvas; mock it at the module boundary so App renders
// the chat workspace in jsdom (the wiring is asserted in ChatTerminal.test).
vi.mock('@xterm/xterm', () => import('./test/xterm-mock'))
vi.mock('@xterm/addon-fit', () => import('./test/fit-addon-mock'))
// The chime is stubbed at its module boundary: App-level tests assert the
// attention-alert gating (call/no-call per toggle); the real Web Audio guard
// behavior is covered in chime.test.ts.
vi.mock('./lib/chime', () => ({ playAttentionChime: vi.fn() }))

function createAppApiStub(): AppApi {
  // Divergences from the shared factory: this file's stub resolves projects.add
  // and chats.create with its Demo fixtures, offers both detected shells and
  // echoes the handoff-availability input items as available.
  const stub = appApiStub()
  return {
    ...stub,
    projects: {
      ...stub.projects,
      add: vi.fn().mockResolvedValue({
        id: 'p1',
        name: 'Demo',
        path: 'D:/code/demo',
        runtimeLabel: 'Node',
      }),
    },
    chats: {
      ...stub.chats,
      create: vi.fn().mockResolvedValue({ id: 't1', projectId: 'p1', name: 'Demo chat' }),
    },
    terminals: {
      ...stub.terminals,
      // Shell tab detection (spec project-shell-selection): the Project
      // Settings modal opens on the Shell tab and runs one detection.
      shellDetect: vi.fn().mockResolvedValue([
        { id: 'default', label: 'PowerShell' },
        { id: 'wsl:Ubuntu-24.04', label: 'WSL: Ubuntu-24.04' },
      ]),
      shellAddCustom: vi.fn().mockResolvedValue({ id: 'custom:D:\\sh.exe', label: 'sh.exe' }),
    },
    kanban: {
      ...stub.kanban,
      handoffAvailability: vi.fn(
        async (input: { items: Array<{ itemId: string; ref: string }> }) => ({
          state: 'ready' as const,
          items: input.items.map((entry) => ({ ...entry, available: true })),
          rejections: [],
        }),
      ),
    },
  }
}
function getByTestIdString(testId: string): HTMLElement {
  const element = screen.getByTestId(testId)
  expect(element).toBeTruthy()
  return element
}

function bottomCreateIds(app: AppApi): string[] {
  return vi
    .mocked(app.terminals.create)
    .mock.calls.map(([id]) => id)
    .filter((id) => id.startsWith('bottom:'))
}

function bottomRegion(): HTMLElement {
  return getByTestIdString(TEST_ID.bottomRegion)
}

function firePointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  coordinates: { clientX?: number; clientY?: number } = {},
): void {
  act(() => {
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        isPrimary: true,
        button: 0,
        pointerId: 1,
        ...coordinates,
      }),
    )
  })
}

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}
const projectNoRuntime: ProjectInfo = {
  id: 'p2',
  name: 'Plain',
  path: 'D:/code/plain',
  runtimeLabel: null,
}
const chatOne: ChatInfo = { id: 't1', projectId: 'p1', name: 'First chat' }
const chatTwo: ChatInfo = { id: 't2', projectId: 'p1', name: 'Second chat' }
const chatOtherProject: ChatInfo = { id: 'u1', projectId: 'p2', name: 'Other project chat' }
const codexProfile: AgentProfile = {
  id: 'prof-1',
  name: 'Codex',
  executable: 'codex.exe',
  args: ['{prompt}'],
}
const claudeProfile: AgentProfile = {
  id: 'prof-2',
  name: 'Claude',
  executable: 'claude.exe',
  args: ['--print', '{prompt}'],
}
const buildAction: ActionControl = {
  id: 'a1',
  scope: 'project',
  projectId: 'p1',
  title: 'Build',
  icon: null,
  command: 'pnpm build',
  cwd: null,
  runMode: 'background',
  confirm: false,
  sortOrder: 0,
}

describe('app settings and themes', () => {
  it('toggles the mascot independently of App Settings and restores its saved visibility', () => {
    const app = createAppApiStub()
    const view = render(<App app={app} />)
    const toggle = screen.getByRole('button', { name: 'Show mascot', pressed: true })
    expect(screen.getByTestId(TEST_ID.panelMascot)).toBeTruthy()
    fireEvent.click(toggle)
    expect(screen.queryByTestId(TEST_ID.panelMascot)).toBeNull()
    expect(screen.getByRole('button', { name: 'Show mascot', pressed: false })).toBe(toggle)
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()

    view.unmount()
    const restored = render(<App app={app} />)
    expect(screen.queryByTestId(TEST_ID.panelMascot)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show mascot', pressed: false }))
    expect(screen.getByTestId(TEST_ID.panelMascot)).toBeTruthy()
    restored.unmount()

    render(<App app={app} />)
    expect(screen.getByRole('button', { name: 'Show mascot', pressed: true })).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.panelMascot)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    expect(screen.getByRole('dialog', { name: 'App Settings' })).toBeTruthy()
  })

  it('opens the global Agents library without a project', async () => {
    const app = createAppApiStub()
    render(<App app={app} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add agent' }))
    expect(screen.getByLabelText('Command')).toBeTruthy()
    expect(app.agentProfiles.libraryGet).toHaveBeenCalledOnce()
    expect(app.agentProfiles.selectionGet).not.toHaveBeenCalled()
  })

  it('returns from Manage agents with the project draft and refreshed definitions intact', async () => {
    const app = createAppApiStub()
    const profile = { id: 'a', name: 'Alpha', executable: 'alpha', args: ['{prompt}'] }
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({ version: 1, profiles: [profile] })
    render(<App app={app} />)
    fireEvent.contextMenu(await screen.findByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Project Settings$/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Enable Alpha/ }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Default agent' }), {
      target: { value: 'a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Manage agents' }))
    const global = await screen.findByRole('dialog', { name: 'App Settings' })
    expect(within(global).getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.queryByRole('dialog', { name: 'Project Settings' })).toBeNull()
    await within(global).findByRole('button', { name: 'Edit Alpha' })
    vi.mocked(app.agentProfiles.libraryGet).mockResolvedValue({
      version: 1,
      profiles: [
        { ...profile, name: 'Edited' },
        { ...profile, id: 'copy', name: 'Copy' },
      ],
    })
    fireEvent.keyDown(within(global).getByRole('button', { name: 'Close app settings' }), {
      key: 'Escape',
    })
    const project = await screen.findByRole('dialog', { name: 'Project Settings' })
    expect(
      (
        (await within(project).findByRole('checkbox', {
          name: /Enable Edited/,
        })) as HTMLInputElement
      ).checked,
    ).toBe(true)
    expect(
      (within(project).getByRole('checkbox', { name: /Enable Copy/ }) as HTMLInputElement).checked,
    ).toBe(false)
    expect(
      (within(project).getByRole('combobox', { name: 'Default agent' }) as HTMLSelectElement).value,
    ).toBe('a')
    expect(app.agentProfiles.selectionGet).toHaveBeenCalledOnce()
    expect(app.agentProfiles.selectionSet).not.toHaveBeenCalled()
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('opens desktop setup without dispatch and wires confirmed activation through the chat prompt', async () => {
    const app = createAppApiStub()
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    expect(app.dictation.dictionaryList).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Dictation' }))
    await screen.findByRole('heading', { name: 'Dictionary (OpenWhispr)' })
    await waitFor(() => expect(app.dictation.dictionaryList).toHaveBeenCalledOnce())
    // Enable/confirm are journey setup only; the gating itself is asserted in
    // DesktopDictationSettings.test.tsx and useDesktopDictation.test.tsx.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable desktop dictation' }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('checkbox', { name: /I confirm/ }))
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))
    await waitFor(() => expect(screen.getByTestId(TEST_ID.terminalPromptInput)).toBeTruthy())
    const input = screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'draft' } })
    vi.mocked(app.dictation.desktopActivate).mockImplementation(async () => {
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('draft')
      expect(input.selectionStart).toBe(5)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dictation' }))
    })
    expect(app.dictation.desktopActivate).toHaveBeenCalledOnce()
    expect(app.terminals.write).not.toHaveBeenCalled()
    expect(app.dictation.start).not.toHaveBeenCalled()
    expect(app.dictation.audio).not.toHaveBeenCalled()
    expect(app.dictation.onResult).not.toHaveBeenCalled()
  })
  it('defaults project names to uppercase and persists the original-case preference', async () => {
    const app = createAppApiStub()
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    const view = render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectSelect('p1'))
    expect(row.querySelector('span.truncate')?.textContent).toBe('DEMO')
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const toggle = screen.getByRole('checkbox', {
      name: 'Uppercase project names in the tree',
    }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(row.querySelector('span.truncate')?.textContent).toBe('Demo')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.projectNamesUppercase, '0')
    view.unmount()
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.projectNamesUppercase ? '0' : null,
    )
    render(<App app={app} />)
    await waitFor(() =>
      expect(
        screen.getByTestId(testIdFor.projectSelect('p1')).querySelector('span.truncate')
          ?.textContent,
      ).toBe('Demo'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Uppercase project names in the tree' }))
    expect(
      screen.getByTestId(testIdFor.projectSelect('p1')).querySelector('span.truncate')?.textContent,
    ).toBe('DEMO')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.projectNamesUppercase, '1')
  })

  it('defaults project avatar icons to visible and persists the preference', async () => {
    const app = createAppApiStub()
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    const view = render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectAvatar('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const toggle = screen.getByRole('checkbox', {
      name: 'Show project icons',
    }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    expect(screen.queryByTestId(testIdFor.projectAvatar('p1'))).toBeNull()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.showProjectIcons, '0')
    view.unmount()
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.showProjectIcons ? '0' : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(screen.queryByTestId(testIdFor.projectAvatar('p1'))).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show project icons' }))
    expect(await screen.findByTestId(testIdFor.projectAvatar('p1'))).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.showProjectIcons, '1')
  })

  it('closes the app settings dialog on a backdrop mouse down', () => {
    const app = createAppApiStub()
    render(<App app={app} />)
    fireEvent.click(screen.getByTestId(TEST_ID.appSettingsButton))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    // A mouse down inside the dialog never closes it; the dimmed backdrop does.
    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog', { name: 'App Settings' })).toBeTruthy()
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()
  })

  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
    delete document.documentElement.dataset.theme
  })

  it('opens app settings without a project, switches themes and restores the saved choice', () => {
    const app = createAppApiStub()
    const view = render(<App app={app} />)
    const opener = screen.getByTestId(TEST_ID.appSettingsButton)
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const select = within(dialog).getByRole('combobox', { name: 'Theme' })
    expect(document.activeElement).toBe(select)
    expect((select as HTMLSelectElement).value).toBe('default')
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['NeKode Flat', 'NeKode Float'])
    expect(document.documentElement.dataset.theme).toBe('default')
    fireEvent.change(select, { target: { value: 'nekode-float' } })
    expect(document.documentElement.dataset.theme).toBe('nekode-float')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('nekode-float')
    const close = within(dialog).getByRole('button', { name: 'Close app settings' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(
      within(dialog).getByTestId(TEST_ID.settingsAttentionActiveChime),
    )
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(within(dialog).getByRole('tab', { name: 'General' }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(dialog).getByRole('tab', { name: 'Fonts' }))
    expect(within(dialog).getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
      'settings-tab-fonts',
    )
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(within(dialog).getByRole('tab', { name: 'General' }))
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()
    expect(document.activeElement).toBe(opener)
    view.unmount()
    render(<App app={app} />)
    expect(document.documentElement.dataset.theme).toBe('nekode-float')
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const restored = screen.getByRole('combobox', { name: 'Theme' })
    expect((restored as HTMLSelectElement).value).toBe('nekode-float')
    fireEvent.change(restored, { target: { value: 'default' } })
    expect(document.documentElement.dataset.theme).toBe('default')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('default')
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()
  })

  it('uses default for an unknown saved theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'removed-theme')
    render(<App app={createAppApiStub()} />)
    expect(document.documentElement.dataset.theme).toBe('default')
  })

  it('floating theme keeps the title bar, detaches the left panel and keeps the status bar', () => {
    // jsdom computes no Tailwind styles (no layout, paint or cascade), so the
    // floating-shell detach (user decision 2026-10-04) is visible only through
    // the class hook the left-panel slot sets when the theme is floating
    // (LeftPanelTrack.tsx:160: the detached frame vs the window-edge border).
    // One named pair centralizes that jsdom limitation. The tab-strip restyle
    // (user requests 2026-10-08, 2026-10-13) is keyed the same way: both themes
    // sit on the darker app background (bg-app), while attached keeps the
    // hairline under the row (border-b border-edge) that floating drops.
    const FLOATING_PANEL_FRAME = 'm-2'
    const ATTACHED_PANEL_FRAME = 'border-r'
    const ATTACHED_TAB_FRAME = 'border-b border-edge'

    const app = createAppApiStub()
    const view = render(<App app={app} />)
    // Attached shell first: the title bar strip is present and the left panel
    // sits flush in the window-edge slot.
    expect(screen.getByTestId(TEST_ID.titleBar)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.leftNav).className).toContain(ATTACHED_PANEL_FRAME)
    expect(screen.getByTestId(TEST_ID.leftNav).className).not.toContain(FLOATING_PANEL_FRAME)
    // Tab-strip frame: attached keeps the bottom border hairline and dark app background.
    expect(screen.getByTestId(TEST_ID.tabStrip).className).toContain(ATTACHED_TAB_FRAME)
    expect(screen.getByTestId(TEST_ID.tabStrip).className).toContain('bg-app')
    fireEvent.click(screen.getByTestId(TEST_ID.appSettingsButton))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const select = within(dialog).getByRole('combobox', { name: 'Theme' })
    fireEvent.change(select, { target: { value: 'nekode-float' } })
    expect(document.documentElement.dataset.theme).toBe('nekode-float')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('nekode-float')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close app settings' }))
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()
    // Floating shell (user decision 2026-10-04): the title bar stays (the app
    // name top-left beside the Windows caption buttons) and the left panel
    // floats detached in its own framed slot. The status bar stays in every
    // theme.
    expect(screen.getByTestId(TEST_ID.titleBar)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.statusBar)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.leftNav).className).toContain(FLOATING_PANEL_FRAME)
    expect(screen.getByTestId(TEST_ID.leftNav).className).not.toContain(ATTACHED_PANEL_FRAME)
    // Tab-strip frame, floating drops the attached hairline border.
    expect(screen.getByTestId(TEST_ID.tabStrip).className).toContain('bg-app')
    expect(screen.getByTestId(TEST_ID.tabStrip).className).not.toContain(ATTACHED_TAB_FRAME)
    // Structure (user decision 2026-10-04): the tab strip stays outside the
    // rounded content frame but attached to its top - the frame is the tab
    // strip's next sibling and carries the center surface.
    const tabStrip = screen.getByTestId(TEST_ID.tabStrip)
    expect(tabStrip.nextElementSibling?.contains(screen.getByTestId(TEST_ID.centerSurface))).toBe(
      true,
    )
    view.unmount()
  })

  it('toggles quick theme switcher from app settings and switches theme via status bar', () => {
    const app = createAppApiStub()
    render(<App app={app} />)

    // Initially switcher is not visible in status bar
    expect(screen.queryByTestId(TEST_ID.statusThemeSwitcher)).toBeNull()

    // Open App Settings
    fireEvent.click(screen.getByTestId(TEST_ID.appSettingsButton))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const toggle = within(dialog).getByTestId(TEST_ID.settingsQuickThemeSwitch)
    expect((toggle as HTMLInputElement).checked).toBe(false)

    // Check the toggle
    fireEvent.click(toggle)
    expect((toggle as HTMLInputElement).checked).toBe(true)
    expect(localStorage.getItem(QUICK_THEME_SWITCH_STORAGE_KEY)).toBe('1')

    // Close App Settings
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close app settings' }))

    // Quick theme switcher is now visible in the status bar showing "NeKode Flat"
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('NeKode Flat')

    // Click quick theme switcher to toggle theme to "NeKode Float"
    fireEvent.click(switcher)
    expect(switcher.textContent).toContain('NeKode Float')
    expect(document.documentElement.dataset.theme).toBe('nekode-float')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('nekode-float')

    // Click again to toggle back to "NeKode Flat"
    fireEvent.click(switcher)
    expect(switcher.textContent).toContain('NeKode Flat')
    expect(document.documentElement.dataset.theme).toBe('default')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('default')
  })

  it('restores quick theme switcher setting from localStorage on load', () => {
    localStorage.setItem(QUICK_THEME_SWITCH_STORAGE_KEY, '1')
    render(<App app={createAppApiStub()} />)
    const switcher = screen.getByTestId(TEST_ID.statusThemeSwitcher)
    expect(switcher).toBeTruthy()
    expect(switcher.textContent).toContain('NeKode Flat')
  })

  it('Shortcuts tab documents the global and terminal chords, General keeps the controls', () => {
    // One named table of the documented chords (global + terminal). The
    // production doc rows (AppSettings.tsx SHORTCUT_SECTIONS) are free text
    // and the live chords are registered separately (App.tsx keydown chords,
    // terminal key handling): no single source of truth compares the handler
    // registrations against these strings today (recorded source design:
    // chords registry). Until that registry exists, this table is the test's
    // one expectation for the documented chord surface; the prose descriptions
    // are deliberately not pinned (no handler comparison guards them).
    const DOCUMENTED_SHORTCUT_CHORDS = {
      global: ['Ctrl+N', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+`'],
      terminal: ['Ctrl+C', 'Ctrl+V / Ctrl+Shift+V', 'Ctrl+D', 'Ctrl+U'],
    } as const

    render(<App app={createAppApiStub()} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })

    // General is the initial tab and keeps the live controls.
    expect(
      within(dialog).getByTestId(TEST_ID.settingsGeneralTab).getAttribute('aria-selected'),
    ).toBe('true')
    expect(within(dialog).getByRole('combobox', { name: 'Theme' })).toBeTruthy()

    fireEvent.click(within(dialog).getByTestId(TEST_ID.settingsShortcutsTab))
    const table = within(dialog).getByTestId(TEST_ID.settingsShortcutsTable)
    for (const chords of Object.values(DOCUMENTED_SHORTCUT_CHORDS)) {
      for (const chord of chords) {
        expect(table.textContent).toContain(chord)
      }
    }
    // The live controls stay on General only.
    expect(within(table).queryByRole('combobox', { name: 'Theme' })).toBeNull()
    expect(table.getAttribute('aria-hidden')).toBeNull()

    fireEvent.click(within(dialog).getByTestId(TEST_ID.settingsGeneralTab))
    expect(
      within(dialog).getByTestId(TEST_ID.settingsGeneralTab).getAttribute('aria-selected'),
    ).toBe('true')
    expect(within(dialog).queryByTestId(TEST_ID.settingsShortcutsTable)).toBeNull()
    expect(within(dialog).getByRole('combobox', { name: 'Theme' })).toBeTruthy()
  })

  it.each([
    {
      scenario: 'shows a storage error and keeps the current theme when saving fails',
      phase: 'save' as const,
      expectedNotice: 'Failed to save the theme.',
    },
    {
      scenario: 'shows a read error while keeping the default theme usable',
      phase: 'load' as const,
      expectedNotice: 'Failed to load the saved theme.',
    },
  ])('$scenario', ({ phase, expectedNotice }) => {
    if (phase === 'load') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage unavailable')
      })
    }
    render(<App app={createAppApiStub()} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    if (phase === 'save') {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable')
      })
      fireEvent.change(screen.getByRole('combobox', { name: 'Theme' }), {
        target: { value: 'nekode-float' },
      })
    }
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    expect(within(dialog).getByRole('alert').textContent).toBe(expectedNotice)
    expect(document.documentElement.dataset.theme).toBe('default')
  })

  /**
   * Font sizes of the terminals still mounted (mockTerminalInstances keeps
   * disposed entries from earlier tests in this describe; App's beforeEach
   * does not reset them).
   */
  function aliveFontSizeOptions(): number[] {
    return mockTerminalInstances
      .filter((terminal) => !terminal.disposed)
      .map((terminal) => (terminal.options as { fontSize: number }).fontSize)
  }

  it('defaults Ctrl+V paste on, applies the toggle to live chat and bottom terminals, and restores it', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    const app = createAppApiStub()
    await renderTwoChats(app)
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
    fireEvent.keyDown(window, { code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(3))
    const terminals = mockTerminalInstances.filter((terminal) => !terminal.disposed)
    expect(terminals).toHaveLength(3)
    for (const terminal of terminals) terminal.buffer.active.type = 'alternate'

    const pressCtrlV = (terminal: (typeof terminals)[number]): boolean | undefined =>
      terminal.keyHandler?.(
        new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }),
      )
    act(() => {
      for (const terminal of terminals) expect(pressCtrlV(terminal)).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const checkbox = within(dialog).getByRole('checkbox', {
      name: 'Use Ctrl+V to paste text in terminals',
    }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    expect(localStorage.getItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY)).toBe('0')
    act(() => {
      for (const terminal of terminals) expect(pressCtrlV(terminal)).toBe(true)
    })
    expect(app.terminals.create).toHaveBeenCalledTimes(3)
    expect(terminals.every((terminal) => !terminal.disposed)).toBe(true)
    cleanup()

    await renderTwoChats(app)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const restoredCheckbox = screen.getByRole('checkbox', {
      name: 'Use Ctrl+V to paste text in terminals',
    }) as HTMLInputElement
    expect(restoredCheckbox.checked).toBe(false)
    const restoredTerminal = mockTerminalInstances.filter((terminal) => !terminal.disposed)[0]
    restoredTerminal.buffer.active.type = 'alternate'
    act(() => expect(pressCtrlV(restoredTerminal)).toBe(true))
    fireEvent.click(restoredCheckbox)
    expect(localStorage.getItem(TERMINAL_CTRL_V_PASTE_STORAGE_KEY)).toBe('1')
    act(() => expect(pressCtrlV(restoredTerminal)).toBe(false))
  })

  it('validates, persists and resets font families and restores them on remount', () => {
    const app = createAppApiStub()
    const view = render(<App app={app} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    expect(screen.queryByLabelText('Terminal text font')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Fonts' }))
    fireEvent.change(screen.getByLabelText('Terminal text font'), {
      target: { value: 'bad, serif' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply font families' }))
    expect(screen.getByLabelText('Terminal text font').getAttribute('aria-invalid')).toBe('true')
    expect(localStorage.getItem('nekode.terminal-font-families.v1')).toBeNull()
    fireEvent.change(screen.getByLabelText('Terminal text font'), {
      target: { value: 'Cascadia Mono' },
    })
    fireEvent.change(screen.getByLabelText('Terminal icon font'), {
      target: { value: 'Custom Symbols' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply font families' }))
    expect(JSON.parse(localStorage.getItem('nekode.terminal-font-families.v1') ?? 'null')).toEqual({
      text: 'Cascadia Mono',
      icons: 'Custom Symbols',
    })
    view.unmount()
    render(<App app={app} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Fonts' }))
    expect((screen.getByLabelText('Terminal text font') as HTMLInputElement).value).toBe(
      'Cascadia Mono',
    )
    expect((screen.getByLabelText('Terminal icon font') as HTMLInputElement).value).toBe(
      'Custom Symbols',
    )
    fireEvent.change(screen.getByLabelText('Terminal font size'), { target: { value: '19' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore font defaults' }))
    expect((screen.getByLabelText('Terminal text font') as HTMLInputElement).value).toBe(
      'Recursive Mono Casual',
    )
    expect((screen.getByLabelText('Terminal icon font') as HTMLInputElement).value).toBe(
      'Symbols Nerd Font Mono',
    )
    expect(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)).toBe('15')
  })

  it('persists the terminal font size and applies it live to every mounted terminal', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)
    // The second chat's view mounts on selection; the first stays mounted
    // (hidden), so the switch exercises the live apply on hidden views.
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
    expect(aliveFontSizeOptions()).toEqual([15, 15])

    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Fonts' }))
    const select = within(dialog).getByTestId(TEST_ID.settingsTerminalFontSize)
    expect((select as HTMLSelectElement).value).toBe('15')

    fireEvent.change(select, { target: { value: '16' } })
    expect(localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY)).toBe('16')
    // Both mounted views — the hidden one included — pick the size up live.
    expect(aliveFontSizeOptions()).toEqual([16, 16])
  })

  it('restores the saved terminal font size and falls back to the default for junk', async () => {
    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, '16')
    const app = createAppApiStub()
    await renderTwoChats(app)
    expect(aliveFontSizeOptions()).toEqual([16])

    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Fonts' }))
    expect(
      (within(dialog).getByTestId(TEST_ID.settingsTerminalFontSize) as HTMLSelectElement).value,
    ).toBe('16')
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))
    cleanup()

    localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, 'not-a-number')
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    expect(aliveFontSizeOptions()).toEqual([15])
  })

  function renderTwoChats(app: AppApi): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    return waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
  }

  // Two projects, both with loaded chats, selection in the first project.
  // hydrate loads only the selected project, so p2's chats enter through the
  // expand path (the same route a user's first tree expansion takes): the
  // click on the p2 title selects p2 (dropping the chat), then selecting
  // chat t1 restores the p1/t1 selection while p2 stays expanded.
  async function renderTwoProjectsWithChats(app: AppApi): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectNoRuntime])
    vi.mocked(app.chats.list).mockImplementation(async (projectId: string) =>
      projectId === 'p1' ? [chatOne, chatTwo] : [chatOtherProject],
    )
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await screen.findByTestId(testIdFor.chatRow('u1'))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    await waitFor(() =>
      expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.selectedChatId, 't1'),
    )
  }

  it('Ctrl+Tab switches to the next chat across all projects and persists the selection', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)

    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })

    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
    // The chord is app-level: it never reaches the PTY input (NEKODE-2).
    expect(app.terminals.write).not.toHaveBeenCalled()
  })

  it('Ctrl+Shift+Tab switches to the previous chat and wraps around', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)

    fireEvent.keyDown(window, {
      code: 'Tab',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2'),
    )

    fireEvent.keyDown(window, {
      code: 'Tab',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1'),
    )
  })

  it('Ctrl+Tab crosses the project boundary and makes the target project active', async () => {
    const app = createAppApiStub()
    await renderTwoProjectsWithChats(app)

    // t1 -> t2 stays within p1...
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2'),
    )
    // ...t2 -> u1 crosses into p2 through the same chord.
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() =>
      expect(app.terminals.create).toHaveBeenCalledWith('u1', projectNoRuntime.path),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p2')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 'u1')
    expect(screen.getByTestId(testIdFor.chatRow('u1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(testIdFor.projectSelect('p2')).getAttribute('aria-expanded')).toBe(
      'true',
    )
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Plain')
  })

  it('Ctrl+Shift+Tab wraps backwards across the global list into the previous project', async () => {
    const app = createAppApiStub()
    await renderTwoProjectsWithChats(app)

    // t1 is the first chat of the global list: backwards wraps into p2.
    fireEvent.keyDown(window, {
      code: 'Tab',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() =>
      expect(app.terminals.create).toHaveBeenCalledWith('u1', projectNoRuntime.path),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p2')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 'u1')
    expect(screen.getByTestId(testIdFor.chatRow('u1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Plain')
  })

  it('Ctrl+Tab without any selection is a no-op', async () => {
    const app = createAppApiStub()
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalled())

    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })

    expect(app.chats.list).not.toHaveBeenCalled()
    expect(app.terminals.create).not.toHaveBeenCalled()
  })

  it('turning the chat switch off also blocks cross-project switching', async () => {
    const app = createAppApiStub()
    await renderTwoProjectsWithChats(app)

    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const checkbox = within(dialog).getByTestId(TEST_ID.settingsChatSwitch) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.chatSwitchEnabled, '0'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))

    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
    expect(app.terminals.create).not.toHaveBeenCalledWith('u1', projectNoRuntime.path)
  })

  it('turning the chat switch off in App Settings disables the chord', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)

    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const checkbox = within(dialog).getByTestId(TEST_ID.settingsChatSwitch) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.chatSwitchEnabled, '0'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))

    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
    expect(app.terminals.create).not.toHaveBeenCalledWith('t2', projectA.path)
  })

  it('Ctrl+N starts a new chat in the active project and selects its terminal', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't9',
      projectId: 'p1',
      name: 'PowerShell',
    })
    const writesBefore = vi.mocked(app.terminals.write).mock.calls.length

    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })

    // The full create path ran: chat created, selected, persisted, and the
    // terminal-chat tab activated (its terminal view mounts for the new chat).
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    await screen.findByTestId(testIdFor.chatRow('t9'))
    expect(getByTestIdString(testIdFor.chatRow('t9')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't9')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t9', projectA.path))
    // The chord never reaches a PTY as input.
    expect(vi.mocked(app.terminals.write).mock.calls.length).toBe(writesBefore)
  })

  it('Ctrl+N is ignored while a modal dialog is open and without an active project', async () => {
    const app = createAppApiStub()
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    // No project selected: the dead press is noticed, not swallowed silently.
    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toBe('Select or add a project before starting a new chat.')
    expect(app.chats.create).not.toHaveBeenCalled()

    // The App Settings dialog is a modal: the chord does nothing while open.
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() => expect(app.chats.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })
    expect(app.chats.create).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'App Settings' })).toBeNull()
  })

  it('repeated Ctrl+N keydown (key auto-repeat) creates exactly one chat', async () => {
    const app = createAppApiStub()
    await renderTwoChats(app)
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't9',
      projectId: 'p1',
      name: 'PowerShell',
    })

    fireEvent.keyDown(window, {
      code: 'KeyN',
      ctrlKey: true,
      repeat: true,
      bubbles: true,
      cancelable: true,
    })
    expect(app.chats.create).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledTimes(1))
  })
})

describe('action row and settings', () => {
  let app: AppApi
  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })
  afterEach(() => {
    cleanup()
  })

  async function renderSelectedChat(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
  }

  it('writes contractual bytes only for a live terminal; Handoff pastes English into the input', async () => {
    await renderSelectedChat()
    const buttons = ['Handoff', 'Resume', 'Stop', 'Continue']
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Handoff' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    for (const label of buttons) fireEvent.click(screen.getByRole('button', { name: label }))
    // Paste-only default (spec handoff-resume-flow Behaviour 3): only Stop and
    // Continue write to the PTY; Handoff fills the prompt input in English and
    // Resume opens the handoff picker (unconfigured here -> modal only).
    // Continue is a split-write submission: the line, then the CR (0 ms gap
    // under tests).
    await waitFor(() => expect(app.terminals.write).toHaveBeenCalledTimes(3))
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([
      ['t1', '\x03'],
      ['t1', 'Continue'],
      ['t1', '\r'],
    ])
    expect((screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLInputElement).value).toBe(
      'Write a handoff',
    )
    await screen.findByTestId(TEST_ID.handoffPicker)
    expect(app.handoffs.list).not.toHaveBeenCalled()
  })

  it('auto-send writes the English Handoff and Resume commands straight to the PTY', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === APP_STATE_KEY.autoSendHandoffResume) return '1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.handoffs.list).mockResolvedValue([
      {
        name: '2026-10-01-auth.md',
        path: 'D:/code/demo/.agents/handoffs/2026-10-01-auth.md',
        modifiedAt: '2026-10-01T10:00:00.000Z',
      },
    ])
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Handoff' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Handoff' }))
    // Split-write submission: the line, then the CR as its own write.
    await waitFor(() => expect(app.terminals.write).toHaveBeenCalledWith('t1', 'Write a handoff'))
    expect(app.terminals.write).toHaveBeenCalledWith('t1', '\r')
    expect((screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLInputElement).value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await screen.findByTestId(TEST_ID.handoffPicker)
    await waitFor(() => expect(app.handoffs.list).toHaveBeenCalledWith('p1'))
    fireEvent.click(screen.getAllByTestId(TEST_ID.handoffPickerEntry)[0])
    // Auto-send uses the same project-relative command text as the paste.
    await waitFor(() =>
      expect(app.terminals.write).toHaveBeenCalledWith(
        't1',
        'Resume from handoff .agents/handoffs/2026-10-01-auth.md',
      ),
    )
    expect(app.terminals.write).toHaveBeenCalledWith('t1', '\r')
    expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull()
  })

  it('cancels pending split-write CR when chat session is torn down before gap expires', async () => {
    try {
      window.NEKODE_PROMPT_SUBMIT_GAP_MS = 100
      vi.mocked(app.state.get).mockImplementation(async (key) => {
        if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
        if (key === APP_STATE_KEY.selectedChatId) return 't1'
        if (key === APP_STATE_KEY.autoSendHandoffResume) return '1'
        return null
      })
      vi.mocked(app.projects.list).mockResolvedValue([projectA])
      vi.mocked(app.chats.list).mockResolvedValue([chatOne])
      const view = render(<App app={app} />)
      await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'Handoff' }) as HTMLButtonElement).disabled,
        ).toBe(false),
      )
      fireEvent.click(screen.getByRole('button', { name: 'Handoff' }))
      await waitFor(() => expect(app.terminals.write).toHaveBeenCalledWith('t1', 'Write a handoff'))
      expect(app.terminals.write).not.toHaveBeenCalledWith('t1', '\r')

      // Unmounting before the submit gap must cancel the pending CR timer:
      view.unmount()

      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(app.terminals.write).not.toHaveBeenCalledWith('t1', '\r')
    } finally {
      window.NEKODE_PROMPT_SUBMIT_GAP_MS = 0
    }
  })

  it('resume picker lists configured handoffs lazily and pastes the selected path', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.handoffs.list).mockResolvedValue([
      {
        name: 'newest.md',
        path: 'D:/code/demo/.agents/handoffs/newest.md',
        modifiedAt: '2026-10-01T10:00:00.000Z',
      },
      {
        name: 'older.md',
        path: 'D:/code/demo/.agents/handoffs/older.md',
        modifiedAt: '2026-09-30T08:00:00.000Z',
      },
    ])
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    // Lazy load (spec Behaviour 4): the listing happens at picker open only.
    expect(app.handoffs.list).not.toHaveBeenCalled()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await screen.findByTestId(TEST_ID.handoffPickerList)
    expect(app.handoffs.list).toHaveBeenCalledTimes(1)
    const names = screen
      .getAllByTestId(TEST_ID.handoffPickerEntry)
      .map((entry) => entry.textContent)
    expect(names[0]).toContain('newest.md')
    // The row displays the project-relative path (spec Required tests).
    expect(names[0]).toContain('.agents/handoffs/newest.md')
    fireEvent.click(screen.getAllByTestId(TEST_ID.handoffPickerEntry)[0])
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLInputElement).value).toBe(
        'Resume from handoff .agents/handoffs/newest.md',
      ),
    )
    expect(app.terminals.write).not.toHaveBeenCalled()
    expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull()
  })

  it.each([false, true])('delivers a custom Resume prompt (auto-send: %s)', async (autoSend) => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      if (key === APP_STATE_KEY.autoSendHandoffResume) return autoSend ? '1' : '0'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.handoffs.list).mockResolvedValue([
      {
        name: 'a.md',
        path: 'D:/code/demo/.agents/handoffs/a.md',
        modifiedAt: '2026-10-17T10:00:00Z',
      },
    ])
    vi.mocked(app.handoffs.resumePrompt).mockResolvedValue(
      'Read .agents/handoffs/a.md\nUse instructions.',
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull())
    if (autoSend) {
      expect(app.terminals.write).toHaveBeenCalledWith(
        't1',
        'Read .agents/handoffs/a.md\nUse instructions.',
      )
      await waitFor(() => expect(app.terminals.write).toHaveBeenCalledWith('t1', '\r'))
    } else {
      await waitFor(() =>
        expect((screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLTextAreaElement).value).toBe(
          'Read .agents/handoffs/a.md\nUse instructions.',
        ),
      )
      expect(app.terminals.write).not.toHaveBeenCalled()
    }
  })

  it('does not deliver a pending Resume prompt to another chat', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.handoffs.list).mockResolvedValue([
      {
        name: 'a.md',
        path: 'D:/code/demo/.agents/handoffs/a.md',
        modifiedAt: '2026-10-17T10:00:00Z',
      },
    ])
    let resolve!: (text: string) => void
    vi.mocked(app.handoffs.resumePrompt).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    expect(app.handoffs.resumePrompt).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
    await act(async () => resolve('Stale Resume prompt'))
    for (const input of screen.getAllByTestId(TEST_ID.terminalPromptInput)) {
      expect((input as HTMLTextAreaElement).value).toBe('')
    }
    expect(app.terminals.write).not.toHaveBeenCalled()
  })

  it('does not send a pending Resume prompt after terminal exit while chat removal is pending', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      if (key === APP_STATE_KEY.autoSendHandoffResume) return '1'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.handoffs.list).mockResolvedValue([
      {
        name: 'a.md',
        path: 'D:/code/demo/.agents/handoffs/a.md',
        modifiedAt: '2026-10-17T10:00:00Z',
      },
    ])
    let resolve!: (text: string) => void
    vi.mocked(app.handoffs.resumePrompt).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    let exit!: (code: number) => void
    vi.mocked(app.terminals.onExit).mockImplementation((_id, listener) => {
      exit = listener
      return () => undefined
    })
    vi.mocked(app.chats.remove).mockImplementation(() => new Promise<void>(() => undefined))
    render(<App app={app} />)
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(await screen.findByTestId(TEST_ID.handoffPickerEntry))
    expect(app.handoffs.resumePrompt).toHaveBeenCalledOnce()
    act(() => exit(0))
    expect(app.chats.remove).toHaveBeenCalledWith('t1')
    expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await act(async () => resolve('Stale Resume prompt'))
    expect(app.terminals.write).not.toHaveBeenCalled()
  })

  it('resume picker without a configured directory offers configure and plain paste', async () => {
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await screen.findByTestId(TEST_ID.handoffPickerUnconfigured)
    expect(app.handoffs.list).not.toHaveBeenCalled()

    // Plain fallback: the English command without a path (spec Behaviour 5).
    fireEvent.click(screen.getByTestId(TEST_ID.handoffPickerPlainPaste))
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.terminalPromptInput) as HTMLInputElement).value).toBe(
        'Resume from handoff',
      ),
    )
    expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull()

    // Configure opens Project Settings for the active project on the Actions tab.
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await screen.findByTestId(TEST_ID.handoffPickerUnconfigured)
    fireEvent.click(screen.getByTestId(TEST_ID.handoffPickerConfigure))
    await screen.findByText('Project Settings')
    expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull()
    expect(screen.getByTestId(TEST_ID.settingsHandoffDir)).toBeTruthy()
  })

  it('closes the resume picker on a backdrop mouse down', async () => {
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const dialog = await screen.findByTestId(TEST_ID.handoffPicker)
    // A mouse down inside the dialog never closes it; the dimmed backdrop does.
    fireEvent.mouseDown(dialog)
    expect(screen.getByTestId(TEST_ID.handoffPicker)).toBeTruthy()
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByTestId(TEST_ID.handoffPicker)).toBeNull()
  })

  it('keeps project settings open for inside clicks and closes on backdrop or Escape', async () => {
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project Settings' })
    // An unsaved edit plus a mouse down inside the dialog: it stays open.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.change(screen.getByTestId(TEST_ID.settingsHandoffDir), {
      target: { value: '.agents/handoffs' },
    })
    fireEvent.mouseDown(dialog)
    expect(screen.getByRole('dialog', { name: 'Project Settings' })).toBeTruthy()
    expect((screen.getByTestId(TEST_ID.settingsHandoffDir) as HTMLInputElement).value).toBe(
      '.agents/handoffs',
    )
    // The dimmed backdrop closes it, and so does Escape anywhere on the page.
    fireEvent.mouseDown(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog', { name: 'Project Settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    await screen.findByRole('dialog', { name: 'Project Settings' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Project Settings' })).toBeNull()
  })

  it('project settings edits auto-send and the per-project handoff directory', async () => {
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    await screen.findByText('Project Settings')
    // The modal opens on the Shell tab; the Configuration section lives on
    // Actions & Configuration.
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))

    const autoSend = screen.getByTestId(TEST_ID.settingsAutoSend) as HTMLInputElement
    expect(autoSend.checked).toBe(false)
    fireEvent.click(autoSend)
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.autoSendHandoffResume, '1'),
    )

    const dirInput = screen.getByTestId(TEST_ID.settingsHandoffDir) as HTMLInputElement
    expect(dirInput.value).toBe('')
    fireEvent.change(dirInput, { target: { value: ' .agents/handoffs ' } })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsHandoffDirSave))
    // The saved-value contract (input trimming included) lives in
    // ActionSettings.test.tsx; the journey only proves the save completes.
    await waitFor(() => expect(screen.getByTestId(TEST_ID.settingsHandoffDirSaved)))
  })

  it('project settings browse fills the handoff directory from the native picker', async () => {
    await renderSelectedChat()
    vi.mocked(app.dialogs.pickDirectory).mockResolvedValue('D:/code/demo/.agents/handoffs')
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    await screen.findByText('Project Settings')
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsHandoffDirBrowse))
    // The picked directory stores relative to the project root.
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsHandoffDir) as HTMLInputElement).value).toBe(
        '.agents/handoffs',
      ),
    )
    expect(app.dialogs.pickDirectory).toHaveBeenCalledWith('D:/code/demo')
  })

  it('browse stores the absolute path when the picked directory lies outside the project root', async () => {
    await renderSelectedChat()
    vi.mocked(app.dialogs.pickDirectory).mockResolvedValue('D:/elsewhere/handoffs')
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    await screen.findByText('Project Settings')
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsHandoffDirBrowse))
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsHandoffDir) as HTMLInputElement).value).toBe(
        'D:/elsewhere/handoffs',
      ),
    )
  })

  it('browse falls back to the project root while the current value is relative', async () => {
    await renderSelectedChat()
    vi.mocked(app.dialogs.pickDirectory).mockResolvedValue('D:/code/demo/handoffs')
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    await screen.findByText('Project Settings')
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.change(screen.getByTestId(TEST_ID.settingsHandoffDir), {
      target: { value: '.agents/handoffs' },
    })
    fireEvent.click(screen.getByTestId(TEST_ID.settingsHandoffDirBrowse))
    await waitFor(() =>
      expect((screen.getByTestId(TEST_ID.settingsHandoffDir) as HTMLInputElement).value).toBe(
        'handoffs',
      ),
    )
    // The picker takes null or absolute only: the relative draft falls back
    // to the project root instead of failing validation.
    expect(app.dialogs.pickDirectory).toHaveBeenCalledWith('D:/code/demo')
  })

  it('resume picker shows the empty-list and typed-error states for a configured directory', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      if (key === projectHandoffDirKey('p1')) return '.agents/handoffs'
      return null
    })
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.handoffs.list).mockResolvedValue([])
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await screen.findByTestId(TEST_ID.handoffPickerEmpty)

    // Configured but missing on disk: the typed not_found message renders
    // inline in the reopened picker (spec Behaviour 5 / Errors).
    vi.mocked(app.handoffs.list).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'Handoff directory not found: D:/code/demo/.agents/handoffs',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close handoff picker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    const error = await screen.findByTestId(TEST_ID.handoffPickerError)
    expect(error.textContent).toContain('Handoff directory not found:')
  })

  it('prompt injection is addressed to one chat only', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Handoff' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Handoff' }))
    const promptOf = (chatId: string): HTMLInputElement =>
      within(screen.getByTestId(testIdFor.terminalView(chatId))).getByTestId(
        TEST_ID.terminalPromptInput,
      ) as HTMLInputElement
    await waitFor(() => expect(promptOf('t1').value).toBe('Write a handoff'))

    // Behaviour 7: only the addressed chat sees the fill; switching to another
    // chat must not deliver it there, and the draft stays in its chat.
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
    expect(promptOf('t2').value).toBe('')
    expect(promptOf('t1').value).toBe('Write a handoff')
  })

  it('disables fixed buttons before spawn and after a spawn failure', async () => {
    vi.mocked(app.terminals.create).mockRejectedValue(new Error('spawn failed'))
    await renderSelectedChat()
    await screen.findByTestId(TEST_ID.terminalSpawnError)
    for (const label of ['Handoff', 'Resume', 'Stop', 'Continue']) {
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('disables fixed buttons as soon as the active PTY exits', async () => {
    let exit: ((code: number) => void) | undefined
    vi.mocked(app.terminals.onExit).mockImplementation((_id, listener) => {
      exit = listener
      return () => undefined
    })
    vi.mocked(app.chats.remove).mockImplementation(() => new Promise<void>(() => undefined))
    await renderSelectedChat()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
    act(() => {
      exit?.(0)
    })
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('orders configured actions after both fixed groups and polls completion', async () => {
    const idle = {
      status: 'idle' as const,
      exitCode: null,
      completedAt: null,
      error: null,
    }
    vi.mocked(app.actions.list).mockResolvedValue([buildAction])
    vi.mocked(app.actions.status).mockResolvedValue(idle)
    vi.mocked(app.actions.execute).mockImplementation(async () => {
      vi.mocked(app.actions.status).mockResolvedValue({
        status: 'failed',
        exitCode: 7,
        completedAt: '2026-09-27T15:00:00Z',
        error: null,
      })
      return { status: 'running', exitCode: null, completedAt: null, error: null }
    })
    await renderSelectedChat()
    await waitFor(() => expect(app.actions.status).toHaveBeenCalledWith('a1'))
    await act(async () => {
      await Promise.resolve()
    })
    const row = screen.getByTestId(TEST_ID.actionRowSlot)
    expect(
      [...row.querySelectorAll('button')].map(
        (button) => button.getAttribute('aria-label') ?? button.textContent,
      ),
    ).toEqual(['Handoff', 'Resume', 'Stop', 'Continue', 'Build'])
    expect(app.actions.execute).not.toHaveBeenCalled()
    const statusReadsAtIdle = vi.mocked(app.actions.status).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() => expect(app.actions.execute).toHaveBeenCalledWith('a1', 'p1', false))
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /Build/ }).getAttribute('data-status')).toBe(
          'failed',
        ),
      { timeout: 1500 },
    )
    expect(vi.mocked(app.actions.status).mock.calls.length).toBeGreaterThan(statusReadsAtIdle)
    expect(screen.getByRole('button', { name: /Build/ }).getAttribute('title')).toContain(
      'Exit code: 7',
    )
  })

  it('asks before a confirmation action and does not execute on cancel', async () => {
    vi.mocked(app.actions.list).mockResolvedValue([{ ...buildAction, confirm: true }])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await renderSelectedChat()
      fireEvent.click(screen.getByRole('button', { name: 'Build' }))
      expect(confirm).toHaveBeenCalledWith('Run Build?')
      expect(app.actions.execute).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      vi.mocked(app.actions.execute).mockResolvedValue({
        status: 'success',
        exitCode: 0,
        completedAt: '2026-09-27T15:00:00Z',
        error: null,
      })
      fireEvent.click(screen.getByRole('button', { name: 'Build' }))
      await waitFor(() => expect(app.actions.execute).toHaveBeenCalledWith('a1', 'p1', true))
    } finally {
      confirm.mockRestore()
    }
  })

  it('delivers a new-terminal command once after the chat view is ready, with configured cwd', async () => {
    const action = {
      ...buildAction,
      runMode: 'new-terminal' as const,
      command: 'pnpm dev',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      chat: chatTwo,
      terminalCommand: 'pnpm dev',
      terminalCwd: action.cwd,
    })
    await renderSelectedChat()
    let finishSpawn: ((id: string) => void) | undefined
    vi.mocked(app.terminals.create).mockImplementation((chatId) =>
      chatId === 't2'
        ? new Promise<string>((resolve) => {
            finishSpawn = resolve
          })
        : Promise.resolve(chatId),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe(
        'true',
      ),
    )
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', 'D:/code/demo/app'))
    expect(vi.mocked(app.terminals.write).mock.calls.filter(([id]) => id === 't2')).toHaveLength(0)
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    await act(async () => {
      finishSpawn?.('t2')
    })
    await waitFor(() => expect(app.terminals.write).toHaveBeenCalledWith('t2', 'pnpm dev'))
    expect(app.terminals.write).toHaveBeenCalledWith('t2', '\r')
    expect(vi.mocked(app.terminals.write).mock.calls.filter(([id]) => id === 't2')).toHaveLength(2)
    const subscribedAt = vi.mocked(app.terminals.onData).mock.invocationCallOrder[
      vi.mocked(app.terminals.onData).mock.calls.findIndex(([id]) => id === 't2')
    ]
    const wroteAt = vi.mocked(app.terminals.write).mock.invocationCallOrder[
      vi.mocked(app.terminals.write).mock.calls.findIndex(([id]) => id === 't2')
    ]
    expect(subscribedAt).toBeLessThan(wroteAt)
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
  })

  it('shows a notice when the new-terminal command cannot be written and keeps the chat', async () => {
    const action = {
      ...buildAction,
      runMode: 'new-terminal' as const,
      command: 'pnpm dev',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      chat: chatTwo,
      terminalCommand: 'pnpm dev',
      terminalCwd: action.cwd,
    })
    vi.mocked(app.terminals.write).mockImplementation(async (chatId) => {
      if (chatId === 't2') {
        throw { nekodeAppError: true, code: 'not_found', message: 'Session ended.' }
      }
    })
    await renderSelectedChat()
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Session ended.',
    )
    expect(screen.getByTestId(testIdFor.chatRow('t2'))).toBeTruthy()
    expect(vi.mocked(app.chats.remove)).not.toHaveBeenCalled()
    // Split-write submission: the line, then the CR as its own write.
    expect(vi.mocked(app.terminals.write).mock.calls).toContainEqual(['t2', 'pnpm dev'])
    expect(vi.mocked(app.terminals.write).mock.calls).toContainEqual(['t2', '\r'])
  })

  it('prunes staged new-terminal command when chat closes before terminal is ready', async () => {
    const action = {
      ...buildAction,
      runMode: 'new-terminal' as const,
      command: 'pnpm dev',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      chat: chatTwo,
      terminalCommand: 'pnpm dev',
      terminalCwd: action.cwd,
    })
    await renderSelectedChat()
    let finishSpawn: ((id: string) => void) | undefined
    vi.mocked(app.terminals.create).mockImplementation((chatId) =>
      chatId === 't2'
        ? new Promise<string>((resolve) => {
            finishSpawn = resolve
          })
        : Promise.resolve(chatId),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe(
        'true',
      ),
    )

    // Chat t2 is closed before the terminal finishes spawning / becoming ready
    fireEvent.mouseOver(screen.getByTestId(testIdFor.chatRow('t2')))
    fireEvent.click(screen.getByTestId(testIdFor.chatClose('t2')))
    fireEvent.click(await screen.findByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull())

    // Now spawn resolves late: the staged command must have been pruned, so nothing is written
    await act(async () => {
      finishSpawn?.('t2')
    })
    expect(vi.mocked(app.terminals.write).mock.calls.filter(([id]) => id === 't2')).toHaveLength(0)
  })

  it('prunes staged new-terminal command when its project is removed before terminal is ready', async () => {
    const action = {
      ...buildAction,
      runMode: 'new-terminal' as const,
      command: 'pnpm dev',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      chat: chatTwo,
      terminalCommand: 'pnpm dev',
      terminalCwd: action.cwd,
    })
    await renderSelectedChat()
    let finishSpawn: ((id: string) => void) | undefined
    vi.mocked(app.terminals.create).mockImplementation((chatId) =>
      chatId === 't2'
        ? new Promise<string>((resolve) => {
            finishSpawn = resolve
          })
        : Promise.resolve(chatId),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe(
        'true',
      ),
    )

    // Project p1 is removed while the terminal spawn is still pending
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    // Now spawn resolves late: staged command was pruned, so nothing is written
    await act(async () => {
      finishSpawn?.('t2')
    })
    expect(vi.mocked(app.terminals.write).mock.calls.filter(([id]) => id === 't2')).toHaveLength(0)
  })

  it('delivers a bottom-terminal command into a new bottom tab after it is ready, without changing the selected chat', async () => {
    const action = {
      ...buildAction,
      runMode: 'bottom-terminal' as const,
      command: 'pnpm test',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      bottomTabId: 'bottom:p1:tab-1',
      terminalCommand: 'pnpm test',
      terminalCwd: 'D:/code/demo/app',
    })
    await renderSelectedChat()
    // Hold the new tab's terminal spawn until we know the write waits for it.
    let finishSpawn: ((id: string) => void) | undefined
    vi.mocked(app.terminals.create).mockImplementation((id) =>
      id.startsWith('bottom:')
        ? new Promise<string>((resolve) => {
            finishSpawn = resolve
          })
        : Promise.resolve(id),
    )
    const selectedChatBefore = vi
      .mocked(app.state.set)
      .mock.calls.filter(([key]) => key === APP_STATE_KEY.selectedChatId).length

    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    await waitFor(() => expect(app.actions.execute).toHaveBeenCalledWith('a1', 'p1', false))
    // The panel opened and exactly one new bottom tab exists, selected in the
    // strip. It is not a chat: chats.create never ran, the selection keeps t1.
    await waitFor(() =>
      expect(
        screen.getByTestId(testIdFor.bottomTab('bottom:p1:tab-1')).getAttribute('data-selected'),
      ).toBe('true'),
    )
    expect(bottomRegion().style.display).not.toBe('none')
    expect(app.chats.create).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    const selectedChatAfter = vi
      .mocked(app.state.set)
      .mock.calls.filter(([key]) => key === APP_STATE_KEY.selectedChatId).length
    expect(selectedChatAfter).toBe(selectedChatBefore)
    expect(app.terminals.create).toHaveBeenCalledWith('bottom:p1:tab-1', 'D:/code/demo/app')

    // Before the terminal view is subscribed and ready, nothing is written.
    expect(vi.mocked(app.terminals.write).mock.calls).toHaveLength(0)
    await act(async () => {
      finishSpawn?.('bottom:p1:tab-1')
    })
    // Exact bytes: the command, then CR 0x0D as its own write (split-write
    // submission), each exactly once.
    await waitFor(() =>
      expect(app.terminals.write).toHaveBeenCalledWith('bottom:p1:tab-1', 'pnpm test'),
    )
    expect(app.terminals.write).toHaveBeenCalledWith('bottom:p1:tab-1', '\r')
    expect(vi.mocked(app.terminals.write).mock.calls).toEqual([
      ['bottom:p1:tab-1', 'pnpm test'],
      ['bottom:p1:tab-1', '\r'],
    ])
    const subscribedAt = vi.mocked(app.terminals.onData).mock.invocationCallOrder[
      vi.mocked(app.terminals.onData).mock.calls.findIndex(([id]) => id === 'bottom:p1:tab-1')
    ]
    const wroteAt = vi.mocked(app.terminals.write).mock.invocationCallOrder[
      vi.mocked(app.terminals.write).mock.calls.findIndex(([id]) => id === 'bottom:p1:tab-1')
    ]
    expect(subscribedAt).toBeLessThan(wroteAt)
  })

  it('shows a notice when the bottom-terminal command cannot be written and keeps the tab', async () => {
    const action = {
      ...buildAction,
      runMode: 'bottom-terminal' as const,
      command: 'pnpm test',
      cwd: 'D:/code/demo/app',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    vi.mocked(app.actions.execute).mockResolvedValue({
      status: 'success',
      exitCode: null,
      completedAt: '2026-09-27T15:00:00Z',
      error: null,
      bottomTabId: 'bottom:p1:tab-1',
      terminalCommand: 'pnpm test',
      terminalCwd: 'D:/code/demo/app',
    })
    await renderSelectedChat()
    vi.mocked(app.terminals.write).mockImplementation(async (id) => {
      if (id.startsWith('bottom:')) {
        throw { nekodeAppError: true, code: 'not_found', message: 'Session ended.' }
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build' }))
    expect((await screen.findByTestId(TEST_ID.actionNotice)).textContent).toContain(
      'Session ended.',
    )
    // The failed write leaves the new tab in place (spec Errors).
    expect(screen.getByTestId(testIdFor.bottomTab('bottom:p1:tab-1'))).toBeTruthy()
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('bottom-terminal confirmation cancel creates no tab and does not open the panel', async () => {
    const action = {
      ...buildAction,
      runMode: 'bottom-terminal' as const,
      confirm: true,
      command: 'pnpm test',
    }
    vi.mocked(app.actions.list).mockResolvedValue([action])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await renderSelectedChat()
      fireEvent.click(screen.getByRole('button', { name: 'Build' }))
      expect(confirm).toHaveBeenCalledWith('Run Build?')
      expect(app.actions.execute).not.toHaveBeenCalled()
      expect(bottomRegion().style.display).toBe('none')
      expect(app.terminals.shellName).not.toHaveBeenCalled()
      expect(bottomCreateIds(app)).toEqual([])
    } finally {
      confirm.mockRestore()
    }
  })

  it('keeps global actions and swaps project actions with the active project', async () => {
    const lint = {
      ...buildAction,
      id: 'g1',
      scope: 'global' as const,
      projectId: null,
      title: 'Lint',
      command: 'pnpm lint',
      sortOrder: 0,
    }
    const other = { ...buildAction, id: 'a2', projectId: 'p2', title: 'Test', sortOrder: 2 }
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectNoRuntime])
    vi.mocked(app.actions.list).mockResolvedValue([lint, buildAction, other])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() =>
      expect(
        [...screen.getByTestId(TEST_ID.actionRowSlot).querySelectorAll('button')].map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
      ).toEqual(['Handoff', 'Resume', 'Stop', 'Continue', 'Lint', 'Build']),
    )
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    await waitFor(() =>
      expect(
        [...screen.getByTestId(TEST_ID.actionRowSlot).querySelectorAll('button')].map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
      ).toEqual(['Handoff', 'Resume', 'Stop', 'Continue', 'Lint', 'Test']),
    )
  })

  it('derives the icon picker mode from the stored icon and saves presets and emoji', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    const select = screen.getByTestId(TEST_ID.settingsActionIconSelect)
    // Null icon ("none") is the default; the emoji input stays hidden.
    expect((select as HTMLSelectElement).value).toBe('none')
    expect(screen.queryByTestId(TEST_ID.settingsActionIconEmoji)).toBeNull()
    // A preset name re-opens as that preset and saves the name back.
    fireEvent.change(select, { target: { value: 'build' } })
    expect((select as HTMLSelectElement).value).toBe('build')
    expect(screen.queryByTestId(TEST_ID.settingsActionIconEmoji)).toBeNull()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Build' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm build' } })
    vi.mocked(app.actions.create).mockResolvedValue({ ...buildAction, icon: 'build' })
    vi.mocked(app.actions.list).mockResolvedValue([{ ...buildAction, icon: 'build' }])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.actions.create).toHaveBeenCalledWith(expect.objectContaining({ icon: 'build' })),
    )
    // The action row renders the preset as a glyph, not as text.
    const row = await screen.findByRole('button', { name: 'Build' })
    expect(row.querySelector('svg')).not.toBeNull()
  })

  it('renders a non-palette icon value as a literal custom emoji on the action row', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.actions.list).mockResolvedValue([{ ...buildAction, icon: '🚀' }])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    // The emoji renders literally on the action row, aria-hidden (excluded
    // from the accessible name); the only svg is the status glyph. The
    // reopen-as-custom form contract lives in ActionSettings.test.tsx.
    const row = screen.getByRole('button', { name: 'Build' })
    expect(row.textContent).toContain('🚀')
    expect(row.querySelectorAll('svg')).toHaveLength(1)
  })

  it('validates the form and reflects saved actions immediately', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert').textContent).toContain('Title and command')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Build' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm build' } })
    vi.mocked(app.actions.create).mockResolvedValue(buildAction)
    vi.mocked(app.actions.list).mockResolvedValue([buildAction])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.actions.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Build', command: 'pnpm build' }),
      ),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Build' })).toBeTruthy())
  })

  it('offers Bottom terminal in Run In and saves the bottom-terminal mode', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    const runIn = screen.getByLabelText('Run In') as HTMLSelectElement
    expect([...runIn.options].map((option) => option.value)).toEqual([
      'background',
      'new-terminal',
      'bottom-terminal',
    ])
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tests' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm test' } })
    fireEvent.change(runIn, { target: { value: 'bottom-terminal' } })
    vi.mocked(app.actions.create).mockResolvedValue({
      ...buildAction,
      title: 'Tests',
      command: 'pnpm test',
      runMode: 'bottom-terminal',
    })
    vi.mocked(app.actions.list).mockResolvedValue([
      { ...buildAction, title: 'Tests', command: 'pnpm test', runMode: 'bottom-terminal' },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.actions.create).toHaveBeenCalledWith(
        expect.objectContaining({ runMode: 'bottom-terminal' }),
      ),
    )
    // The saved action's settings row shows the new mode label.
    expect(await screen.findByText('Bottom terminal · project')).toBeTruthy()
  })

  it('edits and deletes actions from Project Settings with immediate row updates', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.actions.list).mockResolvedValue([buildAction])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } })
    vi.mocked(app.actions.update).mockResolvedValue({ ...buildAction, title: 'Test' })
    vi.mocked(app.actions.list).mockResolvedValue([{ ...buildAction, title: 'Test' }])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Test' })).toBeTruthy())
    vi.mocked(app.actions.delete).mockResolvedValue(undefined)
    vi.mocked(app.actions.list).mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Test' })).toBeNull())
  })

  it('gives the next action a sort order past the current maximum after a delete', async () => {
    const gone = { ...buildAction, id: 'a-gone', title: 'Gone', sortOrder: 0 }
    const keep = { ...buildAction, id: 'a-keep', title: 'Keep', sortOrder: 1 }
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.actions.list).mockResolvedValueOnce([gone, keep]).mockResolvedValue([keep])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByRole('button', { name: 'Project Settings' }))
    fireEvent.click(screen.getByTestId(TEST_ID.settingsActionsTab))
    // 'Gone' also names the action-bar button; the row lives in the dialog.
    const goneRow = within(screen.getByRole('dialog')).getByText('Gone').closest('li')
    expect(goneRow).toBeTruthy()
    fireEvent.click(within(goneRow as HTMLElement).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).queryByText('Gone')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Add Action' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Next' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(app.actions.create).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 2 })),
    )
  })

  it('reloads actions after the active project is removed', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    vi.mocked(app.actions.list).mockResolvedValueOnce([buildAction]).mockResolvedValue([])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByRole('button', { name: 'Build' })
    expect(app.actions.list).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))
    await waitFor(() => expect(app.actions.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Build' })).toBeNull())
  })

  it('stops polling when action status is not_found and does not report it', async () => {
    vi.mocked(app.actions.list).mockResolvedValue([buildAction])
    vi.mocked(app.actions.status).mockResolvedValue({
      status: 'running',
      exitCode: null,
      completedAt: null,
      error: null,
    })
    await renderSelectedChat()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Build/ }).getAttribute('data-status')).toBe(
        'running',
      ),
    )
    const reads = vi.mocked(app.actions.status).mock.calls.length
    vi.mocked(app.actions.status).mockRejectedValue({
      nekodeAppError: true,
      code: 'not_found',
      message: 'Action not found.',
    })
    await waitFor(() =>
      expect(vi.mocked(app.actions.status).mock.calls.length).toBeGreaterThan(reads),
    )
    expect(screen.queryByTestId(TEST_ID.actionNotice)).toBeNull()
    const settled = vi.mocked(app.actions.status).mock.calls.length
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700))
    })
    expect(vi.mocked(app.actions.status).mock.calls.length).toBe(settled)
    expect(screen.queryByTestId(TEST_ID.actionNotice)).toBeNull()
  })
})

describe('application shell', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the shell regions with the tab strip, action-row slot and status bar', () => {
    render(<App app={app} />)
    expect(screen.getByTestId(TEST_ID.leftNav)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.tabStrip)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.actionRowSlot)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.centerSurface)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.bottomRegion)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.rightRegion)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.statusBar)).toBeTruthy()
  })

  it('shows the default empty state (UX-UI §6)', async () => {
    render(<App app={app} />)
    const emptyList = getByTestIdString(TEST_ID.emptyProjectList)
    expect(emptyList.textContent).toContain('No projects yet')
    const welcome = getByTestIdString(TEST_ID.welcomeSurface)
    expect(welcome.textContent).toContain('Welcome to NeKode')
    expect(getByTestIdString(TEST_ID.rightRegion).style.display).toBe('none')
    expect(getByTestIdString(TEST_ID.bottomRegion).style.display).toBe('none')
    await Promise.resolve()
    expect(app.projects.list).toHaveBeenCalledTimes(1)
  })

  it('offers an Add Project affordance and resizable handles', () => {
    render(<App app={app} />)
    expect(getByTestIdString(TEST_ID.projectsHeader).textContent).toBe('Projects')
    const addProject = getByTestIdString(TEST_ID.addProjectButton)
    expect(addProject.getAttribute('aria-label')).toBe('Add Project')
    expect(screen.getByTestId(TEST_ID.leftResizeHandle)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.bottomResizeHandle)).toBeTruthy()
  })

  it('keeps the region contract when projects.list rejects', async () => {
    // The preload bridge decodes a rejected invoke into a typed
    // AppErrorPayload; hydration must surface that typed error through the
    // app's error channel (the notice banner) and still settle into the
    // empty-state region contract.
    vi.mocked(app.projects.list).mockRejectedValueOnce(
      new AppError('internal', 'stub rejected', 'projects:list').toPayload(),
    )
    render(<App app={app} />)
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toBe('stub rejected')
    await waitFor(() => expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy())
    expect(screen.getByTestId(TEST_ID.appShell)).toBeTruthy()
  })
})

describe('project and chat data flow', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the real project list and expands a project to its chats', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.textContent).toContain('DEMO')
    expect(screen.queryByTestId(TEST_ID.emptyProjectList)).toBeNull()

    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(chatRow.querySelector('span.truncate')?.textContent).toBe('First chat')
    expect(app.chats.list).toHaveBeenCalledWith('p1')
    // The active project gets the New Chat button (UX-UI §10): no naming form.
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('add-project: dialog result refreshes the list and selects the new project', async () => {
    let resolveInitialList: ((projects: ProjectInfo[]) => void) | null = null
    vi.mocked(app.projects.list)
      .mockImplementationOnce(
        () =>
          new Promise<ProjectInfo[]>((resolve) => {
            resolveInitialList = resolve
          }),
      )
      .mockResolvedValue([projectA])
    vi.mocked(app.projects.add).mockResolvedValue(projectA)

    render(<App app={app} />)
    await act(async () => {
      resolveInitialList?.([])
    })
    expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy()

    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeTruthy()
    expect(app.projects.add).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))
    expect(app.projects.list).toHaveBeenCalledTimes(2)

    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('add-project: cancelling the dialog (null) keeps the default empty state', async () => {
    vi.mocked(app.projects.add).mockResolvedValue(null)

    render(<App app={app} />)
    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))

    expect(screen.getByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(app.projects.list).toHaveBeenCalledTimes(1)
    expect(app.state.set).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add Project' })).toBeTruthy()
  })

  it('welcome surface: the primary action reuses the add-project flow', async () => {
    vi.mocked(app.projects.add).mockResolvedValue(null)

    render(<App app={app} />)
    const welcome = getByTestIdString(TEST_ID.welcomeSurface)
    // The illustration layer is decorative: never announced to screen readers.
    expect(welcome.querySelector('[aria-hidden="true"]')).toBeTruthy()
    fireEvent.click(screen.getByTestId(TEST_ID.welcomeAddProjectButton))
    expect(screen.getByRole('combobox', { name: 'Project location' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
    await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))
  })

  it.each([
    {
      scenario: 'add-project: failures surface the typed error message',
      setup: () => {
        vi.mocked(app.projects.add).mockRejectedValue({
          nekodeAppError: true,
          code: 'conflict',
          message: 'This directory is already registered as a project.',
        })
      },
      action: async () => {
        fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
        fireEvent.click(screen.getByRole('button', { name: 'Choose folder...' }))
      },
      assert: async () => {
        const notice = await screen.findByRole('alert')
        expect(notice.textContent).toContain('already registered')
      },
    },
    {
      scenario: 'new-chat: failures surface the typed error message and keep the affordance',
      setup: () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.chats.create).mockRejectedValue({
          nekodeAppError: true,
          code: 'not_found',
          message: 'Project not found.',
        })
      },
      action: async () => {
        fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
        fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))
      },
      assert: async () => {
        const notice = await screen.findByTestId(TEST_ID.actionNotice)
        expect(notice.textContent).toContain('Project not found.')
        expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
      },
    },
    {
      scenario: 'open-in-file-explorer failures surface the typed error message as a notice',
      setup: () => {
        vi.mocked(app.projects.list).mockResolvedValue([projectA])
        vi.mocked(app.files.openRoot).mockRejectedValue({
          nekodeAppError: true,
          code: 'not_found',
          message: 'Project not found.',
        })
      },
      action: async () => {
        fireEvent.contextMenu(await screen.findByTestId(testIdFor.projectRow('p1')))
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Open in file explorer' }))
      },
      assert: async () => {
        const notice = await screen.findByTestId(TEST_ID.actionNotice)
        expect(notice.textContent).toContain('Project not found.')
      },
    },
  ])('$scenario', async ({ setup, action, assert }) => {
    setup()
    render(<App app={app} />)
    await action()
    await assert()
  })

  it('add-project: the shared dialog adds WSL and selects it through the existing flow', async () => {
    vi.mocked(app.projects.wslDistributions).mockResolvedValue(['Ubuntu'])
    vi.mocked(app.projects.addWsl).mockResolvedValue(projectA)
    vi.mocked(app.projects.list).mockResolvedValueOnce([]).mockResolvedValue([projectA])
    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.emptyProjectList)
    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    expect(screen.queryByRole('button', { name: 'Add WSL Project' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Project location'), { target: { value: 'wsl' } })
    await screen.findByRole('option', { name: 'Ubuntu' })
    fireEvent.change(screen.getByLabelText('Linux project directory'), {
      target: { value: '/home/user/project' },
    })
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add Project' })).getByRole('button', {
        name: 'Add Project',
      }),
    )
    await waitFor(() =>
      expect(app.projects.addWsl).toHaveBeenCalledWith('Ubuntu', '/home/user/project'),
    )
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(row.getAttribute('data-selected')).toBe('true')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add Project' })).toBeNull())
    expect(app.projects.add).not.toHaveBeenCalled()
  })

  it('add-project: modal blocks workspace shortcuts until it closes', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    const bottomDisplay = screen.getByTestId(TEST_ID.bottomRegion).style.display
    fireEvent.click(screen.getByTestId(TEST_ID.addProjectButton))
    const dialog = screen.getByRole('dialog', { name: 'Add Project' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    for (const code of ['Backquote', 'Tab', 'KeyN']) {
      fireEvent.keyDown(window, { code, ctrlKey: true, bubbles: true, cancelable: true })
    }
    expect(app.chats.create).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.bottomRegion).style.display).toBe(bottomDisplay)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe(
        'true',
      ),
    )
    fireEvent.keyDown(window, { code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    fireEvent.keyDown(window, { code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true })
    expect(screen.getByTestId(TEST_ID.bottomRegion).style.display).not.toBe(bottomDisplay)
  })

  it('new-chat: creates the chat immediately (no naming form) and selects it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.chats.create).mockResolvedValue(chatTwo)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    // No name is typed anywhere: the button creates the chat right away and
    // main derives the name from the shell (spec Behaviour 3).
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))

    await screen.findByTestId(testIdFor.chatRow('t2'))
    expect(app.chats.create).toHaveBeenCalledWith('p1')
    expect(app.chats.create).toHaveBeenCalledTimes(1)
    const chatRow = getByTestIdString(testIdFor.chatRow('t2'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  it('new-chat: two chats may carry the same name (shell label, duplicates allowed)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    // Both chats share the same shell-derived name.
    vi.mocked(app.chats.create)
      .mockResolvedValueOnce({ id: 't1', projectId: 'p1', name: 'PowerShell' })
      .mockResolvedValueOnce({ id: 't2', projectId: 'p1', name: 'PowerShell' })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const chats = await screen.findByTestId(testIdFor.projectChats('p1'))
    expect(chats.textContent).toBe('No chats')
    expect(within(chats).queryByRole('list')).toBeNull()
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(within(chats).queryByText('No chats')).toBeNull()
    fireEvent.click(screen.getByTestId(TEST_ID.newChatButton))
    await screen.findByTestId(testIdFor.chatRow('t2'))

    expect(
      screen.getByTestId(testIdFor.chatRow('t1')).querySelector('span.truncate')?.textContent,
    ).toBe('PowerShell')
    expect(
      screen.getByTestId(testIdFor.chatRow('t2')).querySelector('span.truncate')?.textContent,
    ).toBe('PowerShell')
    expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true')
  })

  it('Start new chat expands a collapsed project so the new chat row is visible', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't9',
      projectId: 'p1',
      name: 'PowerShell',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    // An empty selected project shows the "Start new chat" empty state
    // (spec Behaviour 11)…
    await screen.findByTestId(TEST_ID.startNewChatState)
    // …and the user collapses the project node by clicking its title (the
    // selected project's title toggles the subtree): it unmounts.
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    expect(screen.queryByTestId(testIdFor.projectChats('p1'))).toBeNull()

    fireEvent.click(screen.getByTestId(TEST_ID.startNewChatButton))
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    // The chat is created and selected — and its row must be visible in the
    // tree: creating a chat re-expands its project node (spec Behaviour 3).
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t9'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(testIdFor.projectChats('p1'))).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it.each([false, true])(
    'blank Projects space opens Add Project through the existing dialog (has projects: %s)',
    async (hasProjects) => {
      vi.mocked(app.projects.list).mockResolvedValue(hasProjects ? [projectA] : [])
      render(<App app={app} />)
      if (hasProjects) await screen.findByTestId(testIdFor.projectRow('p1'))
      else await screen.findByTestId(TEST_ID.emptyProjectList)
      const area = screen.getByTestId(TEST_ID.projectListArea)

      fireEvent.click(area)
      expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
      fireEvent.contextMenu(hasProjects ? area : screen.getByTestId(TEST_ID.emptyProjectList), {
        clientX: 40,
        clientY: 60,
      })
      const menu = screen.getByRole('menu', { name: 'Projects' })
      const action = within(menu).getByRole('menuitem', { name: 'Add Project' })
      expect(document.activeElement).toBe(action)
      expect(action.parentElement?.style.left).toBe('40px')
      expect(action.parentElement?.style.top).toBe('60px')
      expect(app.projects.add).not.toHaveBeenCalled()
      expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)

      fireEvent.click(action)
      expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
      const dialog = await screen.findByRole('dialog', { name: 'Add Project' })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Choose folder...' }))
      await waitFor(() => expect(app.projects.add).toHaveBeenCalledTimes(1))
    },
  )

  it('blank Projects menu supports keyboard opening, dismissal, focus return, and edge positioning', async () => {
    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.emptyProjectList)
    const area = screen.getByTestId(TEST_ID.projectListArea)
    area.focus()
    fireEvent.keyDown(area, { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Projects' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    expect(document.activeElement).toBe(area)

    fireEvent.keyDown(area, { key: 'F10', shiftKey: true })
    fireEvent.click(screen.getByRole('menu', { name: 'Projects' }))
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    fireEvent.contextMenu(area, { clientX: window.innerWidth, clientY: window.innerHeight })
    const action = screen.getByRole('menuitem', { name: 'Add Project' })
    expect(Number.parseFloat(action.parentElement?.style.left ?? '')).toBeLessThan(
      window.innerWidth - 160,
    )
    expect(Number.parseFloat(action.parentElement?.style.top ?? '')).toBeLessThan(
      window.innerHeight - 40,
    )
    fireEvent.contextMenu(screen.getByRole('menu', { name: 'Projects' }))
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    expect(app.projects.add).not.toHaveBeenCalled()
  })

  it('blank Projects gestures preserve row and New Chat menus and ignore chat rows', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    render(<App app={app} />)
    const row = await screen.findByTestId(testIdFor.projectRow('p1'))
    fireEvent.contextMenu(row)
    expect(screen.getByRole('menuitem', { name: 'Project Settings' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    fireEvent.contextMenu(await screen.findByTestId(testIdFor.chatRow('t1')))
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    fireEvent.contextMenu(screen.getByTestId(TEST_ID.newChatButton))
    expect(screen.getByRole('menu', { name: 'New chat with agent' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: 'Projects' })).toBeNull()
    fireEvent.keyDown(screen.getByTestId(TEST_ID.projectListArea), { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Projects' })).toBeTruthy()
    expect(screen.queryByRole('menu', { name: 'New chat with agent' })).toBeNull()
    expect(app.chats.create).not.toHaveBeenCalled()
  })

  it('project context menu offers Open in file explorer and calls files.openRoot', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    render(<App app={app} />)

    fireEvent.contextMenu(await screen.findByTestId(testIdFor.projectRow('p1')))
    const menu = await screen.findByTestId(TEST_ID.projectContextMenu)
    expect(menu.textContent).toContain('Open in file explorer')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in file explorer' }))
    await waitFor(() => expect(app.files.openRoot).toHaveBeenCalledWith('p1'))
    // The menu closes after the action runs.
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.projectContextMenu)).toBeNull())
  })

  // New Chat agent profile menu (spec new-chat-agent-menu). The menu is opened
  // on the left panel's per-project New Chat button; a plain left click keeps
  // the existing chat flow (covered by the new-chat tests above).
  async function openAgentMenu(): Promise<HTMLElement> {
    fireEvent.contextMenu(await screen.findByTestId(TEST_ID.newChatButton))
    return screen.findByTestId(TEST_ID.newChatAgentMenu)
  }

  it('new-chat agent menu: right click lists the project profiles and creates no chat', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile, claudeProfile],
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.contextMenu(await screen.findByTestId(TEST_ID.newChatButton), {
      clientX: 40,
      clientY: 60,
    })

    const menu = await screen.findByTestId(TEST_ID.newChatAgentMenu)
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.newChatAgentProfile('prof-1')).textContent).toBe('Codex'),
    )
    // Stored document order, one item per profile, from this project's document.
    expect(screen.getByTestId(testIdFor.newChatAgentProfile('prof-2')).textContent).toBe('Claude')
    expect(app.agentProfiles.get).toHaveBeenCalledWith('p1')
    // The pointer gesture positions the menu at the pointer.
    expect(menu.style.left).toBe('40px')
    expect(menu.style.top).toBe('60px')
    // The gesture itself creates no chat.
    expect(app.chats.create).not.toHaveBeenCalled()
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: ContextMenu / Shift+F10 opens it below the button, Escape and outside click close it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile],
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const button = await screen.findByTestId(TEST_ID.newChatButton)
    // jsdom reports a zero rect; the button's real geometry decides the
    // keyboard position (below the button).
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      x: 12,
      y: 10,
      top: 10,
      left: 12,
      right: 100,
      bottom: 34,
      width: 88,
      height: 24,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.keyDown(button, { key: 'ContextMenu' })
    const menu = await screen.findByTestId(TEST_ID.newChatAgentMenu)
    expect(menu.style.left).toBe('12px')
    expect(menu.style.top).toBe('34px')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull())

    fireEvent.keyDown(button, { key: 'F10', shiftKey: true })
    const reopened = await screen.findByTestId(TEST_ID.newChatAgentMenu)
    // An outside click (the backdrop) closes it.
    fireEvent.click(reopened.parentElement as HTMLElement)
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull())
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: a keyboard gesture closes the other menu first', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile],
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    // The project-row menu is open (spec Behaviour 7: one menu at a time)…
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    expect(await screen.findByTestId(TEST_ID.projectContextMenu)).toBeTruthy()

    // …and a keyboard gesture on the New Chat button swaps it for the agent
    // menu instead of stacking a second overlay on top.
    fireEvent.keyDown(screen.getByTestId(TEST_ID.newChatButton), { key: 'ContextMenu' })
    expect(await screen.findByTestId(TEST_ID.newChatAgentMenu)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.projectContextMenu)).toBeNull()

    // The other direction: a keyboard gesture on the project row closes the
    // agent menu and opens the project menu.
    fireEvent.keyDown(screen.getByTestId(testIdFor.projectRow('p1')), { key: 'ContextMenu' })
    expect(await screen.findByTestId(TEST_ID.projectContextMenu)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull()
  })

  it('new-chat agent menu: choosing a profile creates and adopts the agent chat', async () => {
    const agentChat: ChatInfo = {
      id: 'a7',
      projectId: 'p1',
      name: '[PowerShell] Codex',
      agentName: 'Codex',
    }
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile, claudeProfile],
    })
    vi.mocked(app.chats.createWithAgent).mockResolvedValue(agentChat)

    render(<App app={app} />)
    await openAgentMenu()
    fireEvent.click(await screen.findByTestId(testIdFor.newChatAgentProfile('prof-1')))

    await waitFor(() => expect(app.chats.createWithAgent).toHaveBeenCalledWith('p1', 'prof-1'))
    // One gesture, one chat: the menu is gone before the launch resolves.
    expect(app.chats.createWithAgent).toHaveBeenCalledTimes(1)
    expect(app.chats.create).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull())
    // Adopted like a Kanban Start chat: selected, project expanded, terminal
    // tab active.
    const row = await screen.findByTestId(testIdFor.chatRow('a7'))
    expect(row.getAttribute('data-selected')).toBe('true')
    expect(row.getAttribute('aria-label')).toContain('Codex, Codex, idle')
    expect(within(row).getAllByText('Codex')).toHaveLength(2)
    expect(screen.getByTestId(testIdFor.projectChats('p1'))).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('[PowerShell] Codex')
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 'a7')
  })

  it('restores persisted Kanban identity into navigation on startup', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([
      {
        id: 'restored',
        projectId: 'p1',
        name: '[PS7] Old profile name',
        taskRef: 'NEKODE-42',
        agentName: 'Claude',
      },
    ])
    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const row = await screen.findByTestId(testIdFor.chatRow('restored'))
    expect(within(row).getByText('NEKODE-42')).toBeTruthy()
    expect(within(row).getByText('Claude')).toBeTruthy()
    expect(row.textContent).not.toContain('Old profile name')
  })

  it('new-chat agent menu: no profiles offers Configure agents and opens the Agents settings', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({ defaultId: null, profiles: [] })

    render(<App app={app} />)
    await openAgentMenu()
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatAgentConfigure))

    // Project Settings on the Agents tab, and no chat of any kind.
    const agentsTab = await screen.findByTestId(TEST_ID.settingsAgentsTab)
    expect(agentsTab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('dialog', { name: 'Project Settings' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull())
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
    expect(app.chats.create).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: with profiles loaded, Add profile at the bottom opens the Agents settings', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile],
    })

    render(<App app={app} />)
    await openAgentMenu()
    expect(await screen.findByTestId(testIdFor.newChatAgentProfile('prof-1'))).toBeTruthy()
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatAgentConfigure))

    const agentsTab = await screen.findByTestId(TEST_ID.settingsAgentsTab)
    expect(agentsTab.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('dialog', { name: 'Project Settings' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.newChatAgentMenu)).toBeNull())
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
    expect(app.chats.create).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: the loading row shows while the profiles are read, then the names', async () => {
    let release: (document: AgentProfilesDocument) => void = () => undefined
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockReturnValue(
      new Promise<AgentProfilesDocument>((resolve) => {
        release = resolve
      }),
    )

    render(<App app={app} />)
    await openAgentMenu()

    // Non-actionable loading row: nothing can be chosen yet.
    expect(screen.getByTestId(TEST_ID.newChatAgentMenuLoading).textContent).toBe('Loading…')
    expect(screen.queryByRole('menuitem')).toBeNull()
    await act(async () => {
      release({ defaultId: null, profiles: [codexProfile] })
    })
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.newChatAgentProfile('prof-1')).textContent).toBe('Codex'),
    )
    expect(screen.queryByTestId(TEST_ID.newChatAgentMenuLoading)).toBeNull()
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: a failed profile load shows the failure row and creates no chat', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockRejectedValue({
      nekodeAppError: true,
      code: 'unknown',
      message: 'Database error.',
    })

    render(<App app={app} />)
    await openAgentMenu()

    const failure = await screen.findByTestId(TEST_ID.newChatAgentMenuError)
    expect(failure.textContent).toBe('Failed to load agent profiles.')
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(app.chats.createWithAgent).not.toHaveBeenCalled()
  })

  it('new-chat agent menu: a failed launch surfaces a typed notice and keeps the affordance', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.agentProfiles.get).mockResolvedValue({
      defaultId: null,
      profiles: [codexProfile, claudeProfile],
    })
    vi.mocked(app.chats.createWithAgent).mockRejectedValueOnce({
      nekodeAppError: true,
      code: 'not_found',
      message: 'The selected agent profile is no longer available.',
    })

    render(<App app={app} />)
    await openAgentMenu()
    fireEvent.click(await screen.findByTestId(testIdFor.newChatAgentProfile('prof-1')))

    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('The selected agent profile is no longer available.')
    expect(screen.queryByTestId(testIdFor.chatRow('t9'))).toBeNull()
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()

    // An unclassified failure falls back to the launch's own message; no chat
    // is ever adopted for a failed launch.
    vi.mocked(app.chats.createWithAgent).mockRejectedValueOnce(new Error('EPERM: spawn'))
    await openAgentMenu()
    fireEvent.click(await screen.findByTestId(testIdFor.newChatAgentProfile('prof-2')))
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.actionNotice).textContent).toContain(
        'Failed to start the agent chat.',
      ),
    )
    expect(screen.queryByTestId(testIdFor.chatRow('t9'))).toBeNull()
  })

  it('remove-project: falls back to the default empty state and drops removed data', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))

    // Removal is reachable only from the row context menu (spec Behaviour 3).
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    expect(await screen.findByTestId(TEST_ID.emptyProjectList)).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.welcomeSurface)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.statusProjectName)).toBeNull()
    expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull()
    expect(app.projects.list).toHaveBeenCalledTimes(2)
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('remove-project: keeps the current selection when a different project is removed', async () => {
    vi.mocked(app.projects.list)
      .mockResolvedValueOnce([projectA, projectNoRuntime])
      .mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')

    vi.mocked(app.state.set).mockClear()
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p2')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p2')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p2'))
    await waitFor(() => expect(app.projects.list).toHaveBeenCalledTimes(2))

    expect(screen.queryByTestId(testIdFor.projectRow('p2'))).toBeNull()
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, '')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('remove-project: does not clear selection if user switched projects while removal was in flight', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectNoRuntime])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [chatOtherProject],
    )
    let resolveRemove: (() => void) | undefined
    vi.mocked(app.projects.remove).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve
        }),
    )

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')

    // Start removing p1
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    // While removal is in flight, user selects p2
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p2')))
    expect(getByTestIdString(testIdFor.projectRow('p2')).getAttribute('data-selected')).toBe('true')

    // Now removal of p1 settles
    vi.mocked(app.projects.list).mockResolvedValue([projectNoRuntime])
    await act(async () => {
      resolveRemove?.()
    })

    // p2 must STILL be selected, not wiped to null!
    await waitFor(() => {
      expect(getByTestIdString(testIdFor.projectRow('p2')).getAttribute('data-selected')).toBe(
        'true',
      )
    })
  })

  it('remove-project: clears selection if user switched to the project being removed while removal was in flight', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA, projectNoRuntime])
    vi.mocked(app.chats.list).mockImplementation(async (projectId) =>
      projectId === 'p1' ? [chatOne] : [chatOtherProject],
    )
    let resolveRemove: (() => void) | undefined
    vi.mocked(app.projects.remove).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve
        }),
    )

    render(<App app={app} />)
    // Initially select p2
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p2')))
    await screen.findByTestId(testIdFor.chatRow('u1'))
    expect(getByTestIdString(testIdFor.projectRow('p2')).getAttribute('data-selected')).toBe('true')

    // Start removing p1
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    // While removal is in flight, user selects p1
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')

    // Now removal of p1 settles
    vi.mocked(app.projects.list).mockResolvedValue([projectNoRuntime])
    await act(async () => {
      resolveRemove?.()
    })

    // p1 was removed, so selection must be cleared to null, NOT left dangling on p1!
    await waitFor(() => {
      expect(screen.queryByTestId(testIdFor.projectRow('p1'))).toBeNull()
      expect(screen.queryByTestId(TEST_ID.statusProjectName)).toBeNull()
    })
  })

  it('writes the selection keys on every selection change', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')

    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedProjectId, 'p1')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')
  })

  it('hydrates the persisted selection without rewriting it', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't1'
      return null
    })

    render(<App app={app} />)
    const chatRow = await screen.findByTestId(testIdFor.chatRow('t1'))
    expect(chatRow.getAttribute('data-selected')).toBe('true')
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe('true')
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(app.state.set).not.toHaveBeenCalled()
  })

  it('drops a stale persisted selection pointing at a removed project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p-gone'
      if (key === APP_STATE_KEY.selectedChatId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    expect(getByTestIdString(testIdFor.projectRow('p1')).getAttribute('data-selected')).toBe(
      'false',
    )
    expect(screen.queryByTestId(TEST_ID.statusProjectName)).toBeNull()
    const row = screen.getByTestId(testIdFor.projectRow('p1'))
    const newChat = within(row).getByRole('button', { name: 'New chat' })
    expect(newChat.textContent).toBe('')
    expect(newChat.nextElementSibling).toBe(screen.getByTestId(testIdFor.projectFiles('p1')))
    expect(app.chats.list).not.toHaveBeenCalled()
  })

  it('drops a stale persisted chat but keeps the valid project', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return 't-gone'
      return null
    })

    render(<App app={app} />)
    await screen.findByTestId(TEST_ID.statusProjectName)
    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('false')
    expect(screen.getByTestId(TEST_ID.newChatButton)).toBeTruthy()
  })

  it('renders the project name, absolute path and runtime label in the status bar', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    expect(screen.getByTestId(TEST_ID.statusProjectName).textContent).toBe('Demo')
    expect(screen.getByTestId(TEST_ID.statusProjectPath).textContent).toBe('D:/code/demo')
    expect(screen.getByTestId(TEST_ID.statusRuntimes).textContent).toContain('Node 24')
  })

  it('hydrates region sizes from persisted state', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.leftRegionWidth) return '340'
      if (key === APP_STATE_KEY.bottomRegionHeight) return '300'
      return null
    })

    render(<App app={app} />)
    await waitFor(() => {
      expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('340px')
    })
    expect(app.state.get).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth)
    expect(app.state.get).toHaveBeenCalledWith(APP_STATE_KEY.bottomRegionHeight)
  })

  it('falls back to default region sizes for unparsable persisted values', async () => {
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.leftRegionWidth) return 'not-a-size'
      return null
    })

    render(<App app={app} />)
    await waitFor(() => expect(app.projects.list).toHaveBeenCalledTimes(1))
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('280px')
  })

  it('persists the left region width when the resize ends', () => {
    render(<App app={app} />)
    const handle = screen.getByTestId(TEST_ID.leftResizeHandle)
    firePointer(handle, 'pointerdown', { clientX: 280 })
    firePointer(handle, 'pointermove', { clientX: 350 })
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, expect.anything())

    firePointer(handle, 'pointerup', { clientX: 350 })
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, '350')
  })
})

describe('chat workspace (Stage 3)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('chat selection opens the chat workspace with the primary terminal', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))

    const workspace = getByTestIdString(TEST_ID.chatWorkspace)
    // The chat name lives in the terminal-chat tab label (tab model).
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('First chat')
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    expect(workspace).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    // Lazy spawn on first attach: one PTY, cwd = the project directory.
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
  })

  it('switching chats keeps both sessions (no respawn for the first chat)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    // Back to chat one: the same session is re-attached, not re-created.
    await waitFor(() => expect(screen.getByTestId(TEST_ID.chatWorkspace)).toBeTruthy())
    expect(app.terminals.create).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      scenario: 'shows the git branch and worktree status in the status bar (UX-UI §16)',
      status: {
        branch: 'feature/meta-pixel',
        dirty: true,
        worktree: { ...emptyGitWorktree(), modified: 4, added: 2, untracked: 1, ahead: 3 },
      },
    },
    {
      scenario: 'shows a clean worktree status',
      status: { branch: 'main', dirty: false, worktree: emptyGitWorktree() },
    },
  ])('$scenario', async ({ status }) => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.git.getStatus).mockResolvedValue(status)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    // App-level wiring only: the fetched git status reaches the status bar.
    // The worktree form strings are owned by StatusBar.test.tsx.
    await waitFor(() => expect(app.git.getStatus).toHaveBeenCalledWith('p1'))
    expect((await screen.findByTestId(TEST_ID.statusGitBranch)).textContent).toContain(
      status.branch,
    )
    expect(screen.getByTestId(TEST_ID.statusGitStatus)).toBeTruthy()
  })
})

describe('resize persistence refinements (Stage 3 carry-over)', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('supports keyboard resize via the separator handle (a11y)', () => {
    render(<App app={app} />)
    const handle = screen.getByTestId(TEST_ID.leftResizeHandle)
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-valuenow')).toBe('280')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('296px')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.leftRegionWidth, '296')

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(getByTestIdString(TEST_ID.leftNav).style.width).toBe('280px')
  })

  it('surfaces state.set rejections in the notice banner (spec Errors)', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.set).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Database is locked.',
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database is locked.')
  })
})

describe('chat closing on terminal exit (Stage 4)', () => {
  let app: AppApi
  let exitListenersByChat: Map<string, Set<(exitCode: number) => void>>

  function emitExit(chatId: string, exitCode: number): void {
    act(() => {
      for (const listener of [...(exitListenersByChat.get(chatId) ?? [])]) {
        listener(exitCode)
      }
    })
  }

  beforeEach(() => {
    app = createAppApiStub()
    exitListenersByChat = new Map()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(app.terminals.onExit).mockImplementation(
      (chatId: string, callback: (exitCode: number) => void) => {
        const listeners = exitListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        exitListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
  })

  afterEach(() => {
    cleanup()
  })

  async function renderWithChats(chats: ChatInfo[], selectedChatId: string | null) {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue(chats)
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return selectedChatId
      return null
    })
    const view = render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    return view
  }

  it('terminal exit disposes the view, removes the chat and selects the next chat', async () => {
    const { unmount } = await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const firstTerminal = mockTerminalInstances[0]

    // `exit` in the chat terminal: the chat closes (spec Behaviour 11).
    emitExit('t1', 0)

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    // The terminal view is disposed with the close.
    await waitFor(() => expect(firstTerminal.dispose).toHaveBeenCalledTimes(1))
    // The chat disappears from the tree…
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    // …and the app continues on the next chat of the project in tree order.
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true'),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
    unmount()
  })

  it('Ctrl+D at an empty input line closes the chat like a terminal exit (spec AC9)', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    const terminal = mockTerminalInstances[0]
    expect(terminal.keyHandler).not.toBeNull()

    // PowerShell does not end on Ctrl+D: the app intercepts the shortcut at an
    // empty input line and runs the same close flow as a terminal exit.
    act(() => {
      const allowed = (terminal.keyHandler as (event: KeyboardEvent) => boolean)(
        new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }),
      )
      expect(allowed).toBe(false)
    })

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true'),
    )
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  it('closing the last chat selects the previous one, then the Start new chat state', async () => {
    await renderWithChats([chatOne, chatTwo], 't2')
    await waitFor(() => expect(exitListenersByChat.get('t2')?.size).toBe(1))

    // The closed chat was last in tree order: the previous chat is selected.
    emitExit('t2', 0)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull())
    await waitFor(() =>
      expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true'),
    )

    // Closing that one too leaves the project without chats: the empty state
    // offers "Start new chat" (spec Behaviour 11).
    // Selection can render before the terminal subscribes to its exit event.
    await waitFor(() => expect(exitListenersByChat.get('t1')?.size).toBe(1))
    emitExit('t1', 0)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    const emptyState = await screen.findByTestId(TEST_ID.startNewChatState)
    expect(emptyState.textContent).toContain('Welcome to NeKode')
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')

    // The affordance creates a chat immediately (spec Behaviour 3 — no form).
    vi.mocked(app.chats.create).mockResolvedValue({
      id: 't3',
      projectId: 'p1',
      name: 'PowerShell',
    })
    fireEvent.click(screen.getByTestId(TEST_ID.startNewChatButton))
    await waitFor(() => expect(app.chats.create).toHaveBeenCalledWith('p1'))
    await screen.findByTestId(testIdFor.chatRow('t3'))
    expect(getByTestIdString(testIdFor.chatRow('t3')).getAttribute('data-selected')).toBe('true')
  })

  it('a background chat that exits is removed without stealing the selection', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))

    // Chat one's hidden terminal exits on its own: the chat closes (removed
    // from the tree and the database) but the viewed chat stays selected.
    emitExit('t1', 3)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't1')
  })

  it('closing a chat surfaces a typed error when the removal fails', async () => {
    vi.mocked(app.chats.remove).mockRejectedValue({
      nekodeAppError: true,
      code: 'sqlite',
      message: 'Database error.',
    })
    await renderWithChats([chatOne], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    emitExit('t1', 0)
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database error.')
  })

  it('quit does not remove chats: unmounting the app never calls chats.remove', async () => {
    const { unmount } = await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    // Application quit terminates PTYs in main and suppresses the exit events
    // that would start this close flow (spec Behaviour 8). Window teardown in
    // the renderer must not remove chats either — the tree and the database
    // survive the restart unchanged (spec Behaviours 8, 10).
    unmount()
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('two chats exiting in the same tick leave no dead selection (Start new chat)', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))
    // Open a session for the second chat as well, then look at the first.
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t2')))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))

    // Both chat shells end in the same tick (near-simultaneous exits).
    act(() => {
      for (const listener of [...(exitListenersByChat.get('t1') ?? [])]) {
        listener(0)
      }
      for (const listener of [...(exitListenersByChat.get('t2') ?? [])]) {
        listener(0)
      }
    })

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(2))
    // The project is left without chats: the center surface shows the
    // "Start new chat" empty state — never a dead area caused by a selection
    // pointing at a chat that the other close flow already removed.
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull()
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.welcomeSurface)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.chatWorkspace)).toBeNull()
    // The persisted selection is cleared instead of keeping the dead id.
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, '')
  })

  it('a failed removal leaves the chat closable: the next terminal exit closes it', async () => {
    vi.mocked(app.chats.remove)
      .mockRejectedValueOnce({
        nekodeAppError: true,
        code: 'sqlite',
        message: 'Database error.',
      })
      .mockResolvedValue(undefined)
    await renderWithChats([chatOne], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    // First exit: the removal fails, so the chat stays in the tree…
    emitExit('t1', 0)
    const notice = await screen.findByTestId(TEST_ID.actionNotice)
    expect(notice.textContent).toContain('Database error.')
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(1))
    // …and its workspace remains visible with a restored session without needing manual re-selection.
    await waitFor(() => expect(screen.getByTestId(testIdFor.terminalView('t1'))).toBeTruthy())
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(2))
    emitExit('t1', 0)

    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(await screen.findByTestId(TEST_ID.startNewChatState)).toBeTruthy()
  })
})

describe('chat row close control with confirmation (2026-10-04)', () => {
  let app: AppApi

  async function renderWithChats(chats: ChatInfo[], selectedChatId: string | null) {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue(chats)
    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === APP_STATE_KEY.selectedProjectId) return 'p1'
      if (key === APP_STATE_KEY.selectedChatId) return selectedChatId
      return null
    })
    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectRow('p1'))
    await screen.findByTestId(testIdFor.chatRow(chats[0]?.id ?? ''))
  }

  beforeEach(() => {
    app = createAppApiStub()
  })

  afterEach(() => {
    cleanup()
  })

  it('the hover X opens the confirmation dialog; nothing is removed before confirming', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    // Hover reveals the row's close control (RTL: mouseOver drives React's
    // onMouseEnter synthesis).
    fireEvent.mouseOver(screen.getByTestId(testIdFor.chatRow('t1')))
    const closeButton = screen.getByTestId(testIdFor.chatClose('t1'))
    expect(closeButton).toBeTruthy()

    fireEvent.click(closeButton)
    const dialog = await screen.findByTestId(TEST_ID.confirmDialog)
    expect(dialog.textContent).toContain('First chat')
    // The destructive action is gated: no removal, no tree change yet.
    expect(app.chats.remove).not.toHaveBeenCalled()
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    // The close continues like a terminal exit (spec Behaviour 11): the chat
    // leaves the tree and the next chat is selected.
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())
    expect(getByTestIdString(testIdFor.chatRow('t2')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  /**
   * jsdom computes no Tailwind styles, so the close control's reveal state is
   * visible only through the display utility the chat row toggles
   * (LeftNavigation.tsx: `flex` revealed, `hidden` otherwise). One named pair
   * centralizes that jsdom limitation; a computed-style or E2E check would
   * observe the real visibility instead.
   */
  const CLOSE_REVEALED_CLASS = 'flex'
  const CLOSE_HIDDEN_CLASS = 'hidden'

  it('moving the pointer onto the revealed close control does not flicker it', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    // Hover reveals the control (RTL: mouseOver drives onMouseEnter, mouseOut
    // drives onMouseLeave).
    const row = screen.getByTestId(testIdFor.chatRow('t1'))
    fireEvent.mouseOver(row)
    const closeButton = screen.getByTestId(testIdFor.chatClose('t1'))
    expect(closeButton.className).toContain(CLOSE_REVEALED_CLASS)

    // The pointer lands on the overlay control itself: the reveal must hold.
    // The X is a sibling of the row button, so the leave boundary is the whole
    // tile; a row-level leave would hide the X, re-enter the row and loop.
    fireEvent.mouseOut(row, { relatedTarget: closeButton })
    expect(closeButton.className).toContain(CLOSE_REVEALED_CLASS)

    // Leaving the tile entirely still hides it.
    fireEvent.mouseOut(row, { relatedTarget: document.body })
    expect(closeButton.className).toContain(CLOSE_HIDDEN_CLASS)
  })

  it('reveals close control on row focus and keeps it revealed when focus shifts to close control (review 7.4)', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    const row = screen.getByTestId(testIdFor.chatRow('t1'))
    const closeButton = screen.getByTestId(testIdFor.chatClose('t1'))
    const li = row.closest('li')
    expect(li).not.toBeNull()
    if (li === null) return

    // Focus row button: reveals close control.
    fireEvent.focus(row)
    expect(closeButton.className).toContain(CLOSE_REVEALED_CLASS)

    // Shift focus to close control inside the same li: remains revealed.
    fireEvent.blur(row, { relatedTarget: closeButton })
    fireEvent.focus(closeButton)
    expect(closeButton.className).toContain(CLOSE_REVEALED_CLASS)

    // Shift focus outside the li: hides close control.
    fireEvent.blur(li, { relatedTarget: document.body })
    expect(closeButton.className).toContain(CLOSE_HIDDEN_CLASS)
  })

  it('cancel keeps the chat and the dialog does not linger', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    fireEvent.mouseOver(screen.getByTestId(testIdFor.chatRow('t1')))
    fireEvent.click(screen.getByTestId(testIdFor.chatClose('t1')))
    await screen.findByTestId(TEST_ID.confirmDialog)

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogCancel))
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('Escape dismisses the dialog without closing the chat', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    fireEvent.mouseOver(screen.getByTestId(testIdFor.chatRow('t1')))
    fireEvent.click(screen.getByTestId(testIdFor.chatClose('t1')))
    const dialog = await screen.findByTestId(TEST_ID.confirmDialog)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.confirmDialog)).toBeNull())
    expect(screen.getByTestId(testIdFor.chatRow('t1'))).toBeTruthy()
    expect(app.chats.remove).not.toHaveBeenCalled()
  })

  it('the close control on a background row neither selects it nor steals the selection', async () => {
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledTimes(1))

    fireEvent.mouseOver(screen.getByTestId(testIdFor.chatRow('t2')))
    fireEvent.click(screen.getByTestId(testIdFor.chatClose('t2')))
    await screen.findByTestId(TEST_ID.confirmDialog)
    // The click never fell through to the row's own activation.
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')

    fireEvent.click(screen.getByTestId(TEST_ID.confirmDialogConfirm))
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t2'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t2'))).toBeNull())
    // A background close never steals the current selection (spec Behaviour 11).
    expect(getByTestIdString(testIdFor.chatRow('t1')).getAttribute('data-selected')).toBe('true')
    expect(app.state.set).not.toHaveBeenCalledWith(APP_STATE_KEY.selectedChatId, 't2')
  })

  it('the attention badge yields the corner while the close control is revealed', async () => {
    const dataListenersByChat = new Map<string, Set<(data: string) => void>>()
    vi.mocked(app.terminals.onData).mockImplementation(
      (chatId: string, callback: (data: string) => void) => {
        const listeners = dataListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        dataListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
    await renderWithChats([chatOne, chatTwo], 't1')
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))

    // A BEL sets the attention badge on the viewed chat (OSC 9 semantics are
    // exercised in the attention suite; a bare BEL suffices here).
    act(() => {
      for (const listener of [...(dataListenersByChat.get('t1') ?? [])]) {
        listener('\x07')
      }
    })
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))

    // Keyboard focus reveals the close control: the badge yields the corner…
    fireEvent.focus(screen.getByTestId(testIdFor.chatRow('t1')))
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()
    expect(screen.getByTestId(testIdFor.chatClose('t1'))).toBeTruthy()

    // …and returns when the row loses focus again.
    fireEvent.blur(screen.getByTestId(testIdFor.chatRow('t1')))
    expect(screen.getByTestId(testIdFor.chatAttentionBadge('t1'))).toBeTruthy()
  })
})

describe('stale chat list responses', () => {
  let app: AppApi
  let exitListenersByChat: Map<string, Set<(exitCode: number) => void>>

  function emitExit(chatId: string, exitCode: number): void {
    act(() => {
      for (const listener of [...(exitListenersByChat.get(chatId) ?? [])]) {
        listener(exitCode)
      }
    })
  }

  beforeEach(() => {
    app = createAppApiStub()
    exitListenersByChat = new Map()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(app.terminals.onExit).mockImplementation(
      (chatId: string, callback: (exitCode: number) => void) => {
        const listeners = exitListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        exitListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
  })

  afterEach(() => {
    cleanup()
  })

  it('a chats:list response older than a concurrent create keeps the created chat and its live session view', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockResolvedValue(null)
    // The project's chat load hangs on a snapshot taken before the create.
    let resolveStaleList: (chats: ChatInfo[]) => void = () => undefined
    vi.mocked(app.chats.list).mockImplementation(
      () =>
        new Promise<ChatInfo[]>((resolve) => {
          resolveStaleList = resolve
        }),
    )
    vi.mocked(app.chats.create).mockResolvedValue(chatTwo)

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() => expect(app.chats.list).toHaveBeenCalledTimes(1))
    // The create lands (optimistic add plus a live session) while the list
    // request is still in flight.
    fireEvent.click(await screen.findByTestId(TEST_ID.newChatButton))
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', 'D:/code/demo'))
    const createdTerminal = mockTerminalInstances[mockTerminalInstances.length - 1]

    // The pre-create snapshot resolves now: it must not evict the live view.
    await act(async () => {
      resolveStaleList([chatOne])
    })
    expect(screen.getByTestId(testIdFor.chatRow('t2'))).toBeTruthy()
    expect(createdTerminal.dispose).not.toHaveBeenCalled()
  })

  it('a chats:list response older than a close does not resurrect the closed chat', async () => {
    let resolveStaleList: (chats: ChatInfo[]) => void = () => undefined
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    vi.mocked(app.chats.list)
      .mockResolvedValueOnce([chatOne]) // hydration
      .mockImplementationOnce(
        () =>
          new Promise<ChatInfo[]>((resolve) => {
            resolveStaleList = resolve
          }),
      )

    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', 'D:/code/demo'))
    // A second load starts before the close lands: collapse, then re-expand
    // the selected project by clicking its title (the selection, and with it
    // the exit listener, stays on t1).
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(screen.getByTestId(testIdFor.projectSelect('p1')))
    await waitFor(() => expect(app.chats.list).toHaveBeenCalledTimes(2))

    emitExit('t1', 0)
    await waitFor(() => expect(app.chats.remove).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull())

    // The pre-close snapshot resolves now: the closed chat must stay gone.
    await act(async () => {
      resolveStaleList([chatOne])
    })
    expect(screen.queryByTestId(testIdFor.chatRow('t1'))).toBeNull()
  })
})

describe('chat attention badge (end to end through App)', () => {
  let app: AppApi
  let dataListenersByChat: Map<string, Set<(data: string) => void>>

  function emitData(chatId: string, data: string): void {
    act(() => {
      for (const listener of [...(dataListenersByChat.get(chatId) ?? [])]) {
        listener(data)
      }
    })
  }

  beforeEach(() => {
    app = createAppApiStub()
    dataListenersByChat = new Map()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(playAttentionChime).mockClear()
    vi.mocked(app.terminals.onData).mockImplementation(
      (chatId: string, callback: (data: string) => void) => {
        const listeners = dataListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        dataListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
  })

  afterEach(() => {
    cleanup()
  })

  /** Selected project p1 with chats t1+t2, t1 selected (its view live). */
  async function renderTwoChats(): Promise<void> {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    // Switch to t2 so BOTH views are mounted (t1 hidden, still detecting).
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))
  }

  it('shows hidden recent output and retains the deadline when attention clears', async () => {
    await renderTwoChats()
    vi.useFakeTimers()
    try {
      emitData('t1', 'output')
      act(() => vi.advanceTimersByTime(250))
      expect(screen.getByTestId(testIdFor.chatActivity('t1'))).toBeTruthy()
      expect(screen.queryByTestId(testIdFor.chatActivity('t2'))).toBeNull()
      emitData('t1', '\x07')
      expect(screen.getByTestId(testIdFor.chatAttentionBadge('t1'))).toBeTruthy()
      expect(screen.queryByTestId(testIdFor.chatActivity('t1'))).toBeNull()
      act(() => vi.advanceTimersByTime(2000))
      fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
      expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()
      expect(screen.getByTestId(testIdFor.chatActivity('t1'))).toBeTruthy()
      act(() => vi.advanceTimersByTime(500))
      expect(screen.queryByTestId(testIdFor.chatActivity('t1'))).toBeNull()
      const stateKeys = vi.mocked(app.state.set).mock.calls.map(([key]) => key)
      expect(stateKeys.some((key) => key.startsWith('activity.'))).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('AC10 + badge: a BEL in the hidden chat shows the badge with no tooltip; OSC 9 carries the truncated message', async () => {
    await renderTwoChats()
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()

    emitData('t1', '\x07')
    const badge = await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))
    expect(badge.getAttribute('title')).toBe('Needs attention')

    // A newer OSC 9 message replaces the tooltip text, truncated to 120.
    const long = 'x'.repeat(200)
    emitData('t1', `\x1b]9;${long}\x07`)
    await waitFor(() => expect(badge.getAttribute('title')).toBe('x'.repeat(120)))
  })

  it('AC5: selecting the badged chat clears its badge', async () => {
    await renderTwoChats()
    emitData('t1', '\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))

    fireEvent.click(screen.getByTestId(testIdFor.chatRow('t1')))
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull())
  })

  it('AC1: defaults on — hidden-chat signal badges and chimes; active-chat signal indicators and chimes', async () => {
    await renderTwoChats()
    // Hidden chat t1: badge + chime.
    emitData('t1', '\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))
    expect(playAttentionChime).toHaveBeenCalledTimes(1)

    // Active chat t2: indicator dot + chime (attention-alert-settings spec
    // Behaviour 3-4; the dot is the same amber element, gated, not new UI).
    emitData('t2', '\x1b]9;watched\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t2'))
    expect(playAttentionChime).toHaveBeenCalledTimes(2)

    // Structure assertion (AC7): attention STATE never persists — the only
    // attention.* app_state writes are the settings toggles themselves.
    const stateKeys = vi.mocked(app.state.set).mock.calls.map(([key]) => key)
    expect(stateKeys.filter((key) => key.startsWith('attention.'))).toEqual([])
  })

  it('AC2: badge toggle off hides hidden-chat dots, chime still fires, and re-enabling re-renders the existing state', async () => {
    await renderTwoChats()
    emitData('t1', '\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))

    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    const badgeToggle = within(dialog).getByTestId(
      TEST_ID.settingsAttentionBadge,
    ) as HTMLInputElement
    expect(badgeToggle.checked).toBe(true)
    fireEvent.click(badgeToggle)
    await waitFor(() =>
      expect(app.state.set).toHaveBeenCalledWith(APP_STATE_KEY.attentionBadgeEnabled, '0'),
    )
    await waitFor(() => expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull())
    // The state-setting channel still sounds.
    expect(playAttentionChime).toHaveBeenCalled()

    // Re-enabling re-renders the still-held state without any new signal.
    fireEvent.click(badgeToggle)
    await waitFor(() =>
      expect(app.state.set).toHaveBeenLastCalledWith(APP_STATE_KEY.attentionBadgeEnabled, '1'),
    )
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))
  })

  it('AC7: persisted off-switches load at startup and gate badge and chime; other toggles keep defaults', async () => {
    app = createAppApiStub()
    dataListenersByChat = new Map()
    resetMockTerminals()
    resetMockFitAddons()
    vi.mocked(app.terminals.onData).mockImplementation(
      (chatId: string, callback: (data: string) => void) => {
        const listeners = dataListenersByChat.get(chatId) ?? new Set()
        listeners.add(callback)
        dataListenersByChat.set(chatId, listeners)
        return () => {
          listeners.delete(callback)
        }
      },
    )
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne, chatTwo])
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === APP_STATE_KEY.selectedProjectId
        ? 'p1'
        : key === APP_STATE_KEY.selectedChatId
          ? 't1'
          : key === APP_STATE_KEY.attentionBadgeEnabled
            ? '0'
            : key === APP_STATE_KEY.attentionChimeEnabled
              ? '0'
              : null,
    )
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    fireEvent.keyDown(window, { code: 'Tab', ctrlKey: true, bubbles: true, cancelable: true })
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t2', projectA.path))

    // The hydrated off state is observable on the toggles themselves.
    fireEvent.click(screen.getByRole('button', { name: 'App Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'App Settings' })
    expect(
      (within(dialog).getByTestId(TEST_ID.settingsAttentionBadge) as HTMLInputElement).checked,
    ).toBe(false)
    expect(
      (within(dialog).getByTestId(TEST_ID.settingsAttentionChime) as HTMLInputElement).checked,
    ).toBe(false)
    expect(
      (within(dialog).getByTestId(TEST_ID.settingsAttentionActiveChime) as HTMLInputElement)
        .checked,
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close app settings' }))

    // Hidden chat: badge gated off AND chime gated off.
    emitData('t1', '\x07')
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()
    expect(playAttentionChime).not.toHaveBeenCalled()
    // Active chat: defaults still on — indicator + active chime.
    emitData('t2', '\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t2'))
    expect(playAttentionChime).toHaveBeenCalledTimes(1)
  })

  it('AC7: BEL and OSC 9 in a bottom-panel tab set no chat badge', async () => {
    await renderTwoChats()
    const openBefore = getByTestIdString(TEST_ID.bottomRegion).style.display !== 'none'
    fireEvent.keyDown(window, {
      code: 'Backquote',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    await waitFor(() => {
      expect(getByTestIdString(TEST_ID.bottomRegion).style.display).not.toBe('none')
      expect(app.terminals.create).toHaveBeenCalledWith(
        expect.stringMatching(/^bottom:/),
        projectA.path,
      )
    })
    const bottomTabId = vi
      .mocked(app.terminals.create)
      .mock.calls.map(([id]) => id)
      .find((id) => id.startsWith('bottom:')) as string

    emitData(bottomTabId, '\x07\x1b]9;bottom noise\x07')
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t2'))).toBeNull()
    vi.useFakeTimers()
    try {
      emitData(bottomTabId, 'more bottom output')
      act(() => vi.advanceTimersByTime(250))
      expect(screen.queryByTestId(testIdFor.chatActivity('t1'))).toBeNull()
      expect(screen.queryByTestId(testIdFor.chatActivity('t2'))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
    expect(openBefore).toBe(false)
  })

  it('AC8: attention is in-memory only — restart shows no badges and no persistence calls are made for it', async () => {
    await renderTwoChats()
    emitData('t1', '\x07')
    await screen.findByTestId(testIdFor.chatAttentionBadge('t1'))

    cleanup()
    render(<App app={app} />)
    await waitFor(() => expect(app.terminals.create).toHaveBeenCalledWith('t1', projectA.path))
    expect(screen.queryByTestId(testIdFor.chatAttentionBadge('t1'))).toBeNull()
    // Structure assertion: the feature's only persistence-adjacent surface
    // would be app.state — the badge lifecycle never touches it.
    const stateKeys = vi.mocked(app.state.set).mock.calls.map(([key]) => key)
    expect(stateKeys).not.toContain('chatAttention')
  })
})

describe('kanban task resume — removing the project', () => {
  let app: AppApi

  beforeEach(() => {
    app = createAppApiStub()
    resetMockTerminals()
    resetMockFitAddons()
  })

  afterEach(() => {
    cleanup()
  })

  function deferred<T>(): {
    promise: Promise<T>
    resolve: (value: T) => void
  } {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((yes) => {
      resolve = yes
    })
    return { promise, resolve }
  }

  const board: KanbanBoardData = {
    states: [{ id: 's1', name: 'Backlog', group: 'backlog', order: 1 }],
    items: [
      {
        ref: 'NEKODE-28',
        id: 'native-28',
        title: 'Kanban task launch',
        description: null,
        stateId: 's1',
        stateName: 'Backlog',
        stateGroup: 'backlog',
        priority: null,
        assignee: null,
        url: null,
        updatedAt: null,
      },
    ],
  }

  it('clears the open Resume modal when its project is removed and drops the stale scan', async () => {
    vi.mocked(app.projects.list).mockResolvedValueOnce([projectA]).mockResolvedValue([])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(board)
    // A bound project: the Kanban tile and tab exist.
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? 'demo' : null,
    )
    // The resume scan is held open so removal happens while it is in flight.
    const scan = deferred<HandoffCandidatesResult>()
    vi.mocked(app.kanban.handoffCandidates).mockReturnValue(scan.promise)

    render(<App app={app} />)
    // Select the project (its subtree expands), then open its Kanban board.
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))

    // Open the Resume modal for the project's item.
    fireEvent.click(await screen.findByTestId(testIdFor.kanbanItemResume('NEKODE-28')))
    await screen.findByTestId(TEST_ID.kanbanResumeDialog)
    expect(app.kanban.handoffCandidates).toHaveBeenCalledTimes(1)

    // Remove the project while the scan is still pending (spec Bledy i
    // wyscigi: removing the project before confirmation invalidates it).
    fireEvent.contextMenu(getByTestIdString(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByTestId(testIdFor.removeProject('p1')))
    await waitFor(() => expect(app.projects.remove).toHaveBeenCalledWith('p1'))

    // The modal is unmounted with its project.
    await waitFor(() => expect(screen.queryByTestId(TEST_ID.kanbanResumeDialog)).toBeNull())

    // A late scan result for the removed project is never applied: no
    // candidate row appears and the dialog stays gone.
    await act(async () => {
      scan.resolve({
        state: 'ready',
        files: [
          {
            name: 'nekode-28.md',
            path: 'h/nekode-28.md',
            modifiedAt: new Date(1).toISOString(),
            matchKind: 'filename',
          },
        ],
        rejections: [],
      })
      await Promise.resolve()
    })
    expect(screen.queryByTestId(testIdFor.kanbanResumeCandidate('nekode-28.md'))).toBeNull()
    expect(screen.queryByTestId(TEST_ID.kanbanResumeDialog)).toBeNull()
  })

  it('drops stale out-of-order refreshKanbanBindings responses and does not fall back active kanban tab', async () => {
    const projectA: ProjectInfo = {
      id: 'p1',
      name: 'Project A',
      path: '/path/p1',
      runtimeLabel: null,
    }
    const firstCallDeferred = deferred<string | null>()
    let stateGetCallCount = 0

    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(board)

    vi.mocked(app.state.get).mockImplementation(async (key) => {
      if (key === projectKanbanAdapterKey('p1')) {
        stateGetCallCount += 1
        if (stateGetCallCount === 1) {
          return firstCallDeferred.promise
        }
        return 'demo'
      }
      return null
    })

    render(<App app={app} />)
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))

    // Open Project Settings via context menu and close it to trigger second refreshKanbanBindings
    fireEvent.contextMenu(screen.getByTestId(testIdFor.projectRow('p1')))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Project Settings$/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close settings' }))

    // Second call returned 'demo', so project is bound and Kanban tab is available
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    await screen.findByTestId(TEST_ID.kanbanBoard)

    // Now resolve the first (stale, older) call with null (unbound)
    await act(async () => {
      firstCallDeferred.resolve(null)
      await Promise.resolve()
    })

    // The active tab should STILL be kanban, not fallen back to terminal
    expect(screen.queryByTestId(TEST_ID.kanbanBoard)).not.toBeNull()
  })

  it('suppresses fixed action bar buttons and preserves settings when viewing the kanban tab', async () => {
    vi.mocked(app.projects.list).mockResolvedValue([projectA])
    vi.mocked(app.chats.list).mockResolvedValue([chatOne])
    vi.mocked(app.kanban.listBoard).mockResolvedValue(board)
    vi.mocked(app.state.get).mockImplementation(async (key) =>
      key === projectKanbanAdapterKey('p1') ? 'demo' : null,
    )

    render(<App app={app} />)
    await screen.findByTestId(testIdFor.projectSelect('p1'))

    // On terminal tab, fixed buttons exist
    expect(screen.getByRole('button', { name: 'Handoff' })).toBeTruthy()

    // Switch to kanban tab
    fireEvent.click(await screen.findByTestId(testIdFor.projectSelect('p1')))
    fireEvent.click(await screen.findByTestId(TEST_ID.kanbanTab))
    const kanbanBoard = await screen.findByTestId(TEST_ID.kanbanBoard)

    // In action bar on kanban tab, fixed action buttons are suppressed
    const actionBar = screen.getByTestId(TEST_ID.actionRowSlot)
    expect(within(actionBar).queryByRole('button', { name: 'Handoff' })).toBeNull()
    expect(within(actionBar).queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(within(actionBar).queryByRole('button', { name: 'Stop' })).toBeNull()
    expect(within(actionBar).queryByRole('button', { name: 'Continue' })).toBeNull()

    // Kanban toolbar controls are rendered on the left of action bar
    await waitFor(() => {
      expect(within(actionBar).getByTestId(TEST_ID.kanbanSortBy)).toBeTruthy()
      expect(within(actionBar).getByTestId(TEST_ID.kanbanSortDirection)).toBeTruthy()
      expect(within(actionBar).getByTestId(TEST_ID.kanbanBoardRefresh)).toBeTruthy()
      expect(within(actionBar).getByTestId(TEST_ID.kanbanSearchInput)).toBeTruthy()
      expect(within(actionBar).getByTestId(TEST_ID.kanbanNewTask)).toBeTruthy()
    })

    // Internal kanban header below is omitted
    expect(within(kanbanBoard).queryByRole('heading', { name: 'Kanban' })).toBeNull()

    expect(screen.getByRole('button', { name: 'Project Settings' })).toBeTruthy()
  })
})
