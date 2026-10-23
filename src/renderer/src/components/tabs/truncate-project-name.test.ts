import { describe, expect, it } from 'vitest'
import { truncateProjectName } from './TabStrip'

describe('truncateProjectName', () => {
  it('keeps names of up to 10 characters whole', () => {
    expect(truncateProjectName('NEKODE')).toBe('NEKODE')
    expect(truncateProjectName('ABCDEFGHIJ')).toBe('ABCDEFGHIJ')
  })

  it('shortens an 11-character name to 9 characters plus an ellipsis', () => {
    expect(truncateProjectName('ABCDEFGHIJK')).toBe('ABCDEFGHI…')
  })

  it('shortens a 22-character name to 9 characters plus an ellipsis', () => {
    expect(truncateProjectName('HERMES-VOICE-ASSISTANT')).toBe('HERMES-VO…')
  })

  it('counts grapheme clusters, not UTF-16 units', () => {
    const thumb = '👍🏽'
    expect(truncateProjectName(thumb.repeat(10))).toBe(thumb.repeat(10))
    expect(truncateProjectName(thumb.repeat(11))).toBe(`${thumb.repeat(9)}…`)
  })
})
