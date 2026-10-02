// Ctrl+N starts a new chat in the active project (spec Behaviour 3 path).
// Matched on the physical key so it also works when a terminal is focused and
// on layouts where event.key is not "n".
export function isNewChatChord(event: {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}): boolean {
  return (
    event.code === 'KeyN' && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey
  )
}
