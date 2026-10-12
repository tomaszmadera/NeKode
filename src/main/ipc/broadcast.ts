import { isTrustedRendererUrl } from '../security/sender-guard'

export interface WindowWithWebContents {
  webContents: {
    getURL(): string
    send(channel: string, ...args: unknown[]): void
  }
}

/**
 * Sends IPC messages only to windows whose current webContents URL
 * is verified by isTrustedRendererUrl against trustedRendererUrls.
 */
export function broadcastToTrustedWindows(
  windows: Iterable<WindowWithWebContents>,
  trustedUrls: readonly string[],
  channel: string,
  ...args: unknown[]
): void {
  for (const window of windows) {
    if (isTrustedRendererUrl(window.webContents.getURL(), trustedUrls)) {
      window.webContents.send(channel, ...args)
    }
  }
}
