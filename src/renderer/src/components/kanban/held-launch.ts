import type { KanbanLaunchTaskInput } from '../../../../shared/ipc-contract'

/** A Start whose chat exists and whose argv was not delivered. */
export interface HeldLaunch {
  message: string
  input: KanbanLaunchTaskInput
}

/** Stable empty map so a workspace effect does not rerun every render. */
export const EMPTY_HELD_LAUNCHES: Readonly<Record<string, HeldLaunch>> = {}
