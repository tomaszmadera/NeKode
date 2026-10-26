import type { AppApi, ProjectInfo } from '@shared/ipc-contract'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { createRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID, testIdFor } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { CenterTabs, type CenterTabsProps, type HomeTabState, homeTabStateFor } from './CenterTabs'
import {
  activateTab,
  closeFileTab,
  emptyTabsSession,
  KANBAN_TAB,
  openFileTab,
  type ProjectTabsSession,
  TERMINAL_TAB,
} from './tabs-session'

// CenterTabs component (center-layout-tabs-actions spec Behaviour 1-8, AC1,
// AC4; project-home spec Behaviour 1-2): the tab strip order and labels, the
// close fallback, the file-tab context menu and middle click, and which tab
// view is visible. The tab session state lives with the caller; the harness
// below holds it with the same reducers App uses. Cases that need the left
// panel, project switches or App dialogs live in
// src/renderer/src/test/center-tabs.app.test.tsx.
//
// The Monaco preview wrapper is mocked so the previews render their content
// without monaco internals.

vi.mock('../files/MonacoPreview', () => ({
  MonacoPreview: ({ content, language }: { content: string; language: string | null }) => (
    <pre data-testid="file-preview-monaco" data-language={language ?? 'plaintext'}>
      {content}
    </pre>
  ),
}))

const projectA: ProjectInfo = {
  id: 'p1',
  name: 'Demo',
  path: 'D:/code/demo',
  runtimeLabel: 'Node 24',
}

/** A session with the files opened in order (the last one active). */
function sessionWith(paths: readonly string[]): ProjectTabsSession {
  return paths.reduce(openFileTab, emptyTabsSession())
}

type HarnessOptions = Partial<Omit<CenterTabsProps, 'session'>> & {
  session?: ProjectTabsSession
}

interface Rendered {
  app: AppApi
  props: CenterTabsProps
}

/** Holds the tab session with App's reducers and renders CenterTabs. */
function Harness({
  initial,
  props,
}: {
  initial: ProjectTabsSession
  props: CenterTabsProps
}): React.JSX.Element {
  const [session, setSession] = useState(initial)
  return (
    <CenterTabs
      {...props}
      session={session}
      onSelectTab={(tab) => {
        props.onSelectTab(tab)
        setSession((current) => activateTab(current, tab))
      }}
      onCloseFile={(relativePath) => {
        props.onCloseFile(relativePath)
        setSession((current) => closeFileTab(current, relativePath))
      }}
    />
  )
}

function renderCenterTabs(options: HarnessOptions = {}): Rendered {
  const { session = emptyTabsSession(), ...overrides } = options
  const app = overrides.app ?? createAppApiStub()
  const props: CenterTabsProps = {
    app,
    floating: false,
    project: projectA,
    projectNamesUppercase: true,
    chatName: 'First chat',
    session,
    homeTabState: 'none',
    bindingsError: null,
    markdownViewByKey: {},
    surfaceRef: createRef<HTMLElement>(),
    actionRow: <div data-testid="harness-action-row" />,
    chatSurface: <div data-testid="harness-chat-surface" />,
    renderKanban: vi.fn(() => null),
    onSelectTab: vi.fn(),
    onCloseFile: vi.fn(),
    onOpenSettings: vi.fn(),
    onUseLocalTaskList: vi.fn(() => Promise.resolve()),
    onConnectTracker: vi.fn(),
    onOpenExternalError: vi.fn(),
    ...overrides,
  }
  render(<Harness initial={session} props={props} />)
  return { app, props }
}

function tabIds(): string[] {
  return screen
    .queryAllByTestId(/^tab-file-/)
    .map((element) => element.getAttribute('data-testid') ?? '')
}

function isTabSelected(relativePath: string): boolean {
  return (
    screen.getByTestId(testIdFor.tabFile(relativePath)).getAttribute('data-selected') === 'true'
  )
}

