import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageAdapter } from '../../../shared/usage-contract'
import { discoverUsageAdapters, UsageAdapterHost } from './adapter-host'

const roots: string[] = []
function adapter(script: string): UsageAdapter & { directory: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-host-'))
  roots.push(dir)
  writeFileSync(join(dir, 'fixture.cjs'), script)
  return {
    id: 'fixture',
    name: 'Fixture',
    protocolVersion: 1,
    invocation: { command: process.execPath, args: ['fixture.cjs'] },
    sourceKind: 'cli',
    capabilities: ['window'],
    minimumRefreshSeconds: 60,
    configSchema: [],
    directory: dir,
  }
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const signal = () => new AbortController().signal
describe('usage adapter process boundary', () => {
  it('preserves a declared validation error with sanitized text', async () => {
    const a = adapter(
      `console.log(JSON.stringify({protocolVersion:1,ok:false,error:{code:'validation_error',message:'fixture-secret'}}));process.exitCode=1`,
    )
    await expect(new UsageAdapterHost().read(a, {}, 'account', signal())).rejects.toMatchObject({
      code: 'validation_error',
      message: 'Usage source validation_error. Check the connection and retry.',
    })
  })
  it('sends configuration only in the versioned stdin request', async () => {
    const a = adapter(
      `let input=''; process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);console.log(JSON.stringify({protocolVersion:1,ok:true,data:{protocol:r.protocolVersion,action:r.action,id:r.params.connectionId,secret:r.config.secret,argv:process.argv}}))})`,
    )
    const result = (await new UsageAdapterHost().read(
      a,
      { secret: 'fixture-secret' },
      'account',
      signal(),
    )) as { secret: string; argv: string[]; protocol: number; action: string; id: string }
    expect(result.secret).toBe('fixture-secret')
    expect(result.argv.join(' ')).not.toContain('fixture-secret')
    expect(result).toMatchObject({ protocol: 1, action: 'read', id: 'account' })
  })
  it.each([
    [`console.log(JSON.stringify({protocolVersion:2,ok:true,data:{}}))`, 'Unsupported'],
    [`console.log('{} {}')`, 'one valid JSON'],
    [
      `console.log(JSON.stringify({protocolVersion:1,ok:true,data:{}}));process.exitCode=1`,
      'exit code',
    ],
    [
      `process.stderr.write('fixture-secret');console.log(JSON.stringify({protocolVersion:1,ok:false,error:{code:'auth',message:'fixture-secret'}}));process.exitCode=1`,
      'source auth',
    ],
    [`process.stdout.write('x'.repeat(1048577))`, 'exceeds'],
    [`process.stderr.write('x'.repeat(8193));setInterval(()=>{},1000)`, 'diagnostics'],
  ])('rejects protocol failures without returning raw diagnostics', async (script, message) => {
    await expect(
      new UsageAdapterHost().read(adapter(script), {}, 'account', signal()),
    ).rejects.toMatchObject({ message: expect.stringContaining(message) })
    if (script.includes('fixture-secret'))
      await expect(
        new UsageAdapterHost().read(adapter(script), {}, 'account', signal()),
      ).rejects.not.toMatchObject({ message: expect.stringContaining('fixture-secret') })
  })
  it('terminates the process tree after timeout', async () => {
    const a = adapter(
      `const fs=require('node:fs'),{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000)`,
    )
    await expect(new UsageAdapterHost(700).read(a, {}, 'account', signal())).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(existsSync(join(a.directory, 'child.pid'))).toBe(true)
    const pid = Number(readFileSync(join(a.directory, 'child.pid'), 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('cancels an obsolete process', async () => {
    const controller = new AbortController()
    const pending = new UsageAdapterHost().read(
      adapter('setInterval(()=>{},1000)'),
      {},
      'account',
      controller.signal,
    )
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toMatchObject({ code: 'config' })
  })
  it('reaps an active adapter when the application shuts down', async () => {
    const a = adapter(
      `require('node:fs').writeFileSync('active.pid',String(process.pid));setInterval(()=>{},1000)`,
    )
    const host = new UsageAdapterHost()
    const pending = host.read(a, {}, 'account', signal())
    for (let attempt = 0; attempt < 50 && !existsSync(join(a.directory, 'active.pid')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    expect(existsSync(join(a.directory, 'active.pid'))).toBe(true)
    const pid = Number(readFileSync(join(a.directory, 'active.pid'), 'utf8'))
    host.shutdown()
    await expect(pending).rejects.toMatchObject({ code: 'protocol' })
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('passes the test base URL seam only to adapters of an unpackaged app', async () => {
    const a = adapter(
      `console.log(JSON.stringify({protocolVersion:1,ok:true,data:{seam:process.env.NEKODE_USAGE_TEST_BASE_URL??null,path:Boolean(process.env.PATH??process.env.Path)}}))`,
    )
    const previous = process.env.NEKODE_USAGE_TEST_BASE_URL
    process.env.NEKODE_USAGE_TEST_BASE_URL = 'http://127.0.0.1:9'
    try {
      expect(await new UsageAdapterHost().read(a, {}, 'account', signal())).toEqual({
        seam: 'http://127.0.0.1:9',
        path: true,
      })
      expect(
        await new UsageAdapterHost(30_000, { packaged: true }).read(a, {}, 'account', signal()),
      ).toEqual({ seam: null, path: true })
    } finally {
      if (previous === undefined) delete process.env.NEKODE_USAGE_TEST_BASE_URL
      else process.env.NEKODE_USAGE_TEST_BASE_URL = previous
    }
  })
  it('uses a manifest next action for a declared failure instead of adapter text', async () => {
    const a = {
      ...adapter(
        `console.log(JSON.stringify({protocolVersion:1,ok:false,error:{code:'config',message:'fixture-secret'}}));process.exitCode=1`,
      ),
      errorActions: { config: 'Use a fixture management key.' },
    }
    await expect(new UsageAdapterHost().read(a, {}, 'account', signal())).rejects.toMatchObject({
      code: 'config',
      message: 'Usage source config. Use a fixture management key.',
    })
  })
  it('accepts bounded descriptions and next actions and rejects invalid ones', () => {
    const a = adapter(''),
      root = a.directory
    const write = (name: string, extra: Record<string, unknown>) => {
      mkdirSync(join(root, name))
      writeFileSync(
        join(root, name, 'usage-adapter.json'),
        JSON.stringify({ ...a, id: name, directory: undefined, ...extra }),
      )
    }
    write('described', {
      description: 'Explains privileges before enabling.',
      errorActions: { auth: 'Check the key.', config: 'Use a management key.' },
      configSchema: [
        { key: 'apiKey', label: 'Key', type: 'secret', required: true, description: 'Write-only.' },
      ],
    })
    write('bad-code', { errorActions: { teapot: 'No.' } })
    write('long-action', { errorActions: { auth: 'x'.repeat(257) } })
    write('long-description', { description: 'x'.repeat(1025) })
    write('bad-field', {
      configSchema: [{ key: 'k', label: 'K', type: 'text', description: 'x'.repeat(513) }],
    })
    const result = discoverUsageAdapters(root)
    expect(result.find((r) => r.id === 'described')).toMatchObject({
      description: 'Explains privileges before enabling.',
      errorActions: { auth: 'Check the key.', config: 'Use a management key.' },
      configSchema: [{ key: 'apiKey', description: 'Write-only.' }],
    })
    expect(result.find((r) => r.id === 'described')?.error).toBeUndefined()
    for (const name of ['bad-code', 'long-action', 'long-description', 'bad-field'])
      expect(result.find((r) => r.id === `invalid:${name}`)?.error).toContain('Invalid')
  })
  it('lists invalid manifests disabled and disables every duplicate', () => {
    const a = adapter(''),
      root = a.directory
    mkdirSync(join(root, 'one'))
    mkdirSync(join(root, 'two'))
    mkdirSync(join(root, 'invalid'))
    for (const name of ['one', 'two'])
      writeFileSync(join(root, name, 'usage-adapter.json'), JSON.stringify({ ...a, id: 'same' }))
    writeFileSync(join(root, 'invalid', 'usage-adapter.json'), '{}')
    const result = discoverUsageAdapters(root)
    expect(result.filter((a) => a.id === 'same')).toHaveLength(2)
    expect(result.filter((a) => a.id === 'same').every((a) => a.error?.includes('Duplicate'))).toBe(
      true,
    )
    expect(result.find((a) => a.id === 'invalid:invalid')?.error).toContain('Invalid')
  })
})
