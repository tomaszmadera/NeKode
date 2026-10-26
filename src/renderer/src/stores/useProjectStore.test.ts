import type { ProjectInfo } from '@shared/ipc-contract'
import { describe, expect, it } from 'vitest'
import { createProjectStore } from './useProjectStore'

const project: ProjectInfo = { id: 'p1', name: 'Demo', path: 'D:/demo', runtimeLabel: null }

describe('project store', () => {
  it('applies synchronous functional updates without dropping another project or expansion', () => {
    const store = createProjectStore()
    const actions = store.getState()
    actions.setProjects([project])
    actions.setProjects((previous) => [...previous, { ...project, id: 'p2' }])
    actions.setExpandedProjectIds((previous) => new Set(previous).add('p1'))
    actions.setExpandedProjectIds((previous) => new Set(previous).add('p2'))
    actions.setSelectedProjectId('p2')
    actions.setProjectColors({ p1: '#123456' })
    actions.setProjectColors((previous) => ({ ...previous, p2: '#abcdef' }))

    expect(store.getState().projects.map((entry) => entry.id)).toEqual(['p1', 'p2'])
    expect([...store.getState().expandedProjectIds]).toEqual(['p1', 'p2'])
    expect(store.getState().selectedProjectId).toBe('p2')
    expect(store.getState().projectColors).toEqual({ p1: '#123456', p2: '#abcdef' })
  })

  it('keeps unresolved bindings distinct from settled unbound projects, and resets all metadata', () => {
    const store = createProjectStore()
    const actions = store.getState()
    expect(actions.settledKanbanProjects.has('p1')).toBe(false)
    actions.setProjects([project])
    actions.setSelectedProjectId('p1')
    actions.setExpandedProjectIds(new Set(['p1']))
    actions.setProjectColors({ p1: '#123456' })
    actions.setKanbanProjectIds(new Set(['p1']))
    actions.setLocalFileProjectIds(new Set(['p1']))
    actions.setSettledKanbanProjects(new Set(['p1', 'p2']))
    actions.setKanbanBindingsError('Failed to load task sources.')
    expect(store.getState().settledKanbanProjects.has('p2')).toBe(true)
    expect(store.getState().kanbanProjectIds.has('p2')).toBe(false)

    actions.reset()
    const fresh = createProjectStore().getState()
    for (const key of [
      'projects',
      'expandedProjectIds',
      'selectedProjectId',
      'projectColors',
      'kanbanProjectIds',
      'localFileProjectIds',
      'settledKanbanProjects',
      'kanbanBindingsError',
    ] as const) {
      expect(store.getState()[key]).toEqual(fresh[key])
    }
    expect(store.getState().setProjects).toBe(actions.setProjects)
    actions.setProjects([project])
    expect(store.getState().projects).toEqual([project])
  })
})
