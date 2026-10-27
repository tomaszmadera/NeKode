import { describe, expect, it } from 'vitest'
import { projectDirectoryName, projectPathIdentity } from './project-identity'

describe('projectPathIdentity', () => {
  it('folds win32 case, slash direction, and trailing separators', () => {
    const identity = 'd:\\code\\demo'
    expect(projectPathIdentity('D:/Code/Demo', 'win32')).toBe(identity)
    expect(projectPathIdentity('d:\\code\\demo\\', 'win32')).toBe(identity)
    expect(projectPathIdentity('D:/CODE/demo//', 'win32')).toBe(identity)
    expect(projectPathIdentity('D:\\code\\demo', 'win32')).toBe(identity)
  })

  it('keeps a win32 drive root intact instead of stripping it to a drive letter', () => {
    expect(projectPathIdentity('D:\\', 'win32')).toBe('d:\\')
    expect(projectPathIdentity('D:/', 'win32')).toBe('d:\\')
    expect(projectPathIdentity('d:/', 'win32')).toBe('d:\\')
  })

  it('preserves linux case when the platform argument is linux', () => {
    expect(projectPathIdentity('/Home/User/Demo', 'linux')).toBe('/Home/User/Demo')
    expect(projectPathIdentity('/Home/User/Demo/', 'linux')).toBe('/Home/User/Demo')
    expect(projectPathIdentity('/home/user/demo', 'linux')).toBe('/home/user/demo')
    expect(projectPathIdentity('/Home/User/Demo', 'linux')).not.toBe(
      projectPathIdentity('/home/user/demo', 'linux'),
    )
    // The platform argument, not the host, decides case folding.
    expect(projectPathIdentity('D:/Code/Demo', 'linux')).toBe('D:/Code/Demo')
    expect(projectPathIdentity('D:/Code/Demo/', 'linux')).toBe('D:/Code/Demo')
    expect(projectPathIdentity('D:/Code/Demo', 'linux')).not.toBe(
      projectPathIdentity('d:/code/demo', 'linux'),
    )
  })

  it('preserves a literal terminal backslash in a POSIX directory name', () => {
    expect(projectPathIdentity('/code/demo\\', 'linux')).toBe('/code/demo\\')
    expect(projectPathIdentity('/code/demo\\/', 'linux')).toBe('/code/demo\\')
    expect(projectPathIdentity('/code/demo\\', 'linux')).not.toBe(
      projectPathIdentity('/code/demo', 'linux'),
    )
  })

  it('canonicalizes WSL aliases and preserves distribution and Linux case on win32', () => {
    const canonical = '\\\\wsl.localhost\\Ubuntu\\home\\User\\App'
    expect(projectPathIdentity('\\\\wsl$\\Ubuntu\\home\\User\\App', 'win32')).toBe(canonical)
    expect(projectPathIdentity('\\\\wsl.localhost\\Ubuntu\\home\\User\\App', 'win32')).toBe(
      canonical,
    )
    expect(projectPathIdentity('\\\\WSL.LOCALHOST\\Ubuntu\\home\\User\\App', 'linux')).toBe(
      canonical,
    )
    expect(projectPathIdentity('\\\\wsl$\\Ubuntu\\home\\user\\App', 'win32')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\user\\App',
    )
    expect(projectPathIdentity('\\\\wsl$\\ubuntu\\home\\User\\App', 'win32')).toBe(
      '\\\\wsl.localhost\\ubuntu\\home\\User\\App',
    )
    expect(projectPathIdentity('\\\\wsl$\\Debian\\home\\User\\App', 'win32')).toBe(
      '\\\\wsl.localhost\\Debian\\home\\User\\App',
    )
    expect(projectPathIdentity('\\\\wsl$\\Debian\\home\\User\\App', 'win32')).not.toBe(canonical)
  })

  it('rejects a malformed WSL path through the existing parser', () => {
    expect(() => projectPathIdentity('\\\\wsl$\\Ubuntu\\home\\..\\user', 'win32')).toThrow(
      /absolute Linux project directory/i,
    )
  })
})

describe('projectDirectoryName', () => {
  it('keeps a folder name for a trailing separator and leaves a root empty', () => {
    expect(projectDirectoryName('D:\\code\\demo\\', 'win32')).toBe('demo')
    expect(projectDirectoryName('D:/code/demo/', 'win32')).toBe('demo')
    expect(projectDirectoryName('D:\\', 'win32')).toBe('')
    expect(projectDirectoryName('D:/', 'win32')).toBe('')
    expect(projectDirectoryName('/code/demo/', 'linux')).toBe('demo')
    expect(projectDirectoryName('/', 'linux')).toBe('')
  })
})
