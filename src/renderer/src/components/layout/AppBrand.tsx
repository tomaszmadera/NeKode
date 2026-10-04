import type React from 'react'
import nekodeMark from '../../assets/brand/cat-icon-tile.svg'

// Application brand for the window title bar (user decision 2026-10-01): the
// cat mark plus the application name at the left end of the continuous
// full-width strip; Windows caption buttons sit at the right end. Rendered
// inside the drag region; no interactive parts, so nothing opts out of
// dragging. Sized once here, so every theme gets identical dimensions
// (user decision 2026-10-04: 50% larger than the 2026-10-01 sizing).
export function AppBrand(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-lg font-semibold text-ink">
      <img src={nekodeMark} alt="" className="h-6 w-6 shrink-0" aria-hidden />
      NeKode
    </div>
  )
}
