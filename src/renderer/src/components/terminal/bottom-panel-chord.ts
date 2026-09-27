// Ctrl+` (spec Behaviour 3). Matched on the physical key so it also works
// when a terminal is focused and on layouts where event.key is not "`".
export function isBottomPanelChord(event: {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  return (
    event.code === 'Backquote' &&
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey
  )
}
