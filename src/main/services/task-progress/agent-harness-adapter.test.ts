import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { TaskProgressHost } from './adapter-host'
import { parseTaskProgressManifest } from './adapter-manifest'
import { validateTaskProgressSnapshot } from './snapshot'

const adapterDir = process.env.NEKODE_TASK_PROGRESS_ADAPTER_DIR

// Opt-in only: NeKode does not ship the Agent Harness adapter. Its default
// configuration must read the fixture project, including completed archives.
it.skipIf(!adapterDir)(
  'Agent Harness adapter: live and archived completed fixtures (requires NEKODE_TASK_PROGRESS_ADAPTER_DIR)',
  async () => {
    if (!adapterDir) throw new Error('NEKODE_TASK_PROGRESS_ADAPTER_DIR is required')
    const root = mkdtempSync(join(tmpdir(), 'nekode-real-harness-adapter-'))
    try {
      const repo = resolve(__dirname, '../../../..')
      for (const path of [
        '.agents/scripts/task-status',
        '.agents/scripts/common.py',
        '.agents/skills/task-record/scripts/verification_subject.py',
      ]) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        copyFileSync(join(repo, path), join(root, path))
      }
      writeFileSync(
        join(root, '.agents/project-profile.yaml'),
        'project:\n  name: Adapter fixtures\n',
      )
      for (const completed of [false, true]) {
        const id = completed ? 'demo-2-completed' : 'demo-1-live'
        const dir = join(root, '.agents/tasks', completed ? 'archive' : '', id)
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          join(dir, 'task.md'),
          `---
id: ${id}
schema_version: 4
status: ${completed ? 'completed' : 'active'}
intent: analysis
complexity: small
durability: recorded
created: 2026-01-01T00:00:00Z
completed: ${completed ? '2026-01-01T01:00:00Z' : 'none'}
current_phase: Phase 0
current_step: ${completed ? 'none' : 'Phase 0.1'}
updated: 2026-01-01
branch: main
worktree: current
next_action: ${completed ? 'none' : 'Inspect fixture'}
blockers: none
---

# ${id}

## Objective
Read the fixture.
## Scope
Fixture only.
## Phase 0 - Intake
- [${completed ? 'x' : ' '}] Phase 0.1 - Inspect the repository and refine the provisional classification
## Decisions
Fixture only.
## Changed files
No product changes.
## Verification
Fixture is an informational result with no final check.
## Timing
| Element | Kind | Started | Ended |
|---|---|---|---|
## Checkpoints
| Step | Completed |
|---|---|
${completed ? '| Phase 0.1 | 2026-01-01T00:30:00Z |\n' : ''}
## Risks and blockers
None.
## Resume instructions
${completed ? 'Complete.' : 'Inspect fixture.'}
`,
        )
      }
      const adapter = parseTaskProgressManifest(
        readFileSync(join(adapterDir, 'adapter.json'), 'utf8'),
        join(adapterDir, 'adapter.json'),
      )
      const config = Object.fromEntries(
        adapter.info.configSchema
          .filter((field) => field.default !== undefined)
          .map((field) => [field.key, String(field.default)]),
      )
      const invocation = { id: adapter.info.id, invocation: adapter.invocation, dir: adapterDir }
      const host = new TaskProgressHost()
      const project = { root, environment: 'local' as const }
      await expect(
        host.invoke(invocation, { protocolVersion: 1, action: 'test', config, project }),
      ).resolves.toHaveProperty('summary')
      const data = await host.invoke(invocation, {
        protocolVersion: 1,
        action: 'snapshot',
        config,
        project,
      })
      const snapshot = validateTaskProgressSnapshot(data, 'Agent Harness fixture snapshot', root)
      expect(snapshot.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'demo-1-live',
            location: 'live',
            state: 'active',
            recordState: 'valid',
          }),
          expect.objectContaining({
            id: 'demo-2-completed',
            location: 'archived',
            state: 'completed',
            recordState: 'valid',
          }),
        ]),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  40_000,
)