function paneDisplay(relativePath: string): string {
  return screen.getByTestId(testIdFor.filePreviewPane(relativePath)).style.display
}

afterEach(() => {
  cleanup()
})

describe('tab strip - order and labels (spec Behaviour 1-3, AC1)', () => {
  it('home tab first, then the terminal-chat tab, file tabs in session order, Project Settings at the right end', () => {
    renderCenterTabs({ session: sessionWith(['README.md', 'notes.txt', 'src/app.ts']) })

    const strip = screen.getByTestId(TEST_ID.tabStrip)
    const terminalTab = screen.getByTestId(TEST_ID.tabTerminal)
    expect(terminalTab.textContent).toBe('First chat')
    const homeTab = screen.getByTestId(TEST_ID.kanbanTab)
    expect(homeTab.textContent).toBe('DEMO')
    expect(homeTab.tagName).toBe('BUTTON')
    expect(strip.firstElementChild).toBe(homeTab)
    expect(homeTab.nextElementSibling).toBe(terminalTab)
    expect(terminalTab.nextElementSibling).toBe(screen.getByTestId(testIdFor.tabFile('README.md')))
    // Non-closable home tab.
    expect(within(homeTab).queryByRole('button', { name: /Close/ })).toBeNull()

    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt', 'tab-file-src/app.ts'])
    // Labels = file names; tooltips = the path relative to the project root.
    const appTab = screen.getByTestId(testIdFor.tabFile('src/app.ts'))
    expect(within(appTab).getByText('app.ts')).toBeTruthy()
    expect(appTab.getAttribute('title')).toBe('src / app.ts')
    // The terminal-chat tab is never closable; file tabs carry a close control.
    expect(within(terminalTab).queryByRole('button', { name: /Close/ })).toBeNull()
    expect(screen.getByTestId(testIdFor.tabFileClose('README.md'))).toBeTruthy()
    expect(strip.lastElementChild?.getAttribute('data-testid')).toBe(TEST_ID.tabProjectSettings)
    // No breadcrumb and no "Files" view label are rendered (tab model).
    expect(screen.queryByText('Select a file to preview')).toBeNull()
  })

  it('keeps the project name casing when uppercase names are off and shortens a long name', () => {
    renderCenterTabs({
      project: { ...projectA, name: 'Very long project name' },
      projectNamesUppercase: false,
    })
    const homeTab = screen.getByTestId(TEST_ID.kanbanTab)
    expect(homeTab.textContent).toBe('Very long…')
    expect(homeTab.getAttribute('title')).toBe('Tasks: Very long project name')
  })

  it('renders no home tab and no file views without a project', () => {
    renderCenterTabs({ project: null, chatName: null, session: sessionWith(['README.md']) })
    expect(screen.queryByTestId(TEST_ID.kanbanTab)).toBeNull()
    expect(screen.queryByTestId(testIdFor.filePreviewPane('README.md'))).toBeNull()
    expect(screen.getByTestId(TEST_ID.tabTerminal).textContent).toBe('Chat')
  })

  it('selecting tabs moves the selection and the visible view without reordering', async () => {
    const { props } = renderCenterTabs({
      session: sessionWith(['README.md', 'notes.txt', 'src/app.ts']),
    })
    expect(isTabSelected('src/app.ts')).toBe(true)
    await waitFor(() => expect(paneDisplay('src/app.ts')).toBe('flex'))

    fireEvent.click(
      within(screen.getByTestId(testIdFor.tabFile('README.md'))).getByText('README.md'),
    )
    expect(props.onSelectTab).toHaveBeenLastCalledWith({ kind: 'file', path: 'README.md' })
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt', 'tab-file-src/app.ts'])
    expect(isTabSelected('README.md')).toBe(true)
    expect(isTabSelected('src/app.ts')).toBe(false)
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))
    expect(paneDisplay('src/app.ts')).toBe('none')
  })

  it('the Project Settings control calls onOpenSettings', () => {
    const { props } = renderCenterTabs()
    fireEvent.click(screen.getByTestId(TEST_ID.tabProjectSettings))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })
})

