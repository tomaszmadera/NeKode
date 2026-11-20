import type { AgentSkillPreview } from '@shared/ipc-contract'
import type React from 'react'
import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { diffLines } from '../../lib/line-diff'
import { ConfirmDialog } from '../layout/ConfirmDialog'

/** Test ids the shared preview renders, one set per settings surface. */
export interface AgentSkillTeachTestIds {
  file: string
  replace: string
  new: string
  origin: string
  text: string
  diff: string
  noChanges: string
  currentHidden: string
  notice: string
  boundary: string
  profiles: string
  noProfiles: string
  error: string
}

export interface AgentSkillTeachDialogProps {
  open: boolean
  body: string
  preview: AgentSkillPreview | null
  profiles: { id: string; name: string }[]
  notice: string | null
  error: string | null
  writing: boolean
  originLabel: (preview: AgentSkillPreview) => string
  testIds: AgentSkillTeachTestIds
  onConfirm: () => void
  onCancel: () => void
}

/** Current file to new text: `No changes`, a hidden current file, or a line diff. */
function TeachDiff({
  preview,
  testIds,
}: {
  preview: AgentSkillPreview
  testIds: AgentSkillTeachTestIds
}): React.JSX.Element | null {
  // The diff only depends on the two texts; other dialog state must not redo it.
  const lines = useMemo(
    () =>
      preview.current === null || preview.current === preview.text
        ? []
        : diffLines(preview.current, preview.text),
    [preview.current, preview.text],
  )
  if (!preview.exists) return null
  if (preview.current === null) {
    return (
      <p className="mt-2 text-ink-muted" data-testid={testIds.currentHidden}>
        The current file cannot be shown.
      </p>
    )
  }
  if (preview.current === preview.text) {
    return (
      <p className="mt-2 text-ink-muted" data-testid={testIds.noChanges}>
        No changes
      </p>
    )
  }
  const mark = { same: ' ', remove: '-', add: '+' } as const
  const tone = { same: 'text-ink-secondary', remove: 'text-error', add: 'text-success' } as const
  return (
    <>
      <p className="mt-3">Changes to the current file:</p>
      <pre
        className="mt-1 max-h-56 overflow-auto rounded-md border border-edge bg-app p-2 font-mono text-[11px] leading-snug"
        data-testid={testIds.diff}
      >
        {lines.map((line, index) => (
          // Lines have no identity beyond their position in this diff.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional diff rows
          <div key={index} className={tone[line.kind]} data-diff={line.kind}>
            {mark[line.kind]}
            {line.text}
          </div>
        ))}
      </pre>
    </>
  )
}

/** Path, new or replace, origin, exact text, and diff of one preview. */
function TeachPreview({
  preview,
  originLabel,
  testIds,
}: {
  preview: AgentSkillPreview
  originLabel: (preview: AgentSkillPreview) => string
  testIds: AgentSkillTeachTestIds
}): React.JSX.Element {
  return (
    <>
      <p>
        File:{' '}
        <code className="text-ink" data-testid={testIds.file}>
          {preview.path}
        </code>
      </p>
      {preview.exists ? (
        <p className="mt-2 text-warning" data-testid={testIds.replace}>
          This replaces {preview.path}.
        </p>
      ) : (
        <p className="mt-2" data-testid={testIds.new}>
          This creates a new file.
        </p>
      )}
      <p className="mt-2 text-ink" data-testid={testIds.origin}>
        {originLabel(preview)}
      </p>
      <p className="mt-3">Text to write:</p>
      <pre
        className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-edge bg-app p-2 font-mono text-[11px] leading-snug text-ink"
        data-testid={testIds.text}
      >
        {preview.text}
      </pre>
      <TeachDiff preview={preview} testIds={testIds} />
    </>
  )
}

/**
 * Shared `Teach agents` confirm dialog. The owning settings surface supplies
 * the preview fetch, the write, the origin label, and the test ids; this
 * component only renders and portals above the Project Settings modal.
 */
export function AgentSkillTeachDialog({
  open,
  body,
  preview,
  profiles,
  notice,
  error,
  writing,
  originLabel,
  testIds,
  onConfirm,
  onCancel,
}: AgentSkillTeachDialogProps): React.JSX.Element | null {
  if (!open) return null
  return createPortal(
    <ConfirmDialog
      title="Teach agents"
      body={body}
      confirmLabel="Write skill file"
      confirmDisabled={writing || preview === null}
      wide
      onConfirm={onConfirm}
      onCancel={() => {
        if (!writing) onCancel()
      }}
    >
      <div className="mt-3 text-xs text-ink-secondary">
        {notice !== null ? (
          <p role="status" className="mb-3 text-warning" data-testid={testIds.notice}>
            {notice}
          </p>
        ) : null}
        {preview === null ? null : (
          <TeachPreview preview={preview} originLabel={originLabel} testIds={testIds} />
        )}
        <p className="mt-3" data-testid={testIds.boundary}>
          Writing this file installs and configures nothing. Agents that do not read project skills
          ignore it.
        </p>
        <p className="mt-3">Agents that can read a project skill:</p>
        {profiles.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 text-ink" data-testid={testIds.profiles}>
            {profiles.map((profile) => (
              <li key={profile.id}>{profile.name}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-ink-muted" data-testid={testIds.noProfiles}>
            No agent profile is selected for this project.
          </p>
        )}
        {error !== null ? (
          <p role="alert" className="mt-3 text-error" data-testid={testIds.error}>
            {error}
          </p>
        ) : null}
      </div>
    </ConfirmDialog>,
    document.body,
  )
}
