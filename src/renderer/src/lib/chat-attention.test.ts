// Pure functions over the per-chat attention state (chat-attention.ts).
// Mapping to the chat attention badge spec ACs; each case guards a decision
// the production code makes through these helpers.

import { describe, expect, it } from 'vitest'
import { clearAttention, markAttention, pruneAttention } from './chat-attention'

describe('markAttention', () => {
  it('AC1: marks a chat without a message (standalone BEL)', () => {
    expect(markAttention({}, 't1')).toEqual({ t1: { message: null } })
  })

  it('AC3: keeps the OSC 9 message for the tooltip', () => {
    expect(markAttention({}, 't1', 'needs approval')).toEqual({
      t1: { message: 'needs approval' },
    })
  })

  it('Behaviour 3: truncates the tooltip text to 120 characters', () => {
    expect(markAttention({}, 't1', 'x'.repeat(200)).t1.message).toHaveLength(120)
  })

  it('Edge case: a newer signal replaces the tooltip text (badge stays set)', () => {
    const marked = markAttention({ t1: { message: 'old' } }, 't1', 'new')
    expect(marked).toEqual({ t1: { message: 'new' } })
  })

  it('AC9: marks only the addressed chat id', () => {
    const next = markAttention({ t1: { message: null } }, 't2', 'msg')
    expect(Object.keys(next).sort()).toEqual(['t1', 't2'])
    expect(next.t1).toEqual({ message: null })
  })
})

describe('clearAttention', () => {
  it('AC5/AC6: clears exactly the addressed chat', () => {
    const state = { t1: { message: null }, t2: { message: 'x' } as { message: string | null } }
    expect(clearAttention(state, 't1')).toEqual({ t2: { message: 'x' } })
  })

  it('clearing an unmarked chat returns the same object (no state churn)', () => {
    const state = { t1: { message: null } }
    expect(clearAttention(state, 't2')).toBe(state)
  })
})

describe('pruneAttention', () => {
  it('Behaviour 7: drops entries whose chat no longer exists', () => {
    const state = { t1: { message: null }, t2: { message: 'x' } as { message: string | null } }
    expect(pruneAttention(state, (id) => id === 't2')).toEqual({ t2: { message: 'x' } })
  })

  it('keeps the same object when nothing is pruned', () => {
    const state = { t1: { message: null } }
    expect(pruneAttention(state, () => true)).toBe(state)
  })
})
