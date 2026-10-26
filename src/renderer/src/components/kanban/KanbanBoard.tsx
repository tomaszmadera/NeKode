import type {
  AppApi,
  KanbanBoard as KanbanBoardData,
  KanbanCreateInput,
  KanbanPriority,
  KanbanUpdatePatch,
  WorkItem,
} from '@shared/ipc-contract'
import { LOCAL_TASK_FILE_MISSING } from '@shared/ipc-contract'
import { parseAppErrorPayload } from '@shared/ipc-error'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { TEST_ID } from '../../lib/test-ids'
import { KanbanBoardStatus } from './KanbanBoardStatus'
import { KanbanCreateTaskForm } from './KanbanCreateTaskForm'
import { HandoffNotices, useHandoffAvailability } from './KanbanHandoffNotices'
import { KanbanHeader, useKanbanToolbarBridge } from './KanbanHeader'
import { StartMenu } from './KanbanItemActions'
import { KanbanItemReview, ReviewTextMenu, useReviewComments } from './KanbanItemReview'
import { ItemCopyMenu, KanbanListView, useKanbanListPrefs } from './KanbanListView'
import {
  defaultNewTaskStateRef,
  type KanbanBoardPhase,
  type KanbanToolbarControls,
  type NewTaskDraft,
  reconcileBoardResponse,
  upsertWorkItem,
  visibleBoardColumns,
  writeFailureMessage,
} from './kanban-board-logic'

// Kanban surface (spec kanban-adapter-interface Behaviour 14, AC14). This
// component owns data loading, selection, and the state the parts share; it
// composes KanbanHeader, KanbanCreateTaskForm, HandoffNotices,
// KanbanBoardStatus, KanbanListView, and KanbanItemReview. Pure helpers live in kanban-board-logic.ts.
// The only arrangement is a list grouped under the state names, in adapter
// `order`. Opening the slug or the title replaces the list with a review.
// Status and Priority save from the review only: a change calls the existing
// `kanban:updateItem` with only that field. One review write at a time: both
// selects stay disabled until it settles, so the first success is not
// dropped. Success replaces that item by ref and leaves the review open on
// the returned item. Failure restores the confirmed value and shows the error
// on the review. A `listBoard` already in flight keeps that updated item as
// the one copy, including when its snapshot still has the old item. A later
// refresh still drops an absent ref.
// New task calls the existing `kanban:createItem` with title, stateRef, and an
// optional description, then upserts the returned item by ref and sends no
// priority. A `listBoard` already in flight keeps that ref when its snapshot
// omits it. A later refresh still drops an absent ref. The surface loads
// lazily: exactly one `kanban:listBoard` call on first activation. The host
// retains each visited project session while hidden; activation and Refresh
// share a background load. Inline states are in KanbanBoardStatus. No
// drag-and-drop. Start and Resume (KanbanItemActions) only ask the host.

interface KanbanBoardProps {
  app: AppApi
  /** Active project; the board never renders without one. */
  projectId: string
  /** Opens Project Settings on the Tasks section (the not-configured state). */
  onConfigure: () => void
  /**
   * Supplied for a `local-file` binding only: a missing task file offers
   * `Use a local task list`, which creates it (project-home spec Edge cases).
   */
  onUseLocalTaskList?: () => Promise<void>
  /** Opens Project Settings on the tab that owns the handoff directory. */
  onConfigureHandoffs?: () => void
  /**
   * Opens the Start confirmation in the app shell. Start is always shown, for
   * every item, and disabled when Resume is shown.
   */
  onStart?: (item: WorkItem) => void
  /**
   * Start without sending (NEKODE-99): the Start button's context menu offers
   * it. Without this callback the Start button has no menu.
   */
  onStartDraft?: (item: WorkItem) => void
  /**
   * Opens the Resume and handoff confirmation in the app shell. Resume is a
   * row control shown only for an item the batch handoff check proved
   * available.
   */
  onResume?: (item: WorkItem) => void
  /** Hidden retained sessions never initiate requests. */
  active?: boolean
  /**
   * External toolbar control bridge (e.g. ActionBar host). When supplied,
   * KanbanBoard omits its internal header.
   */
  onToolbarControls?: (controls: KanbanToolbarControls | null) => void
}

