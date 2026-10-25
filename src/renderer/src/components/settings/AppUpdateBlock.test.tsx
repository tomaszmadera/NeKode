import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppApi } from '../../../../shared/ipc-contract'
import { TEST_ID } from '../../lib/test-ids'
import { createAppApiStub } from '../../test/app-api-stub'
import { AppUpdateBlock } from './AppUpdateBlock'

afterEach(cleanup)

function appFor(
  platform: string | undefined,
  latest = createAppApiStub().appUpdate.latest,
): AppApi {
  const app = createAppApiStub()
  app.platform = platform
  app.appUpdate.latest = latest
  return app
}

describe('AppUpdateBlock', () => {
  it('shows the installed version and no update action outside an installed Windows build', () => {
    const app = appFor('linux')
    render(<AppUpdateBlock app={app} />)
    expect(screen.getByText('v0.0.0-test')).toBeTruthy()
    expect(
      screen.getByText('Update from this screen is only for an installed Windows build.'),
    ).toBeTruthy()
    expect(screen.queryByTestId(TEST_ID.appUpdateButton)).toBeNull()
    expect(app.appUpdate.latest).not.toHaveBeenCalled()
  })

  it('shows a muted latest version and leaves Update usable when the check fails', async () => {
    const app = appFor(
      'win32',
      vi.fn().mockResolvedValue({
        canInstall: true,
        version: null,
        error: 'Could not read the latest release.',
      }),
    )
    render(<AppUpdateBlock app={app} />)
    expect(await screen.findByText('Could not read the latest release.')).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.appUpdateButton).hasAttribute('disabled')).toBe(false)
    expect(screen.getByText(/SmartScreen/)).toBeTruthy()
    expect(screen.queryByText(/update available/i)).toBeNull()
  })

  it('downloads, then starts the installer, and ignores a second click', async () => {
    let releaseDownload: () => void = () => undefined
    const app = appFor(
      'win32',
      vi.fn().mockResolvedValue({
        canInstall: true,
        version: '0.16.0',
        error: null,
      }),
    )
    app.appUpdate.download = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseDownload = resolve
        }),
    )
    render(<AppUpdateBlock app={app} />)
    expect(await screen.findByText('Latest release 0.16.0')).toBeTruthy()
    const button = screen.getByTestId(TEST_ID.appUpdateButton)
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByText('Downloading the installer...')).toBeTruthy()
    expect(app.appUpdate.download).toHaveBeenCalledOnce()
    expect(button.hasAttribute('disabled')).toBe(true)
    releaseDownload()
    expect(await screen.findByText('Starting the installer...')).toBeTruthy()
    expect(app.appUpdate.launch).toHaveBeenCalledOnce()
  })

  it('shows a download failure and allows Update again', async () => {
    const app = appFor(
      'win32',
      vi.fn().mockResolvedValue({
        canInstall: true,
        version: '0.16.0',
        error: null,
      }),
    )
    app.appUpdate.download = vi
      .fn()
      .mockRejectedValue({ message: 'The installer checksum does not match.' })
    render(<AppUpdateBlock app={app} />)
    fireEvent.click(await screen.findByTestId(TEST_ID.appUpdateButton))
    expect(await screen.findByText('The installer checksum does not match.')).toBeTruthy()
    expect(screen.getByTestId(TEST_ID.appUpdateButton).hasAttribute('disabled')).toBe(false)
    expect(app.appUpdate.launch).not.toHaveBeenCalled()
  })
})
