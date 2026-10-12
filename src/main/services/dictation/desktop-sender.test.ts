import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopShortcutSender, desktopHelperPath } from './desktop-sender'

function harness() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  })
  let input = ''
  child.stdin.on('data', (data) => {
    input += data.toString()
  })
  const launch = vi.fn(() => child as unknown as ChildProcessWithoutNullStreams)
  const sender = new DesktopShortcutSender('C:/app/helper.ps1', {
    platform: 'win32',
    systemRoot: 'C:/Windows',
    exists: () => true,
    launch,
    startupMs: 20,
    dispatchMs: 20,
  })
  return { child, launch, sender, input: () => input }
}

afterEach(() => {
  vi.useRealTimers()
})
describe('bounded desktop helper protocol', () => {
  it('sanitizes pre-GO initialization failure and sends no input', async () => {
    const { child, sender, input } = harness()
    const result = sender.send('123')
    child.emit('error', new Error('private-path'))
    child.stderr.write('private-path'.repeat(500))
    await expect(result).rejects.toThrow('could not start')
    expect(child.kill).toHaveBeenCalledOnce()
    expect(input()).toBe('')
    child.emit('close', 1)
  })
  it('releases the serialization latch on child error before GO even if close is never emitted', async () => {
    const { child, sender } = harness()
    const first = sender.send('123')
    child.emit('error', new Error('spawn failed'))
    await expect(first).rejects.toThrow('could not start')
    // Without close emitted, subsequent send must not fail with cleanup latch conflict
    const second = sender.send('123')
    await expect(second).rejects.not.toThrow('cleanup')
  })
  it('sends only fixed arguments, waits for READY and completes only after cleanup/exit', async () => {
    const { child, sender, input, launch } = harness()
    const result = sender.send('123')
    expect(input()).toBe('')
    child.stdout.write('REA')
    child.stdout.write('DY\n')
    expect(input()).toBe('GO\n')
    await expect(sender.send('123')).rejects.toThrow('cleanup')
    child.stdout.write('OK\n')
    child.emit('close', 0)
    await expect(result).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
    expect(launch.mock.calls[0]).toEqual([
      expect.stringContaining('powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        'C:/app/helper.ps1',
        '-ExpectedWindow',
        '123',
      ],
    ])
  })
  it.each(['close', 'overflow'])(
    'reports a sanitized pre-GO policy refusal on %s without suggesting installation repair',
    async (failure) => {
      const { child, sender, input, launch } = harness()
      const result = sender.send('123')
      // The invariant exception identifier survives localized PowerShell diagnostics.
      child.stderr.write(
        'C:/private/helper.ps1 : blocked\nCategoryInfo: SecurityError: [], PSSecurity',
      )
      child.stderr.write('Exception\nFullyQualifiedErrorId: UnauthorizedAccess\n')
      if (failure === 'overflow') child.stderr.write('private-path'.repeat(500))
      child.emit('close', 1)
      await expect(result).rejects.toMatchObject({
        message:
          "Windows PowerShell policy blocked the desktop dictation helper. Ask your administrator whether NeKode's bundled helper is permitted.",
      })
      expect(input()).toBe('')
      expect(launch).toHaveBeenCalledOnce()
    },
  )
  it('keeps generic pre-GO failures distinct from policy refusals', async () => {
    const { child, sender, input } = harness()
    const result = sender.send('123')
    child.stderr.write('C:/private/helper.ps1: compiler failure')
    child.emit('close', 1)
    await expect(result).rejects.toThrow('Repair your NeKode installation')
    expect(input()).toBe('')
  })
  it('recognizes the actual Windows PowerShell -File Restricted-policy diagnostic', async () => {
    const { child, sender, input } = harness()
    const result = sender.send('123')
    child.stderr.write(
      'File C:/private/helper.ps1 cannot be loaded.\r\n' +
        '    + CategoryInfo          : SecurityError: (:) [], ParentContainsErrorRecordException\r\n' +
        '    + FullyQualifiedErrorId : UnauthorizedAccess',
    )
    child.emit('close', 1)
    await expect(result).rejects.toThrow('PowerShell policy blocked')
    expect(input()).toBe('')
  })
  it('does not mistake an unrelated access error for a policy refusal', async () => {
    const { child, sender } = harness()
    const result = sender.send('123')
    child.stderr.write(
      'CategoryInfo: PermissionDenied: [], UnauthorizedAccessException\n' +
        'FullyQualifiedErrorId: UnauthorizedAccess',
    )
    child.emit('close', 1)
    await expect(result).rejects.toThrow('Repair your NeKode installation')
  })
  it('never classifies a post-GO failure as a harmless policy refusal', async () => {
    const { child, sender } = harness()
    const result = sender.send('123')
    child.stdout.write('READY\n')
    child.stderr.write('PSSecurityException: private-path')
    child.emit('close', 1)
    await expect(result).rejects.toThrow('uncertain')
    expect(child.kill).not.toHaveBeenCalled()
  })
  it('may kill before GO, never sends GO after startup deadline', async () => {
    vi.useFakeTimers()
    const { child, sender, input } = harness()
    const result = sender.send('123')
    const rejected = expect(result).rejects.toThrow('ready')
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(child.kill).toHaveBeenCalledOnce()
    child.stdout.write('READY\n')
    expect(input()).toBe('')
    child.emit('close', null)
  })
  it('bounds caller wait after GO without killing or releasing the cleanup latch', async () => {
    vi.useFakeTimers()
    const { child, sender } = harness()
    const result = sender.send('123')
    child.stdout.write('READY\n')
    const rejected = expect(result).rejects.toThrow('uncertain')
    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(child.kill).not.toHaveBeenCalled()
    await expect(sender.send('123')).rejects.toThrow('cleanup')
    child.emit('close', 0)
  })
  it.each(['FOREGROUND', 'MODIFIERS', 'SEND_UNCERTAIN', 'RELEASE_UNCERTAIN'])(
    'reports %s without retry',
    async (code) => {
      const { child, sender, launch } = harness()
      const result = sender.send('123')
      child.stdout.write(`READY\n${code}\n`)
      child.emit('close', 1)
      await expect(result).rejects.toThrow(
        code === 'FOREGROUND' ? 'owning' : code === 'MODIFIERS' ? 'Release' : 'uncertain',
      )
      expect(launch).toHaveBeenCalledOnce()
      expect(child.kill).not.toHaveBeenCalled()
    },
  )
  it('sanitizes overflow and native error races after GO and keeps cleanup alive', async () => {
    const { child, sender } = harness()
    const result = sender.send('123')
    child.stdout.write('READY\n')
    child.stderr.write('private-path'.repeat(500))
    child.emit('error', new Error('private-path'))
    await expect(result).rejects.toThrow('uncertain')
    expect(child.kill).not.toHaveBeenCalled()
    await expect(sender.send('123')).rejects.toThrow('cleanup')
    child.emit('close', 1)
  })
  it('rejects unavailable platform/helper and invalid window without spawning', async () => {
    const launch = vi.fn()
    await expect(
      new DesktopShortcutSender('missing', { platform: 'linux', launch }).send('123'),
    ).rejects.toThrow('Windows')
    await expect(
      new DesktopShortcutSender('missing', { platform: 'win32', exists: () => false, launch }).send(
        '123',
      ),
    ).rejects.toThrow('unavailable')
    await expect(
      new DesktopShortcutSender('missing', { platform: 'win32', exists: () => true, launch }).send(
        '123;command',
      ),
    ).rejects.toThrow('window')
    expect(launch).not.toHaveBeenCalled()
  })
  it('maps development and packaged paths to the production helper resource', () => {
    expect(desktopHelperPath(false, 'app', 'res')).toBe(
      join('app', 'resources', 'dictation', 'desktop-shortcut.ps1'),
    )
    expect(desktopHelperPath(true, 'app.asar', 'res')).toBe(
      join('res', 'dictation', 'desktop-shortcut.ps1'),
    )
    const config = readFileSync('electron-builder.yml', 'utf8')
    expect(config).toContain('from: resources/dictation/desktop-shortcut.ps1')
    expect(config).toContain('to: dictation/desktop-shortcut.ps1')
  })
})
