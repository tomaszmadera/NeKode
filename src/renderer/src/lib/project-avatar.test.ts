import { describe, expect, it } from 'vitest'
import { getProjectColor, getProjectInitials } from './project-avatar'

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

  it.each([null, undefined, '', '   '])(
    'falls back to the id-derived color for custom color %j',
    (custom) => {
      expect(getProjectColor({ id: 'proj-alpha', path: '/path/alpha' }, custom)).toBe('#2DD4BF')
    },
  )

  it('keeps each project on the same palette color across releases', () => {
    // Pinned literals: a changed hash would silently recolor every project.
    expect(getProjectColor({ id: 'proj-alpha' })).toBe('#2DD4BF')
    expect(getProjectColor({ id: 'proj-beta' })).toBe('#5AA9FF')
  })
})
