import type { DictationError } from '@shared/dictation-contract'

/** Only a fixed local code crosses the provider boundary; remote messages stay private. */
export class DictationProviderError extends Error {
  constructor(readonly error: DictationError) {
    super(error)
    this.name = 'DictationProviderError'
  }
}