describe('tab strip - closing (spec Behaviour 4, AC4)', () => {
  it('closing the active tab selects the previously active tab; the last close falls back to the terminal tab', async () => {
    const { props } = renderCenterTabs({ session: sessionWith(['README.md', 'notes.txt']) })

    // Active = notes.txt, previously active = README.md.
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(props.onCloseFile).toHaveBeenCalledWith('notes.txt')
    expect(tabIds()).toEqual(['tab-file-README.md'])
    expect(isTabSelected('README.md')).toBe(true)

    // No file tab left: the terminal-chat tab is selected (fallback).
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('README.md')))
    expect(tabIds()).toEqual([])
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
    await waitFor(() =>
      expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex'),
    )
  })

  it('closing a non-active tab keeps the selection and never closes with confirmation', async () => {
    renderCenterTabs({ session: sessionWith(['README.md', 'notes.txt', 'src/app.ts']) })

    // Active = src/app.ts; closing notes.txt (inactive) keeps it active and
    // keeps open order of the surviving tabs (no dialog, no prompt).
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-src/app.ts'])
    expect(isTabSelected('src/app.ts')).toBe(true)
    await waitFor(() => expect(paneDisplay('src/app.ts')).toBe('flex'))
  })
})

describe('tab strip - file-tab context menu and middle click (spec Behaviour 20-21)', () => {
  /** jsdom has no clipboard: stub writeText and return the spy. */
  function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText: vi.fn(() => Promise.resolve('')) },
    })
    return { writeText }
  }

  /** Middle click = auxclick with button 1 (bubbles to React's root). */
  function middleClick(element: Element): void {
    fireEvent(element, new MouseEvent('auxclick', { button: 1, bubbles: true }))
  }

  function openTwoTabs(): void {
    renderCenterTabs({ session: sessionWith(['README.md', 'notes.txt']) })
  }

  it('right click opens the context menu; Copy Relative Path copies and closes it', async () => {
    const clipboard = stubClipboard()
    openTwoTabs()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    expect(screen.getByTestId(TEST_ID.tabContextMenu)).toBeTruthy()
    // The right click never changes the selection (active stays notes.txt).
    expect(isTabSelected('notes.txt')).toBe(true)
    expect(isTabSelected('README.md')).toBe(false)
    fireEvent.click(screen.getByTestId(TEST_ID.tabContextCopyRelative))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('notes.txt'))
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
    // The tab itself is untouched by the copy.
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
  })

  it('renders the menu outside the drag-region tab strip, as a no-drag overlay', async () => {
    // A window drag region swallows clicks in Electron, so the menu must not
    // live inside the strip (regression: the menu items could not be clicked).
    openTwoTabs()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('README.md')))
    const overlay = await screen.findByTestId(TEST_ID.tabContextMenuOverlay)
    expect(overlay.classList.contains('no-drag')).toBe(true)
    expect(overlay.closest('.drag-region')).toBeNull()
    expect(screen.getByTestId(TEST_ID.tabStrip).contains(overlay)).toBe(false)
  })

  it('Copy Absolute Path copies the project root joined with the relative path', async () => {
    const clipboard = stubClipboard()
    renderCenterTabs({ session: sessionWith(['README.md', 'notes.txt', 'src/app.ts']) })
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('src/app.ts')))
    fireEvent.click(await screen.findByTestId(TEST_ID.tabContextCopyAbsolute))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('D:/code/demo/src/app.ts'))
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
  })

  it('Escape dismisses the menu without closing; the Close Tab item runs the close flow', async () => {
    openTwoTabs()
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    await screen.findByTestId(TEST_ID.tabContextMenu)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId(TEST_ID.tabContextMenu)).toBeNull()
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
    // Reopen: Close Tab closes the active tab with the Behaviour 4 fallback.
    fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Close Tab' }))
    expect(tabIds()).toEqual(['tab-file-README.md'])
    expect(isTabSelected('README.md')).toBe(true)
  })

  it('clamps context menu coordinates when opened near viewport edges', async () => {
    openTwoTabs()
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })

      fireEvent.contextMenu(screen.getByTestId(testIdFor.tabFile('notes.txt')), {
        clientX: 790,
        clientY: 590,
      })
      const menu = await screen.findByTestId(TEST_ID.tabContextMenu)
      // Clamped against 800 - 200 - 8 = 592, 600 - 120 - 8 = 472
      expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(592)
      expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(472)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      })
    }
  })

  it('middle click closes the tab without changing the selection', () => {
    openTwoTabs()
    // Active = notes.txt; middle click closes the inactive README.md.
    middleClick(screen.getByTestId(testIdFor.tabFile('README.md')))
    expect(tabIds()).toEqual(['tab-file-notes.txt'])
    expect(isTabSelected('notes.txt')).toBe(true)
    // The last file tab: the close falls back to the terminal-chat tab.
    middleClick(screen.getByTestId(testIdFor.tabFile('notes.txt')))
    expect(tabIds()).toEqual([])
    expect(screen.getByTestId(TEST_ID.tabTerminal).getAttribute('data-selected')).toBe('true')
  })

  it('middle click on the close control never closes; left click still closes', () => {
    openTwoTabs()
    middleClick(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md', 'tab-file-notes.txt'])
    fireEvent.click(screen.getByTestId(testIdFor.tabFileClose('notes.txt')))
    expect(tabIds()).toEqual(['tab-file-README.md'])
  })
})

