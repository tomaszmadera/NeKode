import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { MermaidDiagram, nextDiagramId } from './MermaidDiagram'

// The library is mocked here on purpose: jsdom cannot lay out SVG, so a real
// render would fail for reasons this component does not own. The drawing
// itself is verified in the application (spec Required tests).
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))

vi.mock('mermaid', () => ({ default: mermaid }))

// The pan-zoom helper is mocked for the same reason: jsdom has no layout, and
// what this component owns is the wiring (which gesture calls which method),
// not the library's own transform math. The interaction options are asserted
// key by key against a literal so loosening them fails a named test.
const panzoom = vi.hoisted(() => {
  const instance = {
    zoomWithWheel: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    reset: vi.fn(),
    setOptions: vi.fn(),
    destroy: vi.fn(),
    resetStyle: vi.fn(),
  }
  return { Panzoom: vi.fn(() => instance), instance }
})

vi.mock('@panzoom/panzoom', () => ({ default: panzoom.Panzoom }))

function diagram(source: string): React.JSX.Element {
  return (
    <MermaidDiagram source={source}>
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    </MermaidDiagram>
  )
}

/** Renders one diagram through to its ready state and the helper attached. */
async function renderReady(source: string) {
  mermaid.render.mockResolvedValue({ svg: '<svg data-diagram="ok"></svg>' })
  const result = render(diagram(source))
  const ready = await screen.findByTestId(TEST_ID.fileMarkdownDiagram)
  // The single-instance call count keeps a call that never reached the mock
  // from passing silently (spec Required tests).
  await waitFor(() => {
    expect(panzoom.Panzoom).toHaveBeenCalledTimes(1)
  })
  return { ...result, ready }
}

