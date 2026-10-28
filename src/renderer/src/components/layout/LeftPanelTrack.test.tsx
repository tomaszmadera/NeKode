import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { LeftPanelTrack, type LeftPanelView } from './LeftPanelTrack'

function installMatchMedia(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function removeMatchMedia(): void {
  Reflect.deleteProperty(window, 'matchMedia')
}

function track(): HTMLElement {
  const node = document.querySelector('.left-panel-track')
  if (!(node instanceof HTMLElement)) {
    throw new Error('left panel track is missing')
  }
  return node
}

function renderTrack(view: LeftPanelView) {
  return render(
    <LeftPanelTrack
      view={view}
      width={280}
      onResizeStart={() => {}}
      onResizeNudge={() => {}}
      projects={<div data-testid="projects-view">Projects</div>}
      files={view === 'files' ? <div data-testid="files-view">Files</div> : null}
    />,
  )
}

describe('LeftPanelTrack', () => {
  afterEach(() => {
    cleanup()
    removeMatchMedia()
  })

  it('swaps immediately when matchMedia is unavailable', () => {
    removeMatchMedia()
    const view = renderTrack('projects')
    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.queryByTestId('files-view')).toBeNull()
    expect(screen.getByTestId(TEST_ID.leftNav).style.width).toBe('280px')
    expect(track().style.width).toBe('200%')
    expect(track().getAttribute('data-slide-state')).toBe('closed')
    expect(screen.getByTestId(TEST_ID.leftNav).getAttribute('data-slide-state')).toBe('closed')

    view.rerender(
      <LeftPanelTrack
        view="files"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={<div data-testid="files-view">Files</div>}
      />,
    )

    expect(screen.queryByTestId('projects-view')).toBeNull()
    expect(screen.getByTestId('files-view')).toBeTruthy()
    expect(track().style.transform).toBe('translateX(0)')
    expect(track().className).not.toContain('left-panel-track-run')
    expect(track().getAttribute('data-slide-state')).toBe('open')
    expect(screen.getByTestId(TEST_ID.leftNav).getAttribute('data-slide-state')).toBe('open')
  })

  it('slides Projects out to the left as Files arrives, then settles on Files', () => {
    installMatchMedia(false)
    const view = renderTrack('projects')

    view.rerender(
      <LeftPanelTrack
        view="files"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={<div data-testid="files-view">Files</div>}
      />,
    )

    // Both views stay mounted while the paired slide runs.
    const moving = track()
    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.getByTestId('files-view')).toBeTruthy()
    expect(moving.className).toContain('left-panel-track-run')
    expect(moving.getAttribute('data-slide-state')).toBe('sliding')
    expect(moving.children).toHaveLength(2)

    fireEvent.transitionEnd(moving, { propertyName: 'transform' })

    // Settling on transitionend drops the outgoing Projects view.
    expect(screen.queryByTestId('projects-view')).toBeNull()
    expect(screen.getByTestId('files-view')).toBeTruthy()
    expect(track().className).not.toContain('left-panel-track-run')
    expect(track().getAttribute('data-slide-state')).toBe('open')
    expect(screen.getByTestId(TEST_ID.leftNav).getAttribute('data-slide-state')).toBe('open')
    expect(screen.getAllByTestId(TEST_ID.leftResizeHandle)).toHaveLength(1)
  })

  it('slides Files out to the right as Projects returns, keeping the files node after the parent drops it', () => {
    installMatchMedia(false)
    const view = renderTrack('projects')
    view.rerender(
      <LeftPanelTrack
        view="files"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={<div data-testid="files-view">Files</div>}
      />,
    )
    fireEvent.transitionEnd(track(), { propertyName: 'transform' })

    view.rerender(
      <LeftPanelTrack
        view="projects"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={null}
      />,
    )

    // The retained files node (the parent now passes null) is still mounted
    // for the reverse slide, Projects first and Files second.
    const moving = track()
    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.getByTestId('files-view')).toBeTruthy()
    expect(moving.className).toContain('left-panel-track-run')
    expect(moving.getAttribute('data-slide-state')).toBe('sliding')
    expect((moving.children[0] as HTMLElement).textContent).toContain('Files')
    expect((moving.children[1] as HTMLElement).textContent).toContain('Projects')

    fireEvent.transitionEnd(moving, { propertyName: 'transform' })

    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.queryByTestId('files-view')).toBeNull()
    expect(track().getAttribute('data-slide-state')).toBe('closed')
    expect(screen.getByTestId(TEST_ID.leftNav).getAttribute('data-slide-state')).toBe('closed')
  })

  it('reverses a running slide toward Files back to Projects', () => {
    installMatchMedia(false)
    const view = renderTrack('projects')
    view.rerender(
      <LeftPanelTrack
        view="files"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={<div data-testid="files-view">Files</div>}
      />,
    )
    // Mid-slide toward Files...
    expect(track().className).toContain('left-panel-track-run')
    expect(track().getAttribute('data-slide-state')).toBe('sliding')

    view.rerender(
      <LeftPanelTrack
        view="projects"
        width={280}
        onResizeStart={() => {}}
        onResizeNudge={() => {}}
        projects={<div data-testid="projects-view">Projects</div>}
        files={<div data-testid="files-view">Files</div>}
      />,
    )

    // ...reverses back: both views stay mounted and the slide keeps running.
    const moving = track()
    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.getByTestId('files-view')).toBeTruthy()
    expect(moving.className).toContain('left-panel-track-run')
    expect(moving.getAttribute('data-slide-state')).toBe('sliding')

    fireEvent.transitionEnd(moving, { propertyName: 'transform' })

    expect(screen.getByTestId('projects-view')).toBeTruthy()
    expect(screen.queryByTestId('files-view')).toBeNull()
    expect(track().getAttribute('data-slide-state')).toBe('closed')
    expect(screen.getByTestId(TEST_ID.leftNav).getAttribute('data-slide-state')).toBe('closed')
  })
})
