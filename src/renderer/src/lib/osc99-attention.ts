// OSC 99 (kitty desktop-notification protocol) for the chat attention badge
// (docs/features/chat-attention-badge/spec.md Behaviour 10-11).
//
// OpenCode (OpenTUI) asks for this protocol at startup with
// `ESC ] 99 ; i=opentui-notifications:p=? ; ST` and emits OSC 99 notifications
// only after the terminal answers. This module is the pure part: it reads one
// OSC 99 body (the xterm handler's string after `99;`) and says whether the
// view must write a capability reply, raise attention, or do nothing.

/** What the chat view does with one OSC 99 string. */
export type Osc99Action =
  | { kind: 'reply'; data: string }
  | { kind: 'notice'; message: string | null }
  | null

export interface Osc99Attention {
  take(body: string): Osc99Action
}

const VALID_ID = /^[A-Za-z0-9._+-]{1,64}$/
// A program that never finishes its `d=0` chunks must not grow memory without
// bound. The tooltip keeps 120 characters (chat-attention.ts), so these caps
// never shorten visible text.
const MAX_PENDING = 16
const MAX_TEXT = 1024

interface Pending {
  title: string
  body: string
}

function parseMetadata(metadata: string): Map<string, string> {
  const pairs = new Map<string, string>()
  for (const pair of metadata.split(':')) {
    const separator = pair.indexOf('=')
    if (separator !== 1) continue
    pairs.set(pair[0], pair.slice(2))
  }
  return pairs
}

/** Base64 UTF-8 payload (`e=1`); null when it does not decode. */
function decodeBase64(payload: string): string | null {
  let binary: string
  try {
    binary = atob(payload)
  } catch {
    // atob signals malformed base64 only by throwing (InvalidCharacterError).
    return null
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // A fatal decoder signals invalid UTF-8 only by throwing.
    return null
  }
}

function noticeMessage({ title, body }: Pending): string | null {
  if (title.length > 0 && body.length > 0) return `${title}: ${body}`
  if (body.length > 0) return body
  return title.length > 0 ? title : null
}

export function createOsc99Attention(): Osc99Attention {
  const pending = new Map<string, Pending>()

  return {
    take(body) {
      // Kitty requires `metadata ; payload`; without the separator the string
      // is malformed and raises nothing, like an unterminated OSC 9.
      const separator = body.indexOf(';')
      if (separator === -1) return null
      const metadata = body.slice(0, separator)
      const payload = body.slice(separator + 1)
      const keys = parseMetadata(metadata)
      const id = keys.get('i') ?? ''
      const kind = keys.get('p') ?? 'title'

      if (kind === '?') {
        // A non-empty payload is a reply echoed back to us; answering it
        // would loop.
        if (payload.length > 0) return null
        const replyId = VALID_ID.test(id) ? id : '0'
        return { kind: 'reply', data: `\x1b]99;i=${replyId}:p=?;p=title,body\x1b\\` }
      }
      if (kind !== 'title' && kind !== 'body') {
        // Any chunk without d=0 finishes the notification, whatever its kind.
        const held = pending.get(id)
        if (held === undefined || keys.get('d') === '0') return null
        pending.delete(id)
        return { kind: 'notice', message: noticeMessage(held) }
      }

      const text = keys.get('e') === '1' ? decodeBase64(payload) : payload
      if (text === null) {
        pending.delete(id)
        return null
      }
      const current = pending.get(id) ?? { title: '', body: '' }
      current[kind] = (current[kind] + text).slice(0, MAX_TEXT)

      if (keys.get('d') === '0') {
        pending.delete(id)
        pending.set(id, current)
        if (pending.size > MAX_PENDING) {
          const oldest = pending.keys().next().value
          if (oldest !== undefined) pending.delete(oldest)
        }
        return null
      }
      pending.delete(id)
      return { kind: 'notice', message: noticeMessage(current) }
    },
  }
}