export function KanbanBoard({
  app,
  projectId,
  onConfigure,
  onUseLocalTaskList,
  onConfigureHandoffs,
  onStart,
  onStartDraft,
  onResume,
  active = true,
  onToolbarControls,
}: KanbanBoardProps): React.JSX.Element {
  const [phase, setPhase] = useState<KanbanBoardPhase>('loading')
  const [board, setBoard] = useState<KanbanBoardData>({ states: [], items: [] })
  const [error, setError] = useState<string | null>(null)
  // The last load failed because the local task file is missing (`not_found`
  // with the missing-file detail). An unknown project or a missing project
  // folder is also `not_found`, but creating the file cannot fix it.
  const [sourceMissing, setSourceMissing] = useState(false)
  const [reviewRef, setReviewRef] = useState<string | null>(null)
  const [copyMenu, setCopyMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null)
  const [startMenu, setStartMenu] = useState<{ item: WorkItem; x: number; y: number } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const prefs = useKanbanListPrefs(projectId)
  const { sortState, reload: reloadPrefs } = prefs
  const [searchQuery, setSearchQuery] = useState('')
  const { columns, isFiltering } = visibleBoardColumns(board, searchQuery)
  const handoff = useHandoffAvailability(app, projectId)
  const { load: loadHandoff, reset: resetHandoff } = handoff
  const [draft, setDraft] = useState<NewTaskDraft | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [statusChoice, setStatusChoice] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [priorityChoice, setPriorityChoice] = useState<KanbanPriority | null | undefined>(undefined)
  const [priorityError, setPriorityError] = useState<string | null>(null)
  const [reviewCopy, setReviewCopy] = useState<{ text: string; x: number; y: number } | null>(null)
  const [updatingReview, setUpdatingReview] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const hasSnapshot = useRef(false)
  const createGeneration = useRef(0)
  const createBusy = useRef(false)
  const loadRequest = useRef(0)
  // Writes that succeeded while this listBoard request was already pending.
  // Creates fill omitted refs. Status updates replace that ref. A refresh that
  // starts afterwards keeps the normal remove-absent rule.
  const retainedCreates = useRef(new Map<number, WorkItem[]>())
  const retainedUpdates = useRef(new Map<number, WorkItem[]>())
  const reviewGeneration = useRef(0)
  const reviewBusy = useRef(false)
  // `local-file` document revision from the latest board or write (project-home
  // spec Data / API). Process adapters never report one, so it stays undefined
  // and their writes carry no revision.
  const revisionRef = useRef<number | undefined>(undefined)
  const boardRef = useRef(board)
  const projectRef = useRef(projectId)
  const shownReviewRef = useRef<string | null>(null)
  boardRef.current = board
  projectRef.current = projectId
  shownReviewRef.current = reviewRef

  const closeNewTask = useCallback(() => {
    setDraft(null)
    setCreateError(null)
  }, [])

  useEffect(() => {
    generation.current += 1
    pending.current = false
    hasSnapshot.current = false
    loadRequest.current += 1
    retainedCreates.current.clear()
    retainedUpdates.current.clear()
    revisionRef.current = undefined
    setSourceMissing(false)
    setBoard({ states: [], items: [] })
    setPhase('loading')
    setReviewRef(null)
    setCopyMenu(null)
    setStartMenu(null)
    setError(null)
    setRefreshing(false)
    createGeneration.current += 1
    createBusy.current = false
    setCreatingBusy(false)
    reloadPrefs(projectId)
    setSearchQuery('')
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewCopy(null)
    // The previous project's review write must not keep these selects locked.
    reviewBusy.current = false
    setUpdatingReview(false)
    resetHandoff()
  }, [projectId, closeNewTask, reloadPrefs, resetHandoff])

  useEffect(() => {
    if (phase !== 'ready') closeNewTask()
  }, [phase, closeNewTask])

  // Clears or loads the review comments; on a project change it runs after the
  // reset above, so it alone decides the comment state.
  const reviewComments = useReviewComments(app, projectId, reviewRef)

  // A changed binding is a new keyed component in the host. Cleanup excludes
  // late responses from that disposed session (including StrictMode replay).
  useEffect(() => {
    return () => {
      generation.current += 1
      pending.current = false
      createGeneration.current += 1
      createBusy.current = false
      reviewGeneration.current += 1
      reviewBusy.current = false
    }
  }, [])

  const recheckHandoff = useCallback((): void => {
    void loadHandoff(boardRef.current.items.map((entry) => ({ itemId: entry.id, ref: entry.ref })))
  }, [loadHandoff])

  // One load: the mount effect and the refresh control share it. An
  // unconfigured project rejects with the typed validation error naming the
  // project (spec Behaviour 9), which is the not-configured state; every other
  // rejection is surfaced as its typed message inline, never a silent drop.
  const load = useCallback(async (): Promise<void> => {
    if (pending.current) return
    pending.current = true
    const requestGeneration = generation.current
    const requestId = ++loadRequest.current
    if (!hasSnapshot.current) setPhase('loading')
    setRefreshing(true)
    setError(null)
    try {
      const next = await app.kanban.listBoard(projectId)
      if (requestGeneration !== generation.current) return
      hasSnapshot.current = true
      revisionRef.current = next.revision
      setSourceMissing(false)
      const retained = retainedCreates.current.get(requestId) ?? []
      retainedCreates.current.delete(requestId)
      const keptUpdates = retainedUpdates.current.get(requestId) ?? []
      retainedUpdates.current.delete(requestId)
      const result = reconcileBoardResponse({
        previousBoard: boardRef.current,
        incomingBoard: next,
        retainedCreates: retained,
        retainedUpdates: keptUpdates,
        currentReviewRef: shownReviewRef.current,
      })
      setBoard(result.board)
      setReviewRef(result.reviewRef)
      setPhase(result.phase)
      // Availability is checked on activation, tab return and Refresh; the
      // board render never waits for it (spec Resume availability item 7).
      void loadHandoff(next.items.map((entry) => ({ itemId: entry.id, ref: entry.ref })))
    } catch (cause) {
      if (requestGeneration !== generation.current) return
      retainedCreates.current.delete(requestId)
      retainedUpdates.current.delete(requestId)
      const payload = parseAppErrorPayload(cause)
      if (payload?.code === 'validation' || payload?.code === 'not_found') {
        hasSnapshot.current = false
        setBoard({ states: [], items: [] })
        setReviewRef(null)
        setCopyMenu(null)
        setStartMenu(null)
        setError(payload.message)
        setSourceMissing(payload.code === 'not_found' && payload.detail === LOCAL_TASK_FILE_MISSING)
        setPhase(payload.code === 'validation' ? 'not-configured' : 'error')
        return
      }
      setSourceMissing(false)
      setError(payload?.message ?? 'Failed to load tasks.')
      if (!hasSnapshot.current) setPhase('error')
    } finally {
      if (requestGeneration === generation.current) {
        pending.current = false
        setRefreshing(false)
      }
    }
  }, [app, projectId, loadHandoff])

  // Lazy first activation and one background refresh on each tab return.
  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const reviewItem =
    phase === 'ready' && reviewRef !== null
      ? (board.items.find((entry) => entry.ref === reviewRef) ?? null)
      : null

  const openNewTask = useCallback((): void => {
    if (draft !== null || createBusy.current) return
    setCreateError(null)
    setDraft({
      stateRef: defaultNewTaskStateRef(board.states),
      title: '',
      description: '',
      priority: null,
    })
  }, [draft, board.states])

  async function submitNewTask(): Promise<void> {
    if (draft === null || createBusy.current) return
    const title = draft.title
    const stateRef = draft.stateRef
    const description = draft.description
    const priority = draft.priority
    if (title.trim() === '' || stateRef.trim() === '') return
    const input: KanbanCreateInput = { title, stateRef }
    if (description.trim() !== '') input.description = description
    if (priority !== null) input.priority = priority
    const request = ++createGeneration.current
    const sourceProject = projectId
    createBusy.current = true
    setCreatingBusy(true)
    setCreateError(null)
    try {
      const writeRevision = revisionRef.current
      const { revision, ...created } =
        writeRevision === undefined
          ? await app.kanban.createItem(sourceProject, input)
          : await app.kanban.createItem(sourceProject, input, writeRevision)
      if (request !== createGeneration.current || sourceProject !== projectRef.current) return
      if (revision !== undefined) revisionRef.current = revision
      setBoard((previous) => {
        const items = upsertWorkItem(previous.items, created)
        return items === previous.items ? previous : { ...previous, items }
      })
      if (pending.current) {
        const inFlight = loadRequest.current
        const existing = retainedCreates.current.get(inFlight) ?? []
        retainedCreates.current.set(inFlight, upsertWorkItem(existing, created))
      }
      setDraft(null)
      setCreateError(null)
    } catch (cause) {
      if (request !== createGeneration.current || sourceProject !== projectRef.current) return
      setCreateError(writeFailureMessage(cause, 'Could not create the task.'))
      // A stale `local-file` revision changed nothing: refetch, never merge.
      if (parseAppErrorPayload(cause)?.code === 'conflict') void load()
    } finally {
      if (request === createGeneration.current) {
        createBusy.current = false
        setCreatingBusy(false)
      }
    }
  }

  async function submitReviewWrite(
    write:
      | { field: 'status'; stateRef: string }
      | { field: 'priority'; priority: KanbanPriority | null },
  ): Promise<void> {
    // A second change must not bump the generation: that drops this success
    // before the board or retainedUpdates is updated.
    if (reviewBusy.current) return
    const ref = reviewRef
    if (ref === null) return
    const current = boardRef.current.items.find((entry) => entry.ref === ref)
    if (current === undefined) return
    if (write.field === 'status') {
      if (statusChoice === null && write.stateRef === current.stateName) return
    } else if (priorityChoice === undefined && write.priority === current.priority) {
      return
    }
    const request = ++reviewGeneration.current
    const sourceProject = projectId
    const patch: KanbanUpdatePatch =
      write.field === 'status' ? { stateRef: write.stateRef } : { priority: write.priority }
    reviewBusy.current = true
    setUpdatingReview(true)
    setStatusError(null)
    setPriorityError(null)
    if (write.field === 'status') {
      setStatusChoice(write.stateRef)
    } else {
      setPriorityChoice(write.priority)
    }
    try {
      const writeRevision = revisionRef.current
      const { revision, ...updated } =
        writeRevision === undefined
          ? await app.kanban.updateItem(sourceProject, ref, patch)
          : await app.kanban.updateItem(sourceProject, ref, patch, writeRevision)
      if (request !== reviewGeneration.current || sourceProject !== projectRef.current) return
      if (revision !== undefined) revisionRef.current = revision
      setBoard((previous) => {
        const items = upsertWorkItem(previous.items, updated)
        return items === previous.items ? previous : { ...previous, items }
      })
      if (pending.current) {
        const inFlight = loadRequest.current
        const existing = retainedUpdates.current.get(inFlight) ?? []
        retainedUpdates.current.set(inFlight, upsertWorkItem(existing, updated))
      }
      if (shownReviewRef.current === ref) {
        if (write.field === 'status') {
          setStatusChoice(null)
        } else {
          setPriorityChoice(undefined)
        }
        setStatusError(null)
        setPriorityError(null)
      }
    } catch (cause) {
      if (request !== reviewGeneration.current || sourceProject !== projectRef.current) return
      // A stale `local-file` revision changed nothing: refetch, never merge.
      if (parseAppErrorPayload(cause)?.code === 'conflict') void load()
      if (shownReviewRef.current !== ref) return
      const message = writeFailureMessage(
        cause,
        write.field === 'status'
          ? 'Could not update the status.'
          : 'Could not update the priority.',
      )
      if (write.field === 'status') {
        setStatusChoice(null)
        setStatusError(message)
      } else {
        setPriorityChoice(undefined)
        setPriorityError(message)
      }
    } finally {
      if (request === reviewGeneration.current) {
        reviewBusy.current = false
        setUpdatingReview(false)
      }
    }
  }

  const closeReview = useCallback((): void => {
    setReviewRef(null)
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewCopy(null)
  }, [])

  const openReview = (ref: string): void => {
    setCopyMenu(null)
    setStartMenu(null)
    setReviewCopy(null)
    closeNewTask()
    setStatusChoice(null)
    setStatusError(null)
    setPriorityChoice(undefined)
    setPriorityError(null)
    setReviewRef(ref)
  }

  const openCopyMenu = (item: WorkItem, x: number, y: number): void => {
    setStartMenu(null)
    setCopyMenu({ item, x, y })
  }

  const openStartMenu = (item: WorkItem, x: number, y: number): void => {
    setCopyMenu(null)
    setReviewCopy(null)
    setStartMenu({ item, x, y })
  }
  const startMenuOpener = onStartDraft === undefined ? undefined : openStartMenu

  const refresh = useCallback((): void => {
    void load()
  }, [load])
  const toolbarControls: KanbanToolbarControls = {
    phase,
    refreshing,
    isReviewing: reviewItem !== null,
    creatingBusy,
    sortState,
    searchQuery,
    onSearchQueryChange: setSearchQuery,
    onSortByChange: prefs.onSortByChange,
    onToggleSortDirection: prefs.onToggleSortDirection,
    onRefresh: refresh,
    onNewTask: openNewTask,
    onCloseReview: closeReview,
  }
  useKanbanToolbarBridge(onToolbarControls, active, toolbarControls)

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 text-[12.6px]"
      data-testid={TEST_ID.kanbanBoard}
    >
      {onToolbarControls ? null : <KanbanHeader {...toolbarControls} />}
      {phase === 'ready' && reviewItem === null && draft !== null ? (
        <KanbanCreateTaskForm
          states={board.states}
          draft={draft}
          busy={creatingBusy}
          error={createError}
          onChange={(next) => {
            setDraft(next)
          }}
          onSubmit={() => {
            void submitNewTask()
          }}
          onCancel={closeNewTask}
        />
      ) : null}
      {handoff.phase !== 'loading' ? (
        <HandoffNotices
          phase={handoff.phase}
          error={handoff.error}
          warnings={handoff.warnings}
          onConfigureHandoffs={onConfigureHandoffs}
          onRetry={recheckHandoff}
        />
      ) : null}
      <KanbanBoardStatus
        phase={phase}
        error={error}
        sourceMissing={sourceMissing}
        onConfigure={onConfigure}
        onUseLocalTaskList={onUseLocalTaskList}
      />
      {reviewItem !== null ? (
        <KanbanItemReview
          item={reviewItem}
          states={board.states}
          statusValue={statusChoice ?? reviewItem.stateName}
          statusError={statusError}
          priorityValue={priorityChoice !== undefined ? priorityChoice : reviewItem.priority}
          priorityError={priorityError}
          fieldsDisabled={updatingReview}
          resumeEnabled={handoff.itemResumable(reviewItem)}
          comments={reviewComments.comments}
          commentsLoading={reviewComments.loading}
          commentsError={reviewComments.error}
          onStart={onStart}
          onResume={onResume}
          onOpenStartMenu={startMenuOpener}
          onStatusChange={(nextName) => {
            void submitReviewWrite({ field: 'status', stateRef: nextName })
          }}
          onPriorityChange={(nextPriority) => {
            void submitReviewWrite({ field: 'priority', priority: nextPriority })
          }}
          onCopyText={(text, x, y) => {
            setReviewCopy({ text, x, y })
          }}
        />
      ) : null}
      {phase === 'ready' && reviewItem === null ? (
        <KanbanListView
          columns={columns}
          isFiltering={isFiltering}
          collapsedStates={prefs.collapsedStates}
          sortState={sortState}
          itemResumable={handoff.itemResumable}
          onToggleCollapse={prefs.onToggleCollapse}
          onOpen={openReview}
          onOpenMenu={openCopyMenu}
          onStart={onStart}
          onResume={onResume}
          onOpenStartMenu={startMenuOpener}
        />
      ) : null}
      {copyMenu !== null ? (
        <ItemCopyMenu
          item={copyMenu.item}
          x={copyMenu.x}
          y={copyMenu.y}
          onClose={() => {
            setCopyMenu(null)
          }}
        />
      ) : null}
      {startMenu !== null && onStartDraft !== undefined ? (
        <StartMenu
          item={startMenu.item}
          x={startMenu.x}
          y={startMenu.y}
          onStart={onStart}
          onStartDraft={onStartDraft}
          onClose={() => {
            setStartMenu(null)
          }}
        />
      ) : null}
      {reviewCopy !== null ? (
        <ReviewTextMenu
          text={reviewCopy.text}
          x={reviewCopy.x}
          y={reviewCopy.y}
          onClose={() => {
            setReviewCopy(null)
          }}
        />
      ) : null}
    </div>
  )
}
