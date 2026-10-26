import { parseAppErrorPayload } from '@shared/ipc-error'

/** The serialized AppError message, or the caller's fallback for any other failure. */
export function errorMessage(error: unknown, fallback: string): string {
  return parseAppErrorPayload(error)?.message ?? fallback
}
