import { describe, expect, it } from 'vitest'
import { parseWslPath, wslProjectPath } from './wsl-path'

describe('WSL project paths', () => {
  it('round trips case, spaces, Unicode and both UNC aliases', () => {
    const path = wslProjectPath('Ubuntu-24.04', '/home/u/My Project/ą')
    expect(path).toBe('\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\My Project\\ą')
    expect(parseWslPath(path)).toEqual({
      distribution: 'Ubuntu-24.04',
      linuxPath: '/home/u/My Project/ą',
    })
    expect(parseWslPath('\\\\wsl$\\Ubuntu-24.04\\home\\u')).toEqual({
      distribution: 'Ubuntu-24.04',
      linuxPath: '/home/u',
    })
    expect(parseWslPath('C:\\code\\project')).toBeNull()
  })
  it.each(['/', 'relative', '/home/../u', '/home//u', '/home/./u', '/home/u\0', '/home/u\\x'])(
    'rejects invalid Linux directory %s',
    (path) => {
      expect(() => wslProjectPath('Ubuntu', path)).toThrow()
    },
  )
  it.each(['', '..', '-d', 'bad/name', 'bad\\name'])(
    'rejects invalid distribution %s',
    (distribution) => {
      expect(() => wslProjectPath(distribution, '/home/u')).toThrow()
    },
  )
  it('rejects malformed WSL UNC instead of treating it as a Local project', () => {
    expect(() => parseWslPath('\\\\wsl$\\Ubuntu\\home\\..\\u')).toThrow()
    expect(() => parseWslPath('\\\\wsl$\\Ubuntu')).toThrow()
  })
})
