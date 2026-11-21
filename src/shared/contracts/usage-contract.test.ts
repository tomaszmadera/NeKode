import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseUsageDocument,
  parseUsageRefreshableSubscriptions,
  parseUsageRefreshRequest,
  parseUsageRefreshResult,
  parseUsageSettings,
  type UsageMetric,
  type UsageReportDocument,
  usageFreshness,
  usagePercent,
  usageSlices,
} from './usage-contract'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const windowMetric = (patch: Partial<UsageMetric> = {}): UsageMetric => ({
  id: 'week',
  label: 'Fixture plan 7d',
  subscriptionId: 'fixture-plan',
  kind: 'window',
  observedAt: '2026-10-20T12:00:00Z',
  state: 'available',
  usedPercent: 125,
  periodStart: '2026-10-18T12:00:00Z',
  resetsAt: '2026-10-25T12:00:00Z',
  ...patch,
})
function document(metric: unknown = windowMetric()): unknown {
  return {
    schemaVersion: 2,
    reports: [
      {
        id: 'account',
        serviceId: 'test',
        label: 'Fixture account',
        sourceKind: 'file',
        status: 'available',
        subscriptions: [{ id: 'fixture-plan', label: 'Fixture plan' }],
        metrics: [metric],
      },
    ],
  }
}
describe('normalized usage observations', () => {
  it('uses exact five and sixty minute freshness boundaries', () => {
    const m = windowMetric()
    expect(usageFreshness(m, NOW + 300_000)).toMatch(/^Fresh/)
    expect(usageFreshness(m, NOW + 300_001)).toMatch(/^Aging/)
    expect(usageFreshness(m, NOW + 3_600_000)).toMatch(/^Aging/)
    expect(usageFreshness(m, NOW + 3_600_001)).toMatch(/^Stale/)
    expect(() =>
      parseUsageDocument(document(windowMetric({ observedAt: '2026-02-30T12:00:00Z' })), NOW),
    ).toThrow('timestamp')
  })
  it('preserves overage and separates collection from observation age', () => {
    const doc = parseUsageDocument(
      document(windowMetric({ observedAt: null, collectedAt: '2026-10-20T12:00:00Z' })),
      NOW,
    )
    expect(usagePercent(doc.reports[0].metrics[0])).toBe(125)
    expect(usageFreshness(doc.reports[0].metrics[0], NOW)).toBe('Age unknown')
  })
  it.each([NaN, Infinity, -1])('rejects invalid percentages %s', (percent) => {
    expect(() =>
      parseUsageDocument(document(windowMetric({ usedPercent: percent })), NOW),
    ).toThrow()
  })
  it('rejects duplicates, unsupported versions, future observations and reversed periods atomically', () => {
    const d = document() as {
      schemaVersion: number
      reports: Array<{ metrics: UsageMetric[] }>
    }
    d.reports[0].metrics.push(windowMetric())
    expect(() => parseUsageDocument(d, NOW)).toThrow('Duplicate')
    expect(() => parseUsageDocument({ schemaVersion: 3, reports: [] }, NOW)).toThrow('version')
    expect(() =>
      parseUsageDocument(document(windowMetric({ observedAt: '2026-10-20T12:01:01Z' })), NOW),
    ).toThrow('future')
    expect(() =>
      parseUsageDocument(document(windowMetric({ resetsAt: '2026-10-17T00:00:00Z' })), NOW),
    ).toThrow('end')
  })
  it('expires a window without advancing or resetting the value', () => {
    const m = windowMetric()
    expect(usageFreshness(m, Date.parse('2026-10-25T12:00:00Z'))).toBe('Expired - refresh required')
    expect(m.usedPercent).toBe(125)
  })
  it('does not derive a percentage from a zero credit limit', () => {
    expect(
      usagePercent(windowMetric({ kind: 'credits', used: 12, limit: 0, unit: 'characters' })),
    ).toBeNull()
  })
  it('uses elapsed intervals for seven daily slices and pace advice for any open window', () => {
    const m = windowMetric({ usedPercent: 10 })
    const slices = usageSlices(m, NOW)
    if (!slices) throw new Error('Expected weekly slices')
    expect(slices.shares).toHaveLength(7)
    expect(slices.current).toBe(2)
    expect(slices.pace).toBe('↑ 19pp')
    // Age-unknown (Claude) and stale observations still get pace advice.
    expect(usageSlices({ ...m, observedAt: null }, NOW)?.pace).toBe('↑ 19pp')
    expect(usageSlices({ ...m, observedAt: '2026-10-20T10:00:00Z' }, NOW)?.pace).toBe('↑ 19pp')
    expect(usageSlices({ ...m, usedPercent: 50 }, NOW)?.pace).toBe('Ahead of pace')
    // Expired or closed windows get none.
    expect(usageSlices({ ...m, state: 'expired' }, NOW)?.pace).toBeNull()
    expect(usageSlices(m, Date.parse('2026-10-25T12:00:00Z'))?.pace).toBeNull()
    expect(usageSlices({ ...m, periodStart: null }, NOW)).toBeNull()
  })
  it('splits actual monthly intervals into four equal quarters', () => {
    const slices = usageSlices(
      windowMetric({
        usedPercent: 10,
        periodStart: '2026-10-01T00:00:00Z',
        resetsAt: '2026-11-01T00:00:00Z',
      }),
      NOW,
    )
    if (!slices) throw new Error('Expected monthly slices')
    expect(slices.shares).toEqual([25, 25, 25, 25])
    // 19.5 of 31 days elapsed: the third quarter, 40pp behind its lower share.
    expect(slices.current).toBe(2)
    expect(slices.pace).toBe('↑ 40pp')
  })
})

