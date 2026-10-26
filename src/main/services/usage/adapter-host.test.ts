import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { UsageAdapter, UsageDocument, UsageMetric } from '@shared/contracts/usage-contract'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertLiveRefresh,
  BUNDLED_USAGE_ADAPTERS,
  bundledUsageAdapterDirectories,
  discoverUsageAdapters,
  UsageAdapterHost,
} from './adapter-host'

const roots: string[] = []
function adapter(script: string): UsageAdapter & { directory: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-host-'))
  roots.push(dir)
  writeFileSync(join(dir, 'fixture.cjs'), script)
  return {
    id: 'fixture',
    name: 'Fixture',
    protocolVersion: 2,
    invocation: { command: process.execPath, args: ['fixture.cjs'] },
    sourceKind: 'cli',
    capabilities: ['window'],
    minimumRefreshSeconds: 60,
    configSchema: [],
    directory: dir,
  }
}
afterEach(async () => {
  // Windows can briefly hold a just-killed adapter's cwd (EPERM) under a loaded full run.
  // Only the async rm retries EPERM; rmSync in Node 24 throws it at once.
  for (const dir of roots.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})
const signal = () => new AbortController().signal
/** A Linux zombie still answers kill(pid, 0) but has already exited. */
function isZombie(pid: number): boolean {
  if (process.platform !== 'linux') return false
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z')
  } catch {
    return false
  }
}
/** Polls until a killed pid is gone; a process the test does not parent can outlive the rejection briefly. */
async function waitForProcessExit(pid: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    if (isZombie(pid)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
describe('usage adapter process boundary', () => {
  it('preserves a declared validation error with sanitized text', async () => {
    const a = adapter(
      `console.log(JSON.stringify({protocolVersion:2,ok:false,error:{code:'validation_error',message:'fixture-secret'}}));process.exitCode=1`,
    )
    await expect(new UsageAdapterHost().read(a, {}, 'account', signal())).rejects.toMatchObject({
      code: 'validation_error',
      message: 'Usage source validation_error. Check the account and retry.',
    })
  })
  it('sends configuration only in the versioned stdin request', async () => {
    const a = adapter(
      `let input=''; process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const r=JSON.parse(input);const m=(id,label)=>({id,label:String(label),kind:'window',observedAt:'2026-01-01T00:00:00Z',state:'available',usedPercent:1});console.log(JSON.stringify({protocolVersion:2,ok:true,data:{schemaVersion:1,subscriptions:[{id:r.params.connectionId,providerId:'fixture',label:'Fixture',sourceKind:'api',status:'available',metrics:[m('protocol',r.protocolVersion),m('action',r.action),m('id',r.params.connectionId),m('secret',r.config.secret),m('params',JSON.stringify(r.params)),m('argv',process.argv.join(' ').includes(r.config.secret))]}]}}))})`,
    )
    const labels = async (host: UsageAdapterHost, action: 'read' | 'refresh' = 'read') => {
      const result = await host.read(a, { secret: 'fixture-secret' }, 'account', signal(), action)
      return Object.fromEntries(
        result.subscriptions[0].metrics.map((metric) => [metric.id, metric.label]),
      )
    }
    const read = await labels(new UsageAdapterHost())
    expect(read).toMatchObject({ protocol: '2', action: 'read', id: 'account', argv: 'false' })
    expect(read.secret).toBe('fixture-secret')
    expect(JSON.parse(read.params)).not.toHaveProperty('capabilities')
    const manual = await labels(new UsageAdapterHost(), 'refresh')
    expect(manual.action).toBe('refresh')
    expect(JSON.parse(manual.params)).toEqual({
      connectionId: 'account',
      capabilities: ['partial-refresh-v1'],
    })
    const sourced = await new UsageAdapterHost().read(
      a,
      { secret: 'fixture-secret' },
      'account',
      signal(),
      'refresh',
      { refreshSources: ['claude'] },
    )
    const sourcedParams = JSON.parse(
      sourced.subscriptions[0].metrics.find((metric) => metric.id === 'params')?.label ?? '{}',
    )
    expect(sourcedParams).toEqual({
      connectionId: 'account',
      capabilities: ['partial-refresh-v1'],
      refreshSources: ['claude'],
    })
  })
  it.each([
    [`console.log(JSON.stringify({protocolVersion:1,ok:true,data:{}}))`, 'Unsupported'],
    [`console.log('{} {}')`, 'one valid JSON'],
    [
      `console.log(JSON.stringify({protocolVersion:2,ok:true,data:{}}));process.exitCode=1`,
      'exit code',
    ],
    [
      `process.stderr.write('fixture-secret');console.log(JSON.stringify({protocolVersion:2,ok:false,error:{code:'auth',message:'fixture-secret'}}));process.exitCode=1`,
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
    expect(await waitForProcessExit(pid)).toBe(true)
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
      `const label=JSON.stringify({seam:process.env.NEKODE_USAGE_TEST_BASE_URL??null,path:Boolean(process.env.PATH??process.env.Path)});console.log(JSON.stringify({protocolVersion:2,ok:true,data:{schemaVersion:1,subscriptions:[{id:'account',providerId:'fixture',label:'Fixture',sourceKind:'api',status:'available',metrics:[{id:'m',label,kind:'window',observedAt:'2026-01-01T00:00:00Z',state:'available',usedPercent:1}]}]}}))`,
    )
    const label = async (host: UsageAdapterHost) => {
      const result = await host.read(a, {}, 'account', signal())
      return JSON.parse(result.subscriptions[0].metrics[0].label)
    }
    const previous = process.env.NEKODE_USAGE_TEST_BASE_URL
    process.env.NEKODE_USAGE_TEST_BASE_URL = 'http://127.0.0.1:9'
    try {
      expect(await label(new UsageAdapterHost())).toEqual({
        seam: 'http://127.0.0.1:9',
        path: true,
      })
      expect(await label(new UsageAdapterHost(30_000, { packaged: true }))).toEqual({
        seam: null,
        path: true,
      })
    } finally {
      if (previous === undefined) delete process.env.NEKODE_USAGE_TEST_BASE_URL
      else process.env.NEKODE_USAGE_TEST_BASE_URL = previous
    }
  })
  it.runIf(process.platform === 'win32')(
    'strips case variants of the seam and run-as-node variables on Windows',
    async () => {
      // Windows variable names are case-insensitive: a child reads a variant under the exact name.
      const a = adapter(
        `const label=JSON.stringify({seam:process.env.NEKODE_USAGE_TEST_BASE_URL??null,node:process.env.ELECTRON_RUN_AS_NODE??null});console.log(JSON.stringify({protocolVersion:2,ok:true,data:{schemaVersion:1,subscriptions:[{id:'account',providerId:'fixture',label:'Fixture',sourceKind:'api',status:'available',metrics:[{id:'m',label,kind:'window',observedAt:'2026-01-01T00:00:00Z',state:'available',usedPercent:1}]}]}}))`,
      )
      const names = ['NEKODE_USAGE_TEST_BASE_URL', 'ELECTRON_RUN_AS_NODE']
      const previous = names.map((name) => process.env[name])
      for (const name of names) delete process.env[name]
      process.env.Nekode_Usage_Test_Base_Url = 'http://127.0.0.1:9'
      process.env.Electron_Run_As_Node = '1'
      try {
        const result = await new UsageAdapterHost(30_000, { packaged: true }).read(
          a,
          {},
          'account',
          signal(),
        )
        expect(JSON.parse(result.subscriptions[0].metrics[0].label)).toEqual({
          seam: null,
          node: null,
        })
      } finally {
        names.forEach((name, i) => {
          delete process.env[name]
          if (previous[i] !== undefined) process.env[name] = previous[i]
        })
      }
    },
  )
  it('uses a manifest next action for a declared failure instead of adapter text', async () => {
    const a = {
      ...adapter(
        `console.log(JSON.stringify({protocolVersion:2,ok:false,error:{code:'config',message:'fixture-secret'}}));process.exitCode=1`,
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
    write('service', { providerId: 'service-provider', summary: 'One line.', experimental: true })
    write('bad-provider', { providerId: 'Not Valid' })
    write('long-summary', { summary: 'x'.repeat(161) })
    write('bad-experimental', { experimental: 'yes' })
    const result = discoverUsageAdapters(root)
    expect(result.find((r) => r.id === 'service')).toMatchObject({
      providerId: 'service-provider',
      summary: 'One line.',
      experimental: true,
    })
    expect(result.find((r) => r.id === 'described')).toMatchObject({
      description: 'Explains privileges before enabling.',
      errorActions: { auth: 'Check the key.', config: 'Use a management key.' },
      configSchema: [{ key: 'apiKey', description: 'Write-only.' }],
    })
    expect(result.find((r) => r.id === 'described')?.error).toBeUndefined()
    for (const name of [
      'bad-code',
      'long-action',
      'long-description',
      'bad-field',
      'bad-provider',
      'long-summary',
      'bad-experimental',
    ])
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

describe('live refresh validation (spec L3)', () => {
  const start = Date.parse('2026-10-23T12:00:00.500Z')
  const document = (...metrics: Partial<UsageMetric>[]): UsageDocument => ({
    schemaVersion: 1,
    subscriptions: [
      {
        id: 'account',
        providerId: 'fixture',
        label: 'Fixture',
        sourceKind: 'api',
        status: 'available',
        metrics: metrics.map((m, i) => ({
          id: `m${i}`,
          label: `M${i}`,
          kind: 'window',
          state: 'available',
          observedAt: null,
          usedPercent: 10,
          ...m,
        })),
      },
    ],
  })
  it('accepts available metrics observed in the request second or later', () => {
    expect(() =>
      assertLiveRefresh(
        document(
          { observedAt: '2026-10-23T12:00:00Z' },
          { observedAt: '2026-10-23T12:00:07.250Z' },
          { state: 'unavailable', observedAt: null, usedPercent: null, reason: 'not_reported' },
        ),
        start,
      ),
    ).not.toThrow()
  })
  it.each([
    ['an earlier second', '2026-10-23T11:59:59.999Z'],
    ['no observation time', null],
  ])('rejects an available metric with %s as a protocol failure', (_name, observedAt) => {
    expect(() =>
      assertLiveRefresh(document({ observedAt: '2026-10-23T12:00:01Z' }, { observedAt }), start),
    ).toThrow(
      expect.objectContaining({
        code: 'protocol',
        message: 'Usage adapter did not return a live refresh.',
      }),
    )
  })
})

describe('partial refresh result parsing (PDH-13)', () => {
  const document = `{schemaVersion:1,subscriptions:[{id:'account',providerId:'fixture',label:'Fixture',sourceKind:'api',status:'available',metrics:[{id:'m1',label:'M1',kind:'window',observedAt:'2026-01-01T00:00:00Z',state:'available',usedPercent:10}]}]}`
  const script = (refresh: string) =>
    `console.log(JSON.stringify({protocolVersion:2,ok:true,data:${document},refresh:${refresh}}))`

  it('accepts the typed result and passes it beside the document', async () => {
    const result = await new UsageAdapterHost().read(
      adapter(
        script(
          `{status:'success',requestId:'request-1',measurementId:'measurement-1',reportId:'report-1',sources:[{sourceId:'source',status:'succeeded',nextAllowedAt:'2026-10-25T12:00:00Z',windows:[{metricId:'m1',status:'succeeded'}]}]}`,
        ),
      ),
      {},
      'account',
      signal(),
    )
    expect(result.subscriptions[0].metrics[0].id).toBe('m1')
    expect(result.refresh).toMatchObject({
      status: 'success',
      requestId: 'request-1',
      measurementId: 'measurement-1',
    })
    expect(result.refresh?.sources[0].nextAllowedAt).toBe('2026-10-25T12:00:00Z')
  })

  it('keeps a missing refresh field valid for older adapters', async () => {
    const result = await new UsageAdapterHost().read(
      adapter(`console.log(JSON.stringify({protocolVersion:2,ok:true,data:${document}}))`),
      {},
      'account',
      signal(),
    )
    expect(result.refresh).toBeNull()
  })

  it('rejects an invalid refresh result as a protocol validation failure', async () => {
    await expect(
      new UsageAdapterHost().read(
        adapter(script(`{status:'running',requestId:'request-1',sources:[]}`)),
        {},
        'account',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('bundled and user usage adapters', () => {
  function tree() {
    const root = mkdtempSync(join(tmpdir(), 'nekode-usage-sources-'))
    roots.push(root)
    const bundled = join(root, 'bundled'),
      user = join(root, 'user')
    mkdirSync(bundled)
    mkdirSync(user)
    const manifest = (dir: string, id: string, extra: Record<string, unknown> = {}) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'usage-adapter.json'),
        JSON.stringify({
          id,
          name: id,
          protocolVersion: 2,
          invocation: { command: 'node', args: ['index.cjs'] },
          sourceKind: 'api',
          capabilities: ['balance'],
          minimumRefreshSeconds: 300,
          configSchema: [],
          ...extra,
        }),
      )
      return dir
    }
    return { bundled, user, manifest }
  }

  it('lists bundled adapters with the NeKode executable and keeps user commands', () => {
    const { bundled, user, manifest } = tree()
    const shipped = manifest(join(bundled, 'usage-openrouter'), 'openrouter-balance')
    manifest(join(user, 'mine'), 'my-source')
    const result = discoverUsageAdapters(user, [shipped, join(bundled, 'usage-missing')])
    expect(result.find((a) => a.id === 'openrouter-balance')).toMatchObject({
      bundled: true,
      invocation: { command: process.execPath, args: ['index.cjs'] },
      directory: shipped,
    })
    expect(result.find((a) => a.id === 'my-source')).toMatchObject({
      invocation: { command: 'node', args: ['index.cjs'] },
    })
    expect(result.find((a) => a.id === 'my-source')?.bundled).toBeUndefined()
    expect(result.some((a) => a.directory?.endsWith('usage-missing'))).toBe(false)
    expect(result.every((a) => !a.error)).toBe(true)
  })

  it('lets a valid user adapter replace a bundled id, but not an invalid one', () => {
    const { bundled, user, manifest } = tree()
    const shipped = manifest(join(bundled, 'usage-codex'), 'codex')
    manifest(join(user, 'codex-fork'), 'codex', { name: 'My Codex' })
    const replaced = discoverUsageAdapters(user, [shipped]).filter((a) => a.id === 'codex')
    expect(replaced).toEqual([expect.objectContaining({ name: 'My Codex' })])
    expect(replaced[0].bundled).toBeUndefined()
    expect(replaced[0].error).toBeUndefined()

    rmSync(join(user, 'codex-fork'), { recursive: true })
    mkdirSync(join(user, 'codex-broken'))
    writeFileSync(join(user, 'codex-broken', 'usage-adapter.json'), '{"id":"codex"}')
    const kept = discoverUsageAdapters(user, [shipped])
    expect(kept.find((a) => a.id === 'codex')).toMatchObject({ bundled: true })
    expect(kept.find((a) => a.id === 'codex')?.error).toBeUndefined()
    expect(kept.find((a) => a.id === 'invalid:codex-broken')?.error).toContain('Invalid')
  })

  it('keeps user duplicates and built-in id collisions disabled', () => {
    const { bundled, user, manifest } = tree()
    const shipped = manifest(join(bundled, 'usage-elevenlabs'), 'elevenlabs')
    manifest(join(user, 'a'), 'elevenlabs')
    manifest(join(user, 'b'), 'elevenlabs')
    manifest(join(user, 'c'), 'usage-file')
    manifest(join(user, 'd'), 'claude-code-snapshots')
    const result = discoverUsageAdapters(user, [shipped])
    const ids = result.filter((a) => a.id === 'elevenlabs')
    expect(ids).toHaveLength(2)
    expect(ids.every((a) => !a.bundled && a.error?.includes('Duplicate'))).toBe(true)
    // Spec L7: the ids of removed passive sources stay unusable.
    for (const id of ['usage-file', 'claude-code-snapshots'])
      expect(result.find((a) => a.id === id)?.error).toContain('removed NeKode service')
  })

  it('lists only version 2 API or CLI manifests and names the unsupported version (L1)', () => {
    const { user, manifest } = tree()
    manifest(join(user, 'old'), 'old-protocol', { protocolVersion: 1 })
    manifest(join(user, 'file'), 'file-source', { sourceKind: 'file' })
    manifest(join(user, 'cli'), 'cli-source', { sourceKind: 'cli' })
    const result = discoverUsageAdapters(user)
    expect(result.map((a) => a.id).sort()).toEqual(['cli-source', 'invalid:file', 'invalid:old'])
    expect(result.find((a) => a.id === 'invalid:old')?.error).toBe(
      'This adapter uses an unsupported protocol version. Update it to protocol version 2, which requires live refresh.',
    )
    expect(result.find((a) => a.id === 'invalid:file')?.error).toContain('protocol version 2')
    expect(result.find((a) => a.id === 'cli-source')).toMatchObject({ protocolVersion: 2 })
    expect(result.find((a) => a.id === 'cli-source')?.error).toBeUndefined()
  })

  it('ships exactly the repository adapters listed in electron-builder.yml', () => {
    const repo = resolve(__dirname, '../../../..')
    const listed = discoverUsageAdapters(
      join(tmpdir(), 'nekode-no-user-adapters'),
      bundledUsageAdapterDirectories(false, repo, ''),
    ).filter((a) => a.directory)
    expect(listed.map((a) => a.id).sort()).toEqual(['claude-code-usage', 'codex-app-server'])
    expect(listed.every((a) => a.bundled && !a.error)).toBe(true)
    // Spec rules 22-23: every shipped service declares its provider and a picker summary.
    expect(listed.map((a) => [a.id, a.providerId, a.experimental ?? false]).sort()).toEqual([
      ['claude-code-usage', 'claude', true],
      ['codex-app-server', 'codex', true],
    ])
    expect(listed.every((a) => a.summary)).toBe(true)
    const packaged = [
      ...readFileSync(join(repo, 'electron-builder.yml'), 'utf8').matchAll(
        /to: usage-adapters\/([\w-]+)/g,
      ),
    ].map((m) => m[1])
    expect(packaged.sort()).toEqual([...BUNDLED_USAGE_ADAPTERS].sort())
  })

  it('starts a bundled adapter in Node mode and a user adapter without it', async () => {
    const a = adapter(
      `const label=JSON.stringify({runAsNode:process.env.ELECTRON_RUN_AS_NODE??null});console.log(JSON.stringify({protocolVersion:2,ok:true,data:{schemaVersion:1,subscriptions:[{id:'account',providerId:'fixture',label:'Fixture',sourceKind:'api',status:'available',metrics:[{id:'m',label,kind:'window',observedAt:'2026-01-01T00:00:00Z',state:'available',usedPercent:1}]}]}}))`,
    )
    const previous = process.env.ELECTRON_RUN_AS_NODE
    delete process.env.ELECTRON_RUN_AS_NODE
    const runAsNode = async (host: UsageAdapterHost, target: UsageAdapter) => {
      const result = await host.read(target, {}, 'account', signal())
      return JSON.parse(result.subscriptions[0].metrics[0].label)
    }
    try {
      expect(await runAsNode(new UsageAdapterHost(), { ...a, bundled: true })).toEqual({
        runAsNode: '1',
      })
      expect(await runAsNode(new UsageAdapterHost(), a)).toEqual({
        runAsNode: null,
      })
    } finally {
      if (previous !== undefined) process.env.ELECTRON_RUN_AS_NODE = previous
    }
  })
})