describe('tab views - one view per tab, inactive views stay mounted (spec Behaviour 6-7, AC2)', () => {
  it('renders the action row between the strip and the focusable main surface', () => {
    const surfaceRef = createRef<HTMLElement>()
    renderCenterTabs({ surfaceRef })
    const surface = screen.getByTestId(TEST_ID.centerSurface)
    expect(surfaceRef.current).toBe(surface)
    expect(surface.tagName).toBe('MAIN')
    expect(surface.tabIndex).toBe(-1)
    const actionRow = screen.getByTestId('harness-action-row')
    expect(actionRow.nextElementSibling).toBe(surface)
    expect(screen.getByTestId(TEST_ID.tabStrip).contains(actionRow)).toBe(false)
  })

  it('keeps the chat surface mounted and hidden while a file tab is active', async () => {
    renderCenterTabs({ session: sessionWith(['README.md']) })
    const chatSurface = screen.getByTestId('harness-chat-surface')
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).contains(chatSurface)).toBe(true)
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
    await waitFor(() => expect(paneDisplay('README.md')).toBe('flex'))

    fireEvent.click(screen.getByTestId(TEST_ID.tabTerminal))
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('flex')
    expect(paneDisplay('README.md')).toBe('none')
    // Same node: the session host was never remounted.
    expect(screen.getByTestId('harness-chat-surface')).toBe(chatSurface)
  })

  it('previews each open file with its project and the stored markdown view', async () => {
    const app = createAppApiStub()
    vi.mocked(app.files.read).mockImplementation(async (projectId, relativePath) => ({
      kind: 'text' as const,
      content: `${projectId}:${relativePath}`,
      language: null,
    }))
    renderCenterTabs({ app, session: sessionWith(['README.md', 'notes.txt']) })
    await waitFor(() =>
      expect(screen.getByTestId(testIdFor.filePreviewPane('notes.txt')).textContent).toBe(
        'p1:notes.txt',
      ),
    )
    expect(app.files.read).toHaveBeenCalledWith('p1', 'README.md')
    expect(app.files.read).toHaveBeenCalledWith('p1', 'notes.txt')
  })

  it('hands renderKanban the project only while the home tab is active', () => {
    const renderKanban = vi.fn((activeProjectId: string | null) => (
      <div data-testid="harness-kanban" data-active={activeProjectId ?? 'none'} />
    ))
    renderCenterTabs({ renderKanban, session: sessionWith(['README.md']) })
    expect(screen.getByTestId('harness-kanban').getAttribute('data-active')).toBe('none')

    fireEvent.click(screen.getByTestId(TEST_ID.kanbanTab))
    expect(renderKanban).toHaveBeenLastCalledWith('p1')
    expect(screen.getByTestId('harness-kanban').getAttribute('data-active')).toBe('p1')
    expect(screen.getByTestId(TEST_ID.chatSurfaceHost).style.display).toBe('none')
    expect(paneDisplay('README.md')).toBe('none')
    // The kanban host sits inside the main surface, after the chat host.
    expect(
      screen.getByTestId(TEST_ID.centerSurface).contains(screen.getByTestId('harness-kanban')),
    ).toBe(true)
  })

  it('no Files | Kanban center-surface strip remains in the DOM', () => {
    renderCenterTabs({
      session: { ...emptyTabsSession(), active: KANBAN_TAB },
      homeTabState: 'list',
    })
    expect(screen.queryByTestId('project-surface-tabs')).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Project view' })).toBeNull()
    const centerSurface = screen.getByTestId(TEST_ID.centerSurface)
    expect(within(centerSurface).queryByRole('button', { name: 'Files' })).toBeNull()
    expect(within(centerSurface).queryByRole('button', { name: 'Kanban' })).toBeNull()
  })
})

