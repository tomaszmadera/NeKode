import type { PanzoomGlobalOptions, PanzoomObject } from '@panzoom/panzoom'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { Icon } from '../../lib/icons'
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
let mermaidPromise: Promise<typeof import('mermaid')> | null = null
let panzoomPromise: Promise<typeof import('@panzoom/panzoom')> | null = null

function loadMermaid(): Promise<typeof import('mermaid')> {
  if (mermaidPromise === null) {
    mermaidPromise = import('mermaid')
  }
  return mermaidPromise
}

function loadPanzoom(): Promise<typeof import('@panzoom/panzoom')> {
  if (panzoomPromise === null) {
    panzoomPromise = import('@panzoom/panzoom')
  }
  return panzoomPromise
}

// Zoom and pan of one rendered diagram (spec Behaviour 13 and 14). The
// gestures and the control bar are bound by this component on the diagram's
// frame and its own SVG element, so the diagram markup keeps no handler and no
// diagram directive gains behaviour (spec Behaviour 9). The pan-zoom helper is
// loaded on demand beside the diagram library: a preview without a diagram
// loads neither, and a helper that fails to load leaves the diagram in its fit
// view with no control bar (spec Errors).
const PANZOOM_OPTIONS: PanzoomGlobalOptions = {
  // The fit-to-width view of spec Behaviour 3 is scale 1: the smallest scale
  // and the level a double click and the fit control restore. Ten times that
  // view is enough to read a diagram that had to shrink far below its natural
  // size.
  startScale: 1,
  minScale: 1,
  maxScale: 10,
  cursor: 'move',
}

// The fit view is the smallest scale, so the zoom-out control is inactive
// there. The comparison tolerates the floating-point scales the helper
// computes.
const FIT_SCALE = 1
const SCALE_EPSILON = 0.001

type InteractionMode = 'pan' | 'select'

// The helper's own start handler prevents the pointer-down default, which is
// what keeps a drag from selecting text. Pan mode keeps that behaviour;
// text-selection mode restores the browser default and turns panning off
// (spec Behaviour 14).
const BLOCK_POINTER_START = (event: Event): void => {
  event.preventDefault()
  event.stopPropagation()
}

const ALLOW_POINTER_START = (): void => undefined

/**
 * Applies one interaction mode to one diagram. Pan mode drags the diagram and
 * keeps its text unselectable; text-selection mode lets the drag select the
 * diagram's text and never pans. Both the helper's options and the two nodes
 * the helper writes its own styles to are set here, so a mode chosen before
 * the helper finished loading still applies (spec Behaviour 14).
 */
function applyInteractionMode(
  canvas: HTMLElement,
  svg: SVGElement,
  panzoom: PanzoomObject | null,
  mode: InteractionMode,
): void {
  const panning = mode === 'pan'
  const userSelect = panning ? 'none' : 'text'
  canvas.style.userSelect = userSelect
  svg.style.userSelect = userSelect
  panzoom?.setOptions({
    disablePan: !panning,
    cursor: panning ? 'move' : 'text',
    handleStartEvent: panning ? BLOCK_POINTER_START : ALLOW_POINTER_START,
  })
}

