// Session context meter (spec left-panel Behaviour): the number is the agent's
// own reported context use, so it is presented as a compact count. Thresholds
// are absolute, decided 2026-11-08: warning from 160k, critical from 180k.
export const CONTEXT_WARNING_TOKENS = 160_000
export const CONTEXT_CRITICAL_TOKENS = 180_000

export type ContextLevel = 'normal' | 'warning' | 'critical'

export function contextLevel(tokens: number): ContextLevel {
  if (tokens >= CONTEXT_CRITICAL_TOKENS) return 'critical'
  if (tokens >= CONTEXT_WARNING_TOKENS) return 'warning'
  return 'normal'
}

/** `999`, `12.5k`, `64.6k`, `170k`: narrow enough for the tile's right side. */
export function formatContextTokens(tokens: number): string {
  const value = Math.max(0, Math.round(tokens))
  if (value < 1000) return String(value)
  if (value < 100_000) {
    const thousands = Math.round(value / 100) / 10
    return `${thousands.toFixed(1).replace(/\.0$/, '')}k`
  }
  // Floor above 100k: the text never claims more context than the agent reported.
  return `${Math.floor(value / 1000)}k`
}

/** Full count for the tooltip and accessible name; never shown on the tile itself. */
export function describeContextTokens(tokens: number): string {
  return `${Math.max(0, Math.round(tokens)).toLocaleString('en-US')} tokens`
}
