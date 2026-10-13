import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEST_ID } from '../../lib/test-ids'
import { MermaidDiagram, nextDiagramId } from './MermaidDiagram'

// The library is mocked here on purpose: jsdom cannot lay out SVG, so a real
// render would fail for reasons this component does not own. The drawing
// itself is verified in the application (spec Required tests).
const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }))

vi.mock('mermaid', () => ({ default: mermaid }))

function diagram(source: string): React.JSX.Element {
  return (
    <MermaidDiagram source={source}>
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
    </MermaidDiagram>
  )
}

describe('MermaidDiagram', () => {
  afterEach(() => {
    cleanup()
    mermaid.initialize.mockReset()
    mermaid.render.mockReset()
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
})
