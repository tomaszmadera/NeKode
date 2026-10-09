import { describe, expect, it } from 'vitest'
import { joinProjectPath } from './project-path'

describe('project path joins', () => {
  it('preserves UNC roots when joining nested files and handoffs', () => {
    expect(joinProjectPath('//wsl.localhost/Ubuntu/home/u', 'nested/file.txt')).toBe(
      '//wsl.localhost/Ubuntu/home/u/nested/file.txt',
    )
    expect(joinProjectPath('\\\\wsl$\\Ubuntu\\home\\u', 'nested', 'file.txt')).toBe(
      '//wsl$/Ubuntu/home/u/nested/file.txt',
    )
    expect(joinProjectPath('D:/code', 'nested/file.txt')).toBe('D:/code/nested/file.txt')
  })
})