describe('MermaidDiagram', () => {
  afterEach(() => {
    cleanup()
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
    panzoom.Panzoom.mockClear()
    panzoom.instance.zoomWithWheel.mockReset()
    panzoom.instance.zoomIn.mockReset()
    panzoom.instance.zoomOut.mockReset()
    panzoom.instance.reset.mockReset()
    panzoom.instance.setOptions.mockReset()
    panzoom.instance.destroy.mockReset()
    panzoom.instance.resetStyle.mockReset()
  })

  it('inserts the rendered svg, in the id it asked for, and drops the code block', async () => {
    mermaid.render.mockImplementation((id: string) =>
      Promise.resolve({ svg: `<svg id="${String(id)}" data-diagram="ok"></svg>` }),
    )

    const { container } = render(diagram('flowchart LR\n  A --> B'))

    await waitFor(() => {
      expect(screen.getByTestId(TEST_ID.fileMarkdownDiagram)).toBeTruthy()
    })
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('data-diagram')).toBe('ok')
    expect(svg?.getAttribute('id')?.startsWith('nekode-mermaid-diagram-')).toBe(true)
    expect(screen.queryByText(/flowchart LR/)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.fileMarkdownDiagramError)).toBeNull()
    expect(mermaid.render).toHaveBeenCalledWith(svg?.getAttribute('id'), 'flowchart LR\n  A --> B')
  })

  it('gives every diagram its own id', () => {
    const ids = [nextDiagramId(), nextDiagramId(), nextDiagramId()]

    expect(new Set(ids).size).toBe(3)
    expect(ids.every((id) => id.startsWith('nekode-mermaid-diagram-'))).toBe(true)
  })

  it('mounts two diagrams at once, each in its own id', async () => {
    mermaid.render.mockImplementation((id: string) =>
      Promise.resolve({ svg: `<svg id="${String(id)}"></svg>` }),
    )

    render(
      <>
        <MermaidDiagram source="flowchart LR">first</MermaidDiagram>
        <MermaidDiagram source="sequenceDiagram">second</MermaidDiagram>
      </>,
    )

    await waitFor(() => {
      expect(screen.getAllByTestId(TEST_ID.fileMarkdownDiagram).length).toBe(2)
    })
    const ids = screen
      .getAllByTestId(TEST_ID.fileMarkdownDiagram)
      .map((container) => container.querySelector('svg')?.getAttribute('id') ?? '')
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((id) => id.startsWith('nekode-mermaid-diagram-'))).toBe(true)
  })

  it('never loosens the security configuration', async () => {
    mermaid.render.mockResolvedValue({ svg: '<svg></svg>' })

    render(diagram('flowchart LR'))

    await waitFor(() => {
      expect(mermaid.initialize).toHaveBeenCalledTimes(1)
    })
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: true,
      }),
    )
  })

  it('keeps the code block and names the failure when the render rejects', async () => {
    mermaid.render.mockRejectedValue(new Error('Parse error on line 2\nmore detail'))

    render(diagram('flowchart LR\n  A -->'))

    const error = await screen.findByTestId(TEST_ID.fileMarkdownDiagramError)
    expect(error.textContent).toContain('Parse error on line 2')
    expect(error.textContent).not.toContain('more detail')
    expect(screen.queryByTestId(TEST_ID.fileMarkdownDiagram)).toBeNull()
    const source = document.querySelector('pre code')
    expect(source?.textContent).toContain('A -->')
  })

  it('inserts nothing when the render settles after unmount', async () => {
    let resolveRender: (value: { svg: string }) => void = () => undefined
    mermaid.render.mockReturnValue(
      new Promise<{ svg: string }>((resolve) => {
        resolveRender = resolve
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { container, unmount } = render(diagram('flowchart LR'))
    unmount()
    resolveRender({ svg: '<svg data-late="1"></svg>' })
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(container.querySelector('svg')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('creates the pan-zoom helper on its own svg with the interaction options pinned', async () => {
    const { container, ready } = await renderReady('flowchart LR')

    expect(ready.querySelector('svg')).toBeTruthy()
    expect(panzoom.Panzoom).toHaveBeenCalledWith(container.querySelector('svg'), {
      startScale: 1,
      minScale: 1,
      maxScale: 10,
      cursor: 'move',
    })
  })

  it('zooms on Ctrl+wheel and consumes the gesture', async () => {
    const { ready } = await renderReady('flowchart LR')

    const wheel = new WheelEvent('wheel', { ctrlKey: true, cancelable: true, bubbles: true })
    fireEvent(ready, wheel)

    expect(panzoom.instance.zoomWithWheel).toHaveBeenCalledWith(wheel)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('keeps the preview scrolling on a plain wheel', async () => {
    const { ready } = await renderReady('flowchart LR')

    const wheel = new WheelEvent('wheel', { cancelable: true, bubbles: true })
    fireEvent(ready, wheel)

    expect(panzoom.instance.zoomWithWheel).not.toHaveBeenCalled()
    expect(wheel.defaultPrevented).toBe(false)
  })

  it('restores the fit view on a double click', async () => {
    const { ready } = await renderReady('flowchart LR')

    const svg = ready.querySelector('svg')
    expect(svg).not.toBeNull()
    // fireEvent has no dblclick helper (same as auxclick); the component binds
    // a native listener, so a dispatched MouseEvent reaches it.
    fireEvent(svg as SVGElement, new MouseEvent('dblclick', { bubbles: true, cancelable: true }))

    expect(panzoom.instance.reset).toHaveBeenCalledTimes(1)
  })

  it('destroys the helper when the diagram goes away', async () => {
    const { unmount } = await renderReady('flowchart LR')

    unmount()

    expect(panzoom.instance.destroy).toHaveBeenCalledTimes(1)
    expect(panzoom.instance.resetStyle).toHaveBeenCalledTimes(1)
  })

  it('shows the control bar for a drawn diagram only, outside the diagram markup', async () => {
    mermaid.render.mockReturnValue(new Promise(() => undefined))
    render(diagram('flowchart LR'))

    // No diagram yet, so no controls: the bar belongs to the attached helper.
    expect(screen.queryByTestId(TEST_ID.fileMarkdownDiagramControls)).toBeNull()
  })

  it('keeps the diagram in its fit view with no control bar when the helper fails', async () => {
    panzoom.Panzoom.mockImplementationOnce(() => {
      throw new Error('helper unavailable')
    })
    mermaid.render.mockResolvedValue({ svg: '<svg data-diagram="ok"></svg>' })

    render(diagram('flowchart LR'))

    const ready = await screen.findByTestId(TEST_ID.fileMarkdownDiagram)
    await waitFor(() => {
      expect(panzoom.Panzoom).toHaveBeenCalledTimes(1)
    })

    // The failure is the helper's own: the diagram stays drawn and readable,
    // and it gains no dead controls (spec Errors).
    expect(ready.querySelector('svg')).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.fileMarkdownDiagramControls)).toBeNull()
    expect(screen.queryByTestId(TEST_ID.fileMarkdownDiagramError)).toBeNull()
  })

  it('adds the control bar beside the diagram markup, not inside it', async () => {
    const { ready } = await renderReady('flowchart LR')

    const controls = screen.getByTestId(TEST_ID.fileMarkdownDiagramControls)
    expect(controls.parentElement).toBe(ready)
    expect(ready.querySelector('svg')?.contains(controls)).toBe(false)
  })

  it('zooms in and out from the control bar through the helper', async () => {
    const { ready } = await renderReady('flowchart LR')
    const svg = ready.querySelector('svg')

    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownDiagramZoomIn))
    expect(panzoom.instance.zoomIn).toHaveBeenCalledWith({ animate: false })

    // Zoom out is inactive at the fit view, so the helper has to report a
    // magnification before it can be pressed.
    act(() => {
      svg?.dispatchEvent(new CustomEvent('panzoomchange', { detail: { scale: 1.3498 } }))
    })
    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownDiagramZoomOut))

    expect(panzoom.instance.zoomOut).toHaveBeenCalledWith({ animate: false })
  })

  it('inactivates zoom out at the fit view and reports the magnification', async () => {
    const { ready } = await renderReady('flowchart LR')
    const svg = ready.querySelector('svg')
    const zoomOut = screen.getByTestId(TEST_ID.fileMarkdownDiagramZoomOut) as HTMLButtonElement

    // The fit view is the smallest scale (spec Behaviour 13).
    expect(zoomOut.disabled).toBe(true)
    expect(screen.getByTestId(TEST_ID.fileMarkdownDiagramZoomLevel).textContent).toBe('100%')

    act(() => {
      svg?.dispatchEvent(new CustomEvent('panzoomchange', { detail: { scale: 1.5 } }))
    })

    expect(screen.getByTestId(TEST_ID.fileMarkdownDiagramZoomLevel).textContent).toBe('150%')
    expect(zoomOut.disabled).toBe(false)
  })

  it('restores the fit view from the control bar', async () => {
    await renderReady('flowchart LR')

    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownDiagramFit))

    expect(panzoom.instance.reset).toHaveBeenCalledTimes(1)
  })

  it('switches the diagram between panning and text selection', async () => {
    const { ready } = await renderReady('flowchart LR')
    const canvas = ready.firstElementChild as HTMLElement
    const svg = ready.querySelector('svg')
    const toggle = screen.getByTestId(TEST_ID.fileMarkdownDiagramMode)

    // Panning is the mode a diagram starts in, applied when the helper binds.
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(svg?.style.userSelect).toBe('none')
    expect(panzoom.instance.setOptions).toHaveBeenCalledTimes(1)

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(panzoom.instance.setOptions).toHaveBeenLastCalledWith({
      disablePan: true,
      cursor: 'text',
      handleStartEvent: expect.any(Function),
    })
    expect(canvas.style.userSelect).toBe('text')
    expect(svg?.style.userSelect).toBe('text')

    fireEvent.click(toggle)

    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(panzoom.instance.setOptions).toHaveBeenLastCalledWith({
      disablePan: false,
      cursor: 'move',
      handleStartEvent: expect.any(Function),
    })
    expect(canvas.style.userSelect).toBe('none')
    expect(svg?.style.userSelect).toBe('none')
  })

  it('leaves the double click to the text selection while that mode is on', async () => {
    const { ready } = await renderReady('flowchart LR')
    const svg = ready.querySelector('svg') as SVGElement

    fireEvent.click(screen.getByTestId(TEST_ID.fileMarkdownDiagramMode))
    fireEvent(svg, new MouseEvent('dblclick', { bubbles: true, cancelable: true }))

    expect(panzoom.instance.reset).not.toHaveBeenCalled()
  })
})
