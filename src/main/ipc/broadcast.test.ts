import { describe, expect, it, vi } from 'vitest'
import { broadcastToTrustedWindows, type WindowWithWebContents } from './broadcast'

describe('broadcastToTrustedWindows', () => {
  const TRUSTED_URLS = ['file:///path/to/app/index.html', 'http://localhost:5173']

  it('sends IPC event to windows whose webContents URL is trusted', () => {
    const trustedSend = vi.fn()
    const trustedWindow: WindowWithWebContents = {
      webContents: {
        getURL: () => 'http://localhost:5173/index.html',
        send: trustedSend,
      },
    }

    broadcastToTrustedWindows(
      [trustedWindow],
      TRUSTED_URLS,
      'terminals:data',
      'chat-1',
      'terminal output',
    )

    expect(trustedSend).toHaveBeenCalledOnce()
    expect(trustedSend).toHaveBeenCalledWith('terminals:data', 'chat-1', 'terminal output')
  })

  it('filters out windows whose webContents URL is not trusted', () => {
    const untrustedSend = vi.fn()
    const untrustedWindow: WindowWithWebContents = {
      webContents: {
        getURL: () => 'https://evil.com/phishing',
        send: untrustedSend,
      },
    }

    broadcastToTrustedWindows([untrustedWindow], TRUSTED_URLS, 'terminals:data', 'chat-1', 'secret')

    expect(untrustedSend).not.toHaveBeenCalled()
  })

  it('sends only to trusted windows when multiple windows exist', () => {
    const trustedSend = vi.fn()
    const untrustedSend = vi.fn()

    const trustedWindow: WindowWithWebContents = {
      webContents: {
        getURL: () => 'file:///path/to/app/index.html',
        send: trustedSend,
      },
    }
    const untrustedWindow: WindowWithWebContents = {
      webContents: {
        getURL: () => 'https://malicious.org',
        send: untrustedSend,
      },
    }

    broadcastToTrustedWindows([trustedWindow, untrustedWindow], TRUSTED_URLS, 'dictation:result', {
      text: 'transcription',
    })

    expect(trustedSend).toHaveBeenCalledOnce()
    expect(trustedSend).toHaveBeenCalledWith('dictation:result', { text: 'transcription' })
    expect(untrustedSend).not.toHaveBeenCalled()
  })

  it('does not send to any window when trustedUrls list is empty', () => {
    const send = vi.fn()
    const window: WindowWithWebContents = {
      webContents: {
        getURL: () => 'http://localhost:5173',
        send,
      },
    }

    broadcastToTrustedWindows([window], [], 'terminals:exit', 'chat-1', 0)

    expect(send).not.toHaveBeenCalled()
  })
})
