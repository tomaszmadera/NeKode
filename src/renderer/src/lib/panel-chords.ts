// Ctrl+B toggles the left panel, Ctrl+Alt+B toggles the right panel.
// Matched on the physical key so it also works when a terminal is focused and
// on layouts where event.key is not "b".

interface PanelChordEvent {
  code: string
  key?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

function isPanelChord(event: PanelChordEvent, altKey: boolean): boolean {
  const isB = event.code === 'KeyB' || event.key === 'b' || event.key === 'B'
  return isB && event.ctrlKey && event.altKey === altKey && !event.shiftKey && !event.metaKey
}

export function isLeftPanelChord(event: PanelChordEvent): boolean {
  return isPanelChord(event, false)
}

export function isRightPanelChord(event: PanelChordEvent): boolean {
  return isPanelChord(event, true)
}
