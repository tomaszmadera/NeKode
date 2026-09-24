// Structural, Electron-free trust check for IPC senders (SDD §6: IPC must
// verify the calling frame). The adapter in ipc-handlers maps a real
// IpcMainInvokeEvent to InvokeSenderInfo so this logic stays unit-testable.

export interface InvokeSenderInfo {
  /** senderFrame.url; null/undefined when no frame is attached. */
  url: string | null | undefined
  /** True only when the invoking frame is the window's main frame. */
  isMainFrame: boolean
}

/**
 * Fail-closed URL trust check: the frame URL must exactly match a trusted
 * renderer URL (the loaded document) or live under a trusted dev-server root.
 */
export function isTrustedRendererUrl(url: unknown, trustedUrls: readonly string[]): boolean {
  if (typeof url !== 'string' || trustedUrls.length === 0) {
    return false
  }
  return trustedUrls.some((trusted) => {
    if (typeof trusted !== 'string' || trusted.length === 0) {
      return false
    }
    const prefix = trusted.endsWith('/') ? trusted : `${trusted}/`
    return url === trusted || url.startsWith(prefix)
  })
}

/** Only the main frame of the trusted renderer may invoke privileged IPC. */
export function isTrustedSender(sender: InvokeSenderInfo, trustedUrls: readonly string[]): boolean {
  return sender.isMainFrame && isTrustedRendererUrl(sender.url, trustedUrls)
}