const CONTROL_CLASS =
  'flex size-6 items-center justify-center rounded text-ink-muted hover:bg-highlight hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent'

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
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const panzoomRef = useRef<PanzoomObject | null>(null)
  // Read by the helper effect and the double click, which must see the mode the
  // render that changed it produced.
  const modeRef = useRef<InteractionMode>('pan')
  const [state, setState] = useState<DiagramState>({ status: 'pending' })
  const [helperReady, setHelperReady] = useState(false)
  const [scale, setScale] = useState(FIT_SCALE)
  const [mode, setMode] = useState<InteractionMode>('pan')
  modeRef.current = mode

  useEffect(() => {
    let cancelled = false
    setState({ status: 'pending' })
    const id = nextDiagramId()
    void loadMermaid()
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

  useEffect(() => {
    // Every re-render starts at the fit view (spec Behaviour 11 and 13), and
    // the control bar appears only once the helper is bound (spec Errors).
    setHelperReady(false)
    setScale(FIT_SCALE)
    if (state.status !== 'ready') {
      return
    }
    const container = containerRef.current
    const canvas = canvasRef.current
    const svg = canvas?.querySelector('svg') ?? null
    if (container === null || canvas === null || svg === null) {
      return
    }
    let disposed = false
    let panzoom: PanzoomObject | null = null

    // Ctrl+wheel zooms around the pointer and consumes the wheel event; a
    // wheel event without Ctrl keeps scrolling the preview and never zooms
    // (spec Behaviour 13).
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || panzoom === null) {
        return
      }
      event.preventDefault()
      panzoom.zoomWithWheel(event)
    }
    const handleDoubleClick = () => {
      // In text-selection mode the double click belongs to the selection; the
      // fit control is the way back to the fit view there.
      if (modeRef.current !== 'pan') {
        return
      }
      panzoom?.reset()
    }
    // The helper reports its scale on every zoom, pan, and reset; that value is
    // what the control bar shows (spec Behaviour 14).
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ scale?: unknown }>).detail
      if (typeof detail?.scale === 'number') {
        setScale(detail.scale)
      }
    }
    // Bound on the frame, not on the diagram: the wheel zooms anywhere over
    // the diagram's area, including over its control bar.
    container.addEventListener('wheel', handleWheel, { passive: false })
    svg.addEventListener('dblclick', handleDoubleClick)
    svg.addEventListener('panzoomchange', handleChange)

    void loadPanzoom()
      .then(({ default: Panzoom }) => {
        if (disposed) {
          return
        }
        panzoom = Panzoom(svg, PANZOOM_OPTIONS)
        panzoomRef.current = panzoom
        applyInteractionMode(canvas, svg, panzoom, modeRef.current)
        setHelperReady(true)
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      container.removeEventListener('wheel', handleWheel)
      svg.removeEventListener('dblclick', handleDoubleClick)
      svg.removeEventListener('panzoomchange', handleChange)
      // destroy() removes the helper's listeners only; resetStyle() clears the
      // inline styles it set, and the frame nodes survive re-renders.
      panzoom?.destroy()
      panzoom?.resetStyle()
      panzoom = null
      panzoomRef.current = null
    }
  }, [state.status])

  function handleZoomOut(): void {
    panzoomRef.current?.zoomOut({ animate: false })
  }

  function handleZoomIn(): void {
    panzoomRef.current?.zoomIn({ animate: false })
  }

  function handleFit(): void {
    panzoomRef.current?.reset()
  }

  function handleToggleMode(): void {
    const next: InteractionMode = mode === 'pan' ? 'select' : 'pan'
    setMode(next)
    const canvas = canvasRef.current
    const svg = canvas?.querySelector('svg') ?? null
    if (canvas !== null && svg !== null) {
      applyInteractionMode(canvas, svg, panzoomRef.current, next)
    }
  }

  if (state.status === 'ready') {
    return (
      <div
        ref={containerRef}
        className={cn(
          'relative my-3 rounded-md border border-edge bg-panel',
          mode === 'pan' ? 'cursor-move' : 'cursor-text',
        )}
        data-testid={TEST_ID.fileMarkdownDiagram}
      >
        {/* The diagram markup is the helper's own element: only this box is
            clipped and transformed, never the control bar beside it. */}
        <div
          ref={canvasRef}
          className="overflow-hidden rounded-md p-3"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid returns the only acceptable markup for its own diagram, its strict mode sanitizes it with DOMPurify, and the renderer CSP keeps injected script from running (spec Business rules).
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
        {helperReady ? (
          <div
            className="absolute top-1.5 right-2 z-10 flex items-center gap-0.5 rounded-md border border-edge bg-panel/95 p-0.5 shadow-sm"
            data-testid={TEST_ID.fileMarkdownDiagramControls}
          >
            <button
              type="button"
              className={CONTROL_CLASS}
              aria-label="Zoom out"
              title="Zoom out"
              data-testid={TEST_ID.fileMarkdownDiagramZoomOut}
              disabled={scale <= FIT_SCALE + SCALE_EPSILON}
              onClick={handleZoomOut}
            >
              <Icon.minus size={14} aria-hidden="true" />
            </button>
            <span
              className="min-w-9 text-center font-mono text-[10px] tabular-nums text-ink-secondary"
              data-testid={TEST_ID.fileMarkdownDiagramZoomLevel}
            >
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className={CONTROL_CLASS}
              aria-label="Zoom in"
              title="Zoom in"
              data-testid={TEST_ID.fileMarkdownDiagramZoomIn}
              onClick={handleZoomIn}
            >
              <Icon.plus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={CONTROL_CLASS}
              aria-label="Fit to width"
              title="Fit to width"
              data-testid={TEST_ID.fileMarkdownDiagramFit}
              onClick={handleFit}
            >
              <Icon.fit size={14} aria-hidden="true" />
            </button>
            <span aria-hidden="true" className="mx-0.5 h-3.5 w-px bg-edge" />
            <button
              type="button"
              className={cn(
                CONTROL_CLASS,
                mode === 'pan' && 'bg-button-active text-ink hover:bg-button-active-hover',
              )}
              aria-label="Pan the diagram"
              aria-pressed={mode === 'pan'}
              title={
                mode === 'pan'
                  ? 'Panning: drag moves the diagram. Click for text selection.'
                  : 'Text selection: drag selects diagram text. Click to pan.'
              }
              data-testid={TEST_ID.fileMarkdownDiagramMode}
              onClick={handleToggleMode}
            >
              {mode === 'pan' ? (
                <Icon.hand size={14} aria-hidden="true" />
              ) : (
                <Icon.selectText size={14} aria-hidden="true" />
              )}
            </button>
          </div>
        ) : null}
      </div>
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
