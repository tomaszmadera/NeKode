// Bottom-tab session ids. They are not chat ids: a chat id is a UUID from
// the chats table, and this prefix cannot match one. The project id is embedded
// so main can terminate a project's bottom PTYs without a renderer-supplied list.
// Project ids and the tab token contain no colons (UUIDs or test ids like "p1").

const PREFIX = 'bottom:'

export function createBottomTabId(projectId: string): string {
  return `${PREFIX}${projectId}:${crypto.randomUUID()}`
}

/** Project id encoded in a bottom tab id, or null when the id is not one. */
export function bottomTabProjectId(sessionId: string): string | null {
  if (!sessionId.startsWith(PREFIX)) {
    return null
  }
  const rest = sessionId.slice(PREFIX.length)
  const separator = rest.indexOf(':')
  if (separator <= 0 || separator >= rest.length - 1) {
    return null
  }
  const token = rest.slice(separator + 1)
  if (token.includes(':')) {
    return null
  }
  return rest.slice(0, separator)
}

export function isBottomTabId(sessionId: string): boolean {
  return bottomTabProjectId(sessionId) !== null
}