describe('partial refresh result contract', () => {
  const metric = (id: string): UsageMetric => ({
    ...windowMetric({ observedAt: '2026-10-20T12:00:00Z' }),
    id,
    label: `Fixture plan ${id}`,
  })
  const document = (metrics: UsageMetric[]): UsageReportDocument => ({
    schemaVersion: 2,
    reports: [
      {
        id: 'account',
        serviceId: 'test',
        label: 'Fixture account',
        sourceKind: 'api',
        status: 'available',
        subscriptions: [{ id: 'fixture-plan', label: 'Fixture plan' }],
        metrics,
      },
    ],
  })
  const windowResult = (metricId: string, patch: Record<string, unknown> = {}) => ({
    metricId,
    status: 'succeeded',
    ...patch,
  })
  const refresh = (patch: Record<string, unknown> = {}) => ({
    status: 'success',
    requestId: 'request-1',
    measurementId: 'measurement-1',
    reportId: 'report-1',
    sources: [{ sourceId: 'source', status: 'succeeded', windows: [windowResult('m1')] }],
    ...patch,
  })

  it('accepts a complete success and preserves a retry deadline beyond one day', () => {
    const result = parseUsageRefreshResult(
      refresh({
        sources: [
          {
            sourceId: 'source',
            status: 'succeeded',
            nextAllowedAt: '2026-10-25T12:00:00Z',
            windows: [windowResult('m1', { nextAllowedAt: '2026-10-25T12:00:00Z' })],
          },
        ],
      }),
      document([metric('m1')]),
      NOW,
    )
    expect(result).toMatchObject({ status: 'success', requestId: 'request-1' })
    expect(result.sources[0].nextAllowedAt).toBe('2026-10-25T12:00:00Z')
  })

  it('accepts a partial result with a failed window that has no metric', () => {
    const result = parseUsageRefreshResult(
      refresh({
        status: 'partial',
        measurementId: undefined,
        reportId: undefined,
        sources: [
          {
            sourceId: 'source',
            status: 'succeeded',
            windows: [
              windowResult('m1'),
              {
                metricId: 'm2',
                status: 'rate_limited',
                errorCode: 'rate_limited',
                nextAllowedAt: '2026-10-20T13:00:00Z',
              },
            ],
          },
        ],
      }),
      document([metric('m1')]),
      NOW,
    )
    expect(result.status).toBe('partial')
    expect(result.sources[0].windows[1]).toMatchObject({
      metricId: 'm2',
      status: 'rate_limited',
      errorCode: 'rate_limited',
    })
  })

  it('rejects unknown keys, duplicate ids and unfinished statuses', () => {
    expect(() =>
      parseUsageRefreshResult(refresh({ extra: true }), document([metric('m1')]), NOW),
    ).toThrow('Unexpected')
    expect(() =>
      parseUsageRefreshResult(
        refresh({
          sources: [refresh().sources[0], { sourceId: 'source', status: 'succeeded', windows: [] }],
        }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('Duplicate')
    expect(() =>
      parseUsageRefreshResult(
        refresh({
          sources: [
            {
              sourceId: 'source',
              status: 'succeeded',
              windows: [windowResult('m1'), windowResult('m1')],
            },
          ],
        }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('Duplicate')
    expect(() =>
      parseUsageRefreshResult(
        refresh({
          sources: [{ sourceId: 'source', status: 'running', windows: [windowResult('m1')] }],
        }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('status')
  })

  it('rejects a failed window that still carries a document metric', () => {
    expect(() =>
      parseUsageRefreshResult(
        refresh({
          status: 'failed',
          measurementId: undefined,
          reportId: undefined,
          sources: [
            {
              sourceId: 'source',
              status: 'failed',
              windows: [windowResult('m1', { status: 'failed', errorCode: 'network' })],
            },
          ],
        }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('carries a value')
  })

  it('rejects a success that omits a document metric or its correlation ids', () => {
    expect(() =>
      parseUsageRefreshResult(
        refresh({ sources: [{ sourceId: 'source', status: 'succeeded', windows: [] }] }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('omits')
    expect(() =>
      parseUsageRefreshResult(refresh({ measurementId: undefined }), document([metric('m1')]), NOW),
    ).toThrow('measurement')
  })

  it('rejects non-UTC deadlines, unknown error codes and overlong ids', () => {
    for (const nextAllowedAt of ['2026-10-20T12:00:00+02:00', 'tomorrow']) {
      expect(() =>
        parseUsageRefreshResult(
          refresh({
            sources: [
              {
                sourceId: 'source',
                status: 'succeeded',
                nextAllowedAt,
                windows: [windowResult('m1')],
              },
            ],
          }),
          document([metric('m1')]),
          NOW,
        ),
      ).toThrow('timestamp')
    }
    expect(() =>
      parseUsageRefreshResult(
        refresh({
          sources: [
            {
              sourceId: 'source',
              status: 'failed',
              errorCode: 'teapot',
              windows: [windowResult('m1', { status: 'failed', errorCode: 'teapot' })],
            },
          ],
        }),
        document([]),
        NOW,
      ),
    ).toThrow('error code')
    expect(() =>
      parseUsageRefreshResult(
        refresh({ requestId: 'x'.repeat(257) }),
        document([metric('m1')]),
        NOW,
      ),
    ).toThrow('1 to 256')
  })
})

describe('usage document schema 2 (NEKODE-191 U2-U5)', () => {
  const report = (patch: Record<string, unknown> = {}) => ({
    id: 'hub',
    serviceId: 'personal-data-hub',
    label: 'Hub',
    sourceKind: 'api',
    status: 'available',
    subscriptions: [
      { id: 'chatgpt', label: 'ChatGPT' },
      { id: 'opencode-go', label: 'OpenCode Go' },
    ],
    metrics: [
      windowMetric({ id: 'chatgpt-weekly', label: 'ChatGPT weekly', subscriptionId: 'chatgpt' }),
      windowMetric({
        id: 'opencode-go-5h',
        label: 'OpenCode Go 5h',
        subscriptionId: 'opencode-go',
      }),
    ],
    ...patch,
  })
  const parse = (patch: Record<string, unknown> = {}) =>
    parseUsageDocument({ schemaVersion: 2, reports: [report(patch)] }, NOW)

  it('parses the documented example', () => {
    const example = JSON.parse(
      readFileSync(resolve(__dirname, '../../../docs/features/usage-quota/example.json'), 'utf8'),
    )
    expect(parseUsageDocument(example, NOW).reports[0].subscriptions).toEqual([
      { id: 'example-plan', label: 'Example plan' },
    ])
  })

  it('parses reports with their declared subscriptions in order', () => {
    const doc = parse()
    expect(doc.schemaVersion).toBe(2)
    expect(doc.reports[0]).toMatchObject({
      id: 'hub',
      serviceId: 'personal-data-hub',
      subscriptions: [
        { id: 'chatgpt', label: 'ChatGPT' },
        { id: 'opencode-go', label: 'OpenCode Go' },
      ],
    })
    expect(doc.reports[0].metrics.map((m) => m.subscriptionId)).toEqual(['chatgpt', 'opencode-go'])
  })

  it('rejects the schema 1 shape with subscriptions and providerId', () => {
    expect(() =>
      parseUsageDocument(
        {
          schemaVersion: 1,
          subscriptions: [
            {
              id: 'account',
              providerId: 'test',
              label: 'Fixture account',
              sourceKind: 'api',
              status: 'available',
              metrics: [],
            },
          ],
        },
        NOW,
      ),
    ).toThrow()
    expect(() => parseUsageDocument({ schemaVersion: 2, subscriptions: [] }, NOW)).toThrow()
  })

  it('requires a service id and rejects a report providerId', () => {
    const { serviceId: _serviceId, ...withoutService } = report()
    expect(() => parseUsageDocument({ schemaVersion: 2, reports: [withoutService] }, NOW)).toThrow(
      'service id',
    )
    expect(() => parse({ serviceId: 'Not Valid' })).toThrow('service id')
    expect(() => parse({ providerId: 'personal-data-hub' })).toThrow('Unexpected')
  })

  it('requires every metric subscription to be declared', () => {
    expect(() =>
      parse({
        metrics: [windowMetric({ id: 'claude-5h', label: 'Claude 5h', subscriptionId: 'claude' })],
      }),
    ).toThrow('not declared')
    const { subscriptionId: _id, ...withoutSubscription } = windowMetric({ label: 'ChatGPT 7d' })
    expect(() => parse({ metrics: [withoutSubscription] })).toThrow('subscription')
  })

  it('checks only structure for NeKode merged data with strict: false (U4)', () => {
    const merged = {
      schemaVersion: 2,
      reports: [
        report({
          metrics: [
            windowMetric({
              id: 'opencode-go-5h',
              label: 'Opencode Go 5h',
              subscriptionId: 'opencode-go',
            }),
          ],
        }),
      ],
    }
    expect(() => parseUsageDocument(merged, NOW)).toThrow('name its subscription')
    expect(parseUsageDocument(merged, NOW, { strict: false }).reports[0].metrics[0].label).toBe(
      'Opencode Go 5h',
    )
    const broken = structuredClone(merged)
    broken.reports[0].metrics[0].subscriptionId = 'Not Valid'
    expect(() => parseUsageDocument(broken, NOW, { strict: false })).toThrow('subscription id')
  })

  it('rejects a metric providerId or an agent field', () => {
    expect(() =>
      parse({
        metrics: [
          {
            ...windowMetric({ label: 'ChatGPT 7d', subscriptionId: 'chatgpt' }),
            providerId: 'chatgpt',
          },
        ],
      }),
    ).toThrow('removed field')
    expect(() =>
      parse({
        metrics: [
          { ...windowMetric({ label: 'ChatGPT 7d', subscriptionId: 'chatgpt' }), agent: 'codex' },
        ],
      }),
    ).toThrow('Unexpected')
  })

  it('rejects duplicate, malformed, unlabelled and overlong subscription declarations', () => {
    expect(() =>
      parse({
        subscriptions: [
          { id: 'chatgpt', label: 'ChatGPT' },
          { id: 'chatgpt', label: 'ChatGPT again' },
          { id: 'opencode-go', label: 'OpenCode Go' },
        ],
      }),
    ).toThrow('Duplicate usage subscription id')
    expect(() =>
      parse({ subscriptions: [{ id: 'ChatGPT', label: 'ChatGPT' }], metrics: [] }),
    ).toThrow('subscription id')
    expect(() => parse({ subscriptions: [{ id: 'chatgpt' }], metrics: [] })).toThrow('label')
    expect(() =>
      parse({ subscriptions: [{ id: 'chatgpt', label: 'x'.repeat(257) }], metrics: [] }),
    ).toThrow('label')
    expect(() =>
      parse({ subscriptions: [{ id: 'chatgpt', label: 'ChatGPT', extra: 1 }], metrics: [] }),
    ).toThrow('Unexpected')
    expect(() =>
      parse({
        subscriptions: Array.from({ length: 51 }, (_, i) => ({ id: `s-${i}`, label: `S ${i}` })),
        metrics: [],
      }),
    ).toThrow('subscriptions')
  })

  it('rejects a metric label that does not name its subscription', () => {
    expect(() =>
      parse({
        metrics: [windowMetric({ id: 'weekly', label: 'Weekly', subscriptionId: 'chatgpt' })],
      }),
    ).toThrow('name its subscription')
  })
})

describe('usage refresh subscriptions (NEKODE-191 U6-U7)', () => {
  it('parses a refresh request with one subscription and rejects providerId', () => {
    expect(
      parseUsageRefreshRequest({ connectionId: 'hub', subscriptionId: 'opencode-go' }),
    ).toEqual({ connectionId: 'hub', subscriptionId: 'opencode-go' })
    expect(parseUsageRefreshRequest({ connectionId: 'hub' })).toEqual({ connectionId: 'hub' })
    for (const bad of [
      { connectionId: 'hub', providerId: 'claude' },
      { connectionId: 'hub', subscriptionId: 'Not Valid' },
      { connectionId: 'hub', subscriptionId: 7 },
    ])
      expect(() => parseUsageRefreshRequest(bad)).toThrow()
  })

  it('bounds refreshable subscription lists to 50 unique ids', () => {
    expect(parseUsageRefreshableSubscriptions(['chatgpt', 'opencode-go'])).toEqual([
      'chatgpt',
      'opencode-go',
    ])
    expect(parseUsageRefreshableSubscriptions([])).toEqual([])
    for (const bad of [
      ['chatgpt', 'chatgpt'],
      ['ChatGPT'],
      Array.from({ length: 51 }, (_, i) => `s-${i}`),
      'chatgpt',
    ])
      expect(() => parseUsageRefreshableSubscriptions(bad)).toThrow('refreshable subscriptions')
  })

  it('stores connections with serviceId and rejects providerId at the settings boundary', () => {
    const settings = {
      connections: [
        {
          id: 'hub',
          label: 'Hub',
          serviceId: 'personal-data-hub',
          adapterId: 'personal-data-hub',
          enabled: true,
          config: {},
        },
      ],
      pin: null,
      export: { enabled: false, path: null },
    }
    expect(parseUsageSettings(settings).connections[0].serviceId).toBe('personal-data-hub')
    const { serviceId: _s, ...legacy } = settings.connections[0]
    expect(() =>
      parseUsageSettings({
        ...settings,
        connections: [{ ...legacy, providerId: 'personal-data-hub' }],
      }),
    ).toThrow('Unexpected')
  })
})
