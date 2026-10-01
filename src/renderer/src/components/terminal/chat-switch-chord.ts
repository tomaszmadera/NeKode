// Ctrl+Tab (next chat) and Ctrl+Shift+Tab (previous chat) within the active
// project (NEKODE-2). Matched on the physical key so it also works when a
// terminal is focused and on layouts where event.key is not "Tab".
export type ChatSwitchDirection = 1 | -1

export function chatSwitchDirection(event: {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}): ChatSwitchDirection | null {
  if (event.code !== 'Tab' || !event.ctrlKey || event.altKey || event.metaKey) {
    return null
  }
  return event.shiftKey ? -1 : 1
}
