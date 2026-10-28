import type React from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LEFT_REGION_SIZE } from '../../hooks/useResizableRegion'
import { cn } from '../../lib/cn'
import { TEST_ID } from '../../lib/test-ids'
import { ResizeHandle } from './ResizeHandle'

// Paired slide between Projects and Project Files (user decision 2026-10-07).
// Both views sit side by side in a track. This slot clips the one that is
// outside it, and the track translates by one panel width so the outgoing
// view leaves as the incoming view arrives. prefers-reduced-motion, and a
// runtime without matchMedia, swap the views with no track.

export type LeftPanelView = 'projects' | 'files'

interface LeftPanelTrackProps {
  /** Settled view the track should show. A change runs the paired slide. */
  view: LeftPanelView
  width: number
  /** Floating theme: the slot is a detached rounded card. The views inside
      stay full-bleed so the frame does not travel twice. */
  floating?: boolean
  onResizeStart: (event: React.PointerEvent<HTMLElement>) => void
  onResizeNudge: (delta: number) => void
  projects: React.ReactNode
  /** Null while Project Files is closed. The last node is kept for the
      slide back to Projects, because the parent drops it in the same render. */
  files: React.ReactNode
}

interface Slide {
  from: LeftPanelView
  to: LeftPanelView
  /** False on the commit that places both views at the start offset, with
      no transition. True once that offset has been flushed and the track
      may move. */
  run: boolean
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return true
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function transitionDurationMs(node: HTMLElement): number {
  const first = window.getComputedStyle(node).transitionDuration.split(',')[0]?.trim() ?? '0s'
  if (first.endsWith('ms')) {
    return Number.parseFloat(first)
  }
  if (first.endsWith('s')) {
    return Number.parseFloat(first) * 1000
  }
  return 0
}

export function LeftPanelTrack({
  view,
  width,
  floating = false,
  onResizeStart,
  onResizeNudge,
  projects,
  files,
}: LeftPanelTrackProps): React.JSX.Element {
  const [shown, setShown] = useState(view)
  const [slide, setSlide] = useState<Slide | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const slideRef = useRef(slide)
  slideRef.current = slide
  // The parent clears `files` as soon as it asks to leave Project Files.
  // Hold the last node so that view can travel with Projects.
  const retainedFiles = useRef(files)
  if (files != null) {
    retainedFiles.current = files
  }

  // Apply a view change before paint so the first frame already has both
  // views at the start offset, instead of swapping and then sliding.
  const headingTo = slide?.to ?? shown
  if (view !== headingTo) {
    if (prefersReducedMotion()) {
      if (slide !== null) {
        setSlide(null)
      }
      if (shown !== view) {
        setShown(view)
      }
    } else if (slide?.run) {
      setSlide({ from: slide.to, to: view, run: true })
    } else if (slide !== null && view === slide.from) {
      setSlide(null)
    } else if (slide !== null) {
      setSlide({ ...slide, to: view })
    } else {
      setSlide({ from: shown, to: view, run: false })
    }
  }

  useLayoutEffect(() => {
    if (slide === null || slide.run) {
      return
    }
    // Flush the start offset, then enable the transition. Without the read,
    // the end offset replaces the start offset before the browser records a
    // transition.
    void trackRef.current?.offsetWidth
    setSlide((current) => (current !== null && !current.run ? { ...current, run: true } : current))
  }, [slide])

  useEffect(() => {
    if (slide === null || !slide.run) {
      return
    }
    const node = trackRef.current
    const duration = node === null ? 0 : transitionDurationMs(node)
    // No stylesheet (unit tests) reports 0s. Leave the settle to
    // transitionend. A real duration gets a backup in case the event never
    // arrives.
    if (duration < 1) {
      return
    }
    const target = slide.to
    const timer = window.setTimeout(() => {
      setShown(target)
      setSlide((current) => (current !== null && current.to === target ? null : current))
    }, duration + 50)
    return () => {
      window.clearTimeout(timer)
    }
  }, [slide])

  function settle(event: React.TransitionEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform') {
      return
    }
    const current = slideRef.current
    if (current === null || !current.run) {
      return
    }
    setShown(current.to)
    setSlide(null)
  }

  const sliding = slide !== null
  const showProjects = sliding || shown === 'projects'
  const showFiles = sliding || shown === 'files'
  const filesNode = files ?? retainedFiles.current
  const slideState = slide?.run ? 'sliding' : shown === 'files' ? 'open' : 'closed'

  let currentTransform: string | undefined
  if (sliding) {
    const target = slide.run ? slide.to : slide.from
    currentTransform = target === 'files' ? 'translateX(0)' : 'translateX(-50%)'
  } else if (shown === 'files') {
    currentTransform = 'translateX(0)'
  } else {
    currentTransform = 'translateX(-50%)'
  }

  return (
    <aside
      className={cn(
        'relative min-h-0 shrink-0 overflow-hidden bg-panel',
        floating ? 'm-2 rounded-[10px] border border-edge' : 'border-r border-edge rounded-none',
      )}
      style={{
        flex: '1 1 320px',
        maxWidth: 340,
        minWidth: 0,
        height: '100%',
        margin: floating ? 0 : undefined,
        width,
      }}
      data-testid={TEST_ID.leftNav}
      data-slide-state={sliding ? 'sliding' : view === 'files' ? 'open' : 'closed'}
      data-panel-visible={view === 'files' ? 'true' : 'false'}
    >
      <div
        ref={trackRef}
        className={cn(
          'left-panel-track absolute inset-0 flex',
          slide?.run && 'left-panel-track-run',
        )}
        style={{
          width: '200%',
          height: '100%',
          right: 'auto',
          transform: currentTransform,
          transition: slide?.run ? 'transform .32s cubic-bezier(.22,.8,.24,1)' : undefined,
        }}
        data-slide-state={slideState}
        onTransitionEnd={settle}
      >
        <section
          className="h-full shrink-0"
          style={{ width: '50%', minWidth: 0 }}
          aria-label="Files"
          aria-hidden={shown !== 'files'}
        >
          {showFiles && filesNode != null ? filesNode : null}
        </section>
        <section
          className="h-full shrink-0"
          style={{ width: '50%', minWidth: 0 }}
          aria-label="Projects"
          aria-hidden={shown !== 'projects'}
        >
          {showProjects ? projects : null}
        </section>
      </div>
      <ResizeHandle
        axis="x"
        size={width}
        minSize={LEFT_REGION_SIZE.min}
        maxSize={LEFT_REGION_SIZE.max}
        onResizeStart={onResizeStart}
        onResizeNudge={onResizeNudge}
        testId={TEST_ID.leftResizeHandle}
      />
    </aside>
  )
}
