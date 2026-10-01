import type React from 'react'
import nekodeMark from '../../assets/brand/cat-icon-tile.svg'

// Application brand for the window title bar (user decision 2026-10-01): the
// cat mark plus the application name at the left end of the continuous
// full-width strip; Windows caption buttons sit at the right end. Rendered
// inside the drag region; no interactive parts, so nothing opts out of
// dragging.
export function AppBrand(): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
      <img src={nekodeMark} alt="" className="h-4 w-4 shrink-0" aria-hidden />
      NeKode
    </div>
  )
}
