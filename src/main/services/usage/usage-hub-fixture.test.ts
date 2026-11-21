import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageSettings } from '@shared/contracts/usage-contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageService } from './usage-service'

/**
 * NEKODE-191 Stage 2: a fixture hub adapter process, started by the real adapter host, reports four
 * subscriptions. Scheduled reads return 10%; a manual refresh returns 55% for the selected
 * subscriptions only. Metrics come in another order than the declarations, so consumers must use
 * the declared report order. Google AI is readable but not refreshable.
 */
const HUB_SCRIPT = `
const LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', 'google-ai': 'Google AI', 'opencode-go': 'OpenCode Go' }
const ORDER = ['chatgpt', 'claude', 'google-ai', 'opencode-go']
let input = ''
process.stdin.on('data', (chunk) => { input += chunk })
process.stdin.on('end', () => {
  const request = JSON.parse(input)
  const selected = request.params.refreshSubscriptions
  const ids = selected ?? ORDER
  const observedAt = new Date().toISOString()
  const metrics = [...ids].reverse().map((id) => ({
    id: id + '-5h',
    label: LABELS[id] + ' 5h',
    subscriptionId: id,
    kind: 'window',
    state: 'available',
    observedAt,
    usedPercent: request.action === 'refresh' ? 55 : 10,
    resetsAt: '2099-01-01T00:00:00Z',
  }))
  const response = {
    protocolVersion: 3,
    ok: true,
    data: {
      schemaVersion: 2,
      reports: [{
        id: request.params.connectionId,
        serviceId: 'fixture-hub',
        label: 'Fixture hub',
        sourceKind: 'api',
        status: 'available',
        subscriptions: ids.map((id) => ({ id, label: LABELS[id] })),
        metrics,
      }],
    },
  }
  if (!selected) response.refreshableSubscriptions = ['chatgpt', 'claude', 'opencode-go']
  process.stdout.write(JSON.stringify(response))
})
`

const roots: string[] = []
const services: UsageService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) service.shutdown()
  for (const dir of roots.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function hubFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'nekode-usage-hub-fixture-'))
  roots.push(dir)
  const userDataPath = join(dir, 'profile')
  const adapter = join(userDataPath, 'usage-adapters', 'fixture-hub')
  mkdirSync(adapter, { recursive: true })
  writeFileSync(join(adapter, 'index.cjs'), HUB_SCRIPT)
  writeFileSync(
    join(adapter, 'usage-adapter.json'),
    JSON.stringify({
      id: 'fixture-hub',
      name: 'Fixture hub',
      serviceId: 'fixture-hub',
      protocolVersion: 3,
      invocation: { command: process.execPath, args: ['index.cjs'] },
      sourceKind: 'api',
      capabilities: ['window'],
      minimumRefreshSeconds: 60,
      configSchema: [],
      refreshOptions: ['subscriptions'],
    }),
  )
  const state = new Map<string, string>([['usage.enabled', 'true']])
  const deps = {
    userDataPath,
    state: {
      get: (key: string) => state.get(key) ?? null,
      set: (key: string, value: string) => {
        state.set(key, value)
      },
      transaction: <T>(fn: () => T) => fn(),
    },
    startTimer: false,
  }
  const service = new UsageService(deps)
  services.push(service)
  const output = join(dir, 'export.json')
  const settings: UsageSettings = {
    connections: [
      {
        id: 'hub',
        label: 'PDH',
        serviceId: '',
        adapterId: 'fixture-hub',
        enabled: true,
        config: {},
      },
    ],
    pin: null,
    export: { enabled: true, path: output },
  }
  service.saveSettings(settings)
  return { service, output, deps }
}

describe('fixture hub with four subscriptions (NEKODE-191 Stage 2)', () => {
  it('reads declared subscriptions, refreshes one, keeps the pin and exports schema 2', async () => {
    const { service, output, deps } = hubFixture()
    service.setVisible(true)
    await vi.waitFor(
      () => expect(service.read().connections[0].subscription?.metrics).toHaveLength(4),
      { timeout: 10_000 },
    )
    const first = service.read().connections[0]
    // U3, U11: the report keeps its declared labels in declaration order, never a reader name.
    expect(first.subscription?.subscriptions).toEqual([
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'claude', label: 'Claude' },
      { id: 'google-ai', label: 'Google AI' },
      { id: 'opencode-go', label: 'OpenCode Go' },
    ])
    expect(first.subscriptions?.map((item) => item.subscriptionId)).toEqual([
      'chatgpt',
      'claude',
      'opencode-go',
    ])
    const before = Object.fromEntries(
      (first.subscription?.metrics ?? []).map((m) => [m.id, [m.usedPercent, m.observedAt]]),
    )

    // The toolbar pins a row through getSettings and saveSettings.
    const pin = { connectionId: 'hub', metricId: 'opencode-go-5h' }
    service.saveSettings({ ...service.getSettings(), pin })

    // R5: an unlisted subscription fails before any adapter process starts.
    await expect(
      service.refresh({ connectionId: 'hub', subscriptionId: 'google-ai' }),
    ).rejects.toMatchObject({ code: 'not_found' })

    // A6, U6: one subscription refreshes; the others keep value and observation time.
    const refreshed = await service.refresh({ connectionId: 'hub', subscriptionId: 'opencode-go' })
    expect(refreshed.refresh).toMatchObject({ read: ['hub'], skipped: [] })
    const metrics = refreshed.connections[0].subscription?.metrics ?? []
    const after = Object.fromEntries(metrics.map((m) => [m.id, [m.usedPercent, m.observedAt]]))
    expect(after['opencode-go-5h']?.[0]).toBe(55)
    expect(after['chatgpt-5h']).toEqual(before['chatgpt-5h'])
    expect(after['claude-5h']).toEqual(before['claude-5h'])
    expect(after['google-ai-5h']).toEqual(before['google-ai-5h'])
    expect(refreshed.pin).toEqual(pin)
    expect(refreshed.connections[0].subscription?.subscriptions.map((s) => s.label)).toEqual([
      'ChatGPT',
      'Claude',
      'Google AI',
      'OpenCode Go',
    ])
    const deadline = refreshed.connections[0].subscriptions?.find(
      (item) => item.subscriptionId === 'opencode-go',
    )?.nextRefreshAt
    expect(deadline).not.toBeNull()

    // U9, acceptance 7: the export is schema 2 with subscription ids and no reader names.
    const exported = JSON.parse(readFileSync(output, 'utf8'))
    expect(exported.schemaVersion).toBe(2)
    expect(exported.reports[0].serviceId).toBe('fixture-hub')
    expect(exported.reports[0].subscriptions.map((s: { id: string }) => s.id)).toEqual([
      'chatgpt',
      'claude',
      'google-ai',
      'opencode-go',
    ])
    expect(
      exported.reports[0].metrics.find((m: { id: string }) => m.id === 'opencode-go-5h'),
    ).toMatchObject({ subscriptionId: 'opencode-go', usedPercent: 55 })
    const text = JSON.stringify(exported)
    expect(text).not.toMatch(/providerId|"agents?"|"subscriptionId":"opencode"/)
    expect(text).not.toContain('refreshableSubscriptions')

    // The pin and declared labels survive a restart from cache.
    const restarted = new UsageService(deps)
    services.push(restarted)
    expect(restarted.read().pin).toEqual(pin)
    expect(restarted.read().connections[0].subscription?.subscriptions.map((s) => s.label)).toEqual(
      ['ChatGPT', 'Claude', 'Google AI', 'OpenCode Go'],
    )
    // Two real adapter spawns and a restart; the wait above needs more than the 5 s default.
  }, 20_000)
})
