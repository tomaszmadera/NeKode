import { describe, expect, it } from 'vitest'
import { getAgentColor } from './agent-colors'

describe('agent colors', () => {
  it.each([
    ['Claude Code', '#d97757'],
    ['CLAUDE', '#d97757'],
    ['OpenAI', '#94a2ff'],
    ['Codex', '#94a2ff'],
    ['Gemini', '#6ea8fe'],
    ['Agy', '#6ea8fe'],
    ['AntiGravity', '#6ea8fe'],
    ['Grok', '#9aa7c7'],
  ])('maps %s to its brand color', (name, color) => {
    expect(getAgentColor(name)).toBe(color)
  })
  it('hashes unknown agents case insensitively into the non-status palette', () => {
    expect(getAgentColor('Hermes')).toBe(getAgentColor('HERMES'))
    expect(['#a78bfa', '#60a5fa', '#f472b6', '#22d3ee', '#c084fc']).toContain(
      getAgentColor('Hermes'),
    )
    expect(getAgentColor('X')).not.toBe(getAgentColor('Y'))
  })
})
