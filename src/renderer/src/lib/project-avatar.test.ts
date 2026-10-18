import { describe, expect, it } from 'vitest'
import {
  getDeterministicProjectColor,
  getProjectColor,
  getProjectInitials,
  PROJECT_COLOR_PALETTE,
} from './project-avatar'

describe('getProjectInitials', () => {
  it('extracts initials according to spec examples', () => {
    expect(getProjectInitials('NEKODE')).toBe('N')
    expect(getProjectInitials('URUKI V2')).toBe('UV')
    expect(getProjectInitials('AGENT-HARNESS')).toBe('AH')
    expect(getProjectInitials('GERDE.PL')).toBe('G')
    expect(getProjectInitials('HERMES-VOICE-ASSISTANT')).toBe('HV')
    expect(getProjectInitials('IMAGE-TO-UI')).toBe('IT')
    expect(getProjectInitials('VRC-MEIDO')).toBe('VM')
  })

  it('handles lowercase, mixed casing, extra spaces, and hyphens', () => {
    expect(getProjectInitials('my-cool-project')).toBe('MC')
    expect(getProjectInitials('  single  ')).toBe('S')
    expect(getProjectInitials('a - b - c')).toBe('AB')
    expect(getProjectInitials('')).toBe('')
  })
})

describe('getProjectColor', () => {
  it('returns custom color when provided', () => {
    const project = { id: 'p1', path: '/path/p1' }
    expect(getProjectColor(project, '#8B7CF6')).toBe('#8B7CF6')
    expect(getProjectColor(project, '#2DD4BF')).toBe('#2DD4BF')
  })

  it('falls back to deterministic color when custom color is empty or undefined', () => {
    const project = { id: 'p1', path: '/path/p1' }
    const deterministic = getDeterministicProjectColor('p1')
    expect(getProjectColor(project, null)).toBe(deterministic)
    expect(getProjectColor(project, '')).toBe(deterministic)
    expect(getProjectColor(project, '   ')).toBe(deterministic)
    expect(PROJECT_COLOR_PALETTE).toContain(deterministic)
  })

  it('assigns stable color regardless of call count or order', () => {
    const color1 = getDeterministicProjectColor('proj-alpha')
    const color2 = getDeterministicProjectColor('proj-beta')
    const color1Again = getDeterministicProjectColor('proj-alpha')

    expect(color1).toBe(color1Again)
    expect(PROJECT_COLOR_PALETTE).toContain(color1)
    expect(PROJECT_COLOR_PALETTE).toContain(color2)
  })
})
