import { emptyGitWorktree } from '@shared/contracts/git-contract'
import type { AppApi } from '@shared/ipc-contract'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectGitLabel } from './ProjectGitLabel'

afterEach(cleanup)

it('renders the real branch and total changed files', async () => {
  const getStatus = vi.fn().mockResolvedValue({
    branch: 'main',
    dirty: true,
    worktree: {
      modified: 2,
      added: 1,
      deleted: 1,
      untracked: 3,
      conflicts: 1,
      ahead: 4,
      behind: 2,
    },
  })
  render(<ProjectGitLabel app={{ git: { getStatus } } as unknown as AppApi} projectId="project" />)
  expect((await screen.findByTitle('main, 8 changed files')).textContent).toBe('main  8')
  expect(getStatus).toHaveBeenCalledWith('project')
})

it('exposes a failed Git read rather than reporting a clean repository', async () => {
  const getStatus = vi.fn().mockRejectedValue(new Error('Repository unavailable'))
  render(<ProjectGitLabel app={{ git: { getStatus } } as unknown as AppApi} projectId="project" />)
  expect((await screen.findByText('Git unavailable')).title).toBe('Repository unavailable')
})

it('exposes the degraded status returned by the existing Git API without inventing a cause', async () => {
  const getStatus = vi.fn().mockResolvedValue({
    branch: null,
    dirty: false,
    worktree: emptyGitWorktree(),
  })
  render(<ProjectGitLabel app={{ git: { getStatus } } as unknown as AppApi} projectId="project" />)
  expect((await screen.findByText('Git unavailable')).title).toBe('Git status is unavailable.')
  expect(getStatus).toHaveBeenCalledWith('project')
})
