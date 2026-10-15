import { useEffect, useRef, useState } from 'react'
import type {
  DictationDictionaryError,
  DictationDictionary as Dictionary,
} from '../../../../shared/dictation-contract'
import type { AppApi } from '../../../../shared/ipc-contract'

export interface DictationDictionaryErrorEntry {
  readonly kind: DictationDictionaryError
  readonly code: DictationDictionaryError
  readonly message: string
}

export const DICTATION_DICTIONARY_ERROR_TABLE: Record<
  DictationDictionaryError,
  DictationDictionaryErrorEntry
> = {
  'bridge-missing': {
    kind: 'bridge-missing',
    code: 'bridge-missing',
    message:
      'The OpenWhispr local bridge is missing. Start OpenWhispr, then refresh the dictionary.',
  },
  'bridge-invalid': {
    kind: 'bridge-invalid',
    code: 'bridge-invalid',
    message:
      'The OpenWhispr local bridge configuration is invalid. Restart OpenWhispr, then refresh the dictionary.',
  },
  unreachable: {
    kind: 'unreachable',
    code: 'unreachable',
    message:
      'The OpenWhispr local bridge is unavailable. Check OpenWhispr, then refresh the dictionary.',
  },
  'auth-failed': {
    kind: 'auth-failed',
    code: 'auth-failed',
    message:
      'The OpenWhispr local bridge rejected authentication. Restart OpenWhispr, then refresh the dictionary.',
  },
  'malformed-response': {
    kind: 'malformed-response',
    code: 'malformed-response',
    message:
      'The OpenWhispr dictionary response is invalid. No complete dictionary could be displayed.',
  },
  'unsupported-pagination': {
    kind: 'unsupported-pagination',
    code: 'unsupported-pagination',
    message:
      'This OpenWhispr bridge requires unsupported dictionary pagination. No complete dictionary could be displayed.',
  },
  'dictionary-limit': {
    kind: 'dictionary-limit',
    code: 'dictionary-limit',
    message:
      'The OpenWhispr dictionary exceeds the supported limit of 10,000 entries. No complete dictionary could be displayed.',
  },
}

export function DictationDictionary({ api }: { api: AppApi['dictation'] }) {
  const [result, setResult] = useState<Dictionary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const pending = useRef(true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is the explicit user-request token, not an automatic poll.
  useEffect(() => {
    let disposed = false
    pending.current = true
    setLoading(true)
    setResult(null)
    setFailed(false)
    api
      .dictionaryList()
      .then(
        (next) => {
          if (!disposed) setResult(next)
        },
        () => {
          if (!disposed) setFailed(true)
        },
      )
      .finally(() => {
        if (!disposed) {
          pending.current = false
          setLoading(false)
        }
      })
    return () => {
      disposed = true
    }
  }, [api, refresh])
  return (
    <section
      aria-labelledby="dictation-dictionary-title"
      className="mt-5 space-y-3 border-t border-edge pt-4 text-sm text-ink-secondary"
    >
      <h3 id="dictation-dictionary-title" className="font-semibold text-ink">
        Dictionary (OpenWhispr)
      </h3>
      <p>
        OpenWhispr manages this dictionary and its use in desktop dictation. This list is read-only
        in NeKode.
      </p>
      <p>
        Local bridge only: the file-transcription API does not accept dictionary or keyterm hints.
        NeKode does not apply these terms to local bridge transcriptions.
      </p>
      <button
        type="button"
        disabled={loading}
        className="rounded border border-edge px-3 py-1 hover:bg-highlight disabled:opacity-50"
        onClick={() => {
          if (pending.current) return
          pending.current = true
          setRefresh((value) => value + 1)
        }}
      >
        Refresh dictionary
      </button>
      <div aria-live="polite">
        {loading ? (
          <p>Loading dictionary...</p>
        ) : failed ? (
          <p role="alert" data-error-kind="load-failed" data-error-code="load-failed">
            The dictionary could not load. Refresh to try again. Desktop dictation settings are
            independent.
          </p>
        ) : result?.state === 'unavailable' ? (
          <p
            role="alert"
            data-error-kind={DICTATION_DICTIONARY_ERROR_TABLE[result.error].kind}
            data-error-code={DICTATION_DICTIONARY_ERROR_TABLE[result.error].code}
          >
            {DICTATION_DICTIONARY_ERROR_TABLE[result.error].message} Desktop dictation settings are
            independent.
          </p>
        ) : result?.state === 'ready' ? (
          <>
            <p>
              {result.terms.length} {result.terms.length === 1 ? 'entry' : 'entries'}
            </p>
            {result.terms.length === 0 ? (
              <p>The OpenWhispr dictionary is empty.</p>
            ) : (
              <ul className="max-h-48 overflow-auto rounded border border-edge p-3">
                {result.terms.slice(0, 200).map((term, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: raw duplicate terms are preserved; each refresh replaces the complete stateless snapshot after loading.
                  <li key={`${index}:${term}`} className="whitespace-pre-wrap break-words">
                    {term}
                  </li>
                ))}
              </ul>
            )}
            {result.terms.length > 200 ? (
              <p>Showing the first 200 of {result.terms.length} entries.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  )
}
