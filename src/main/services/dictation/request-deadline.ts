export const DICTATION_REQUEST_TIMEOUT_MS = 120_000
export class DictationDeadlineError extends Error {}

export async function withDictationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  caller?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let rejectAbort: (reason: Error) => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  const cancel = () => {
    rejectAbort(new DictationDeadlineError('Dictation request timed out or was cancelled.'))
    controller.abort()
  }
  const timer = setTimeout(cancel, DICTATION_REQUEST_TIMEOUT_MS)
  caller?.addEventListener('abort', cancel, { once: true })
  if (caller?.aborted) cancel()
  try {
    return await Promise.race([caller?.aborted ? aborted : operation(controller.signal), aborted])
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', cancel)
  }
}