describe('project home tab contents (project-home spec Behaviour 2, Edge cases)', () => {
  const homeSession: ProjectTabsSession = { ...emptyTabsSession(), active: KANBAN_TAB }

  it('the welcome offers a local task list for the tab-strip project and Connect a tracker', async () => {
    const { props } = renderCenterTabs({ session: homeSession, homeTabState: 'welcome' })
    const welcome = screen.getByTestId(TEST_ID.projectHomeWelcome)
    expect(welcome).toBeTruthy()
    fireEvent.click(within(welcome).getByTestId(TEST_ID.projectHomeUseLocal))
    await waitFor(() => expect(props.onUseLocalTaskList).toHaveBeenCalledWith('p1'))
    fireEvent.click(within(welcome).getByTestId(TEST_ID.projectHomeConnectTracker))
    expect(props.onConnectTracker).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['loading', null, 'loading'],
    ['error', 'Database is locked.', 'error'],
    ['list', null, 'none'],
    ['none', null, 'none'],
  ] as Array<[HomeTabState, string | null, 'loading' | 'error' | 'none']>)(
    'home tab state %s renders its own surface only',
    (homeTabState, bindingsError, expected) => {
      renderCenterTabs({ session: homeSession, homeTabState, bindingsError })
      expect(screen.queryByTestId(TEST_ID.projectHomeWelcome)).toBeNull()
      expect(screen.queryByTestId(TEST_ID.projectHomeLoading) !== null).toBe(expected === 'loading')
      const error = screen.queryByTestId(TEST_ID.projectHomeError)
      expect(error?.textContent ?? null).toBe(expected === 'error' ? 'Database is locked.' : null)
    },
  )
})

describe('homeTabStateFor', () => {
  const base = {
    project: projectA,
    active: KANBAN_TAB,
    bound: false,
    bindingsError: null,
    settled: false,
  }

  it.each([
    ['no project', { ...base, project: null }, 'none'],
    ['another tab active', { ...base, active: TERMINAL_TAB }, 'none'],
    ['bound project', { ...base, bound: true, bindingsError: 'x' }, 'list'],
    ['failed binding read', { ...base, bindingsError: 'x', settled: true }, 'error'],
    ['settled unbound project', { ...base, settled: true }, 'welcome'],
    ['unsettled unbound project', base, 'loading'],
  ] as Array<[string, Parameters<typeof homeTabStateFor>[0], HomeTabState]>)(
    '%s',
    (_title, input, expected) => {
      expect(homeTabStateFor(input)).toBe(expected)
    },
  )
})
