import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { buildMermaidConfig } from './mermaid-config'

// One Mermaid diagram inside a rendered Markdown document (spec Behaviour 1
// and 3 to 7). The library is imported on demand here, so a preview that
// renders no diagram never loads it.
//
// `children` is the plain code block the preview would show for this fence: it
// stays on screen while the diagram renders and it is what remains, unchanged,
// when the diagram cannot be drawn. Mermaid's own error diagram never reaches
// the DOM (`suppressErrorRendering`), and a render that settles after the tab
// moved on neither inserts markup nor updates this component.

let diagramCounter = 0

/**
 * The id of one diagram render. Every block gets its own, so several diagrams
 * in one file render independently of each other and in any completion order
 * (spec Behaviour 6). The value is not derived from the file content.
 */
export function nextDiagramId(): string {
  diagramCounter += 1
  return `nekode-mermaid-diagram-${diagramCounter}`
}

type DiagramState =
  | { status: 'pending' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string }

function diagramErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const firstLine = raw.split('\n')[0]?.trim() ?? ''
  if (firstLine === '') {
    return 'This diagram could not be rendered.'
  }
  return `This diagram could not be rendered: ${firstLine.slice(0, 200)}`
}

export function MermaidDiagram({
  source,
  children,
}: {
  source: string
  children: React.ReactNode
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<DiagramState>({ status: 'pending' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'pending' })
    const id = nextDiagramId()
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize(buildMermaidConfig(containerRef.current))
        const { svg } = await mermaid.render(id, source)
        return svg
      })
      .then(
        (svg) => {
          if (!cancelled) {
            setState({ status: 'ready', svg })
          }
        },
        (error: unknown) => {
          if (!cancelled) {
            setState({ status: 'error', message: diagramErrorMessage(error) })
          }
        },
      )
    return () => {
      cancelled = true
    }
  }, [source])

  if (state.status === 'ready') {
    return (
      <div
        ref={containerRef}
        className="my-3 overflow-hidden rounded-md border border-edge bg-panel p-3"
        data-testid={TEST_ID.fileMarkdownDiagram}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid returns the only acceptable markup for its own diagram, its strict mode sanitizes it with DOMPurify, and the renderer CSP keeps injected script from running (spec Business rules).
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    )
  }

  return (
    <div ref={containerRef}>
      {children}
      {state.status === 'error' ? (
        <p
          className="mb-3 text-xs text-error"
          data-testid={TEST_ID.fileMarkdownDiagramError}
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  )
}
