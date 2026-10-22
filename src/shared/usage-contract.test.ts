import { describe, expect, it } from 'vitest'
import {
  parseUsageDocument,
  type UsageMetric,
  usageFreshness,
  usagePercent,
  usageSlices,
} from './usage-contract'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const windowMetric = (patch: Partial<UsageMetric> = {}): UsageMetric => ({
  id: 'week',
  label: '7d',
  kind: 'window',
  observedAt: '2026-10-20T12:00:00Z',
  state: 'available',
  usedPercent: 125,
  periodStart: '2026-10-18T12:00:00Z',
  resetsAt: '2026-10-25T12:00:00Z',
  ...patch,
})
function document(metric = windowMetric()): unknown {
  return {
    schemaVersion: 1,
    subscriptions: [
      {
        id: 'account',
        providerId: 'test',
        label: 'Fixture account',
        sourceKind: 'file',
        status: 'available',
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
    expect(usagePercent(doc.subscriptions[0].metrics[0])).toBe(125)
    expect(usageFreshness(doc.subscriptions[0].metrics[0], NOW)).toBe('Age unknown')
  })
  it.each([NaN, Infinity, -1])('rejects invalid percentages %s', (percent) => {
    expect(() =>
      parseUsageDocument(document(windowMetric({ usedPercent: percent })), NOW),
    ).toThrow()
  })
  it('rejects duplicates, unsupported versions, future observations and reversed periods atomically', () => {
    const d = document() as {
      schemaVersion: number
      subscriptions: Array<{ metrics: UsageMetric[] }>
    }
    d.subscriptions[0].metrics.push(windowMetric())
    expect(() => parseUsageDocument(d, NOW)).toThrow('Duplicate')
    expect(() => parseUsageDocument({ schemaVersion: 2, subscriptions: [] }, NOW)).toThrow(
      'version',
    )
    expect(() =>
      parseUsageDocument(document(windowMetric({ observedAt: '2026-10-20T12:01:01Z' })), NOW),
    ).toThrow('future')
    expect(() =>
      parseUsageDocument(document(windowMetric({ resetsAt: '2026-10-17T00:00:00Z' })), NOW),
    ).toThrow('end')
  })
  it('keeps an optional per-metric provider id and rejects a malformed one', () => {
    const doc = parseUsageDocument(document(windowMetric({ providerId: 'claude' })), NOW)
    expect(doc.subscriptions[0].metrics[0].providerId).toBe('claude')
    expect(
      parseUsageDocument(document(windowMetric()), NOW).subscriptions[0].metrics[0],
    ).not.toHaveProperty('providerId')
    expect(() =>
      parseUsageDocument(document(windowMetric({ providerId: 'Claude!' })), NOW),
    ).toThrow('provider id')
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
  it('uses elapsed intervals for seven daily slices and no stale pace advice', () => {
    const m = windowMetric({ usedPercent: 10 })
    const slices = usageSlices(m, NOW)
    if (!slices) throw new Error('Expected weekly slices')
    expect(slices.shares).toHaveLength(7)
    expect(slices.current).toBe(2)
    expect(slices.pace).toBe('↑ 19pp')
    expect(usageSlices({ ...m, observedAt: null }, NOW)?.pace).toBeNull()
    expect(usageSlices({ ...m, observedAt: '2026-10-20T10:00:00Z' }, NOW)?.pace).toBeNull()
    expect(usageSlices({ ...m, periodStart: null }, NOW)).toBeNull()
  })
  it('splits actual 31 day monthly intervals with a shorter final slice', () => {
    const slices = usageSlices(
      windowMetric({ periodStart: '2026-10-01T00:00:00Z', resetsAt: '2026-11-01T00:00:00Z' }),
      NOW,
    )
    if (!slices) throw new Error('Expected monthly slices')
    expect(slices.shares).toHaveLength(5)
    expect(slices.shares[4]).toBeCloseTo((3 / 31) * 100)
    expect(slices.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100)
  })
})
