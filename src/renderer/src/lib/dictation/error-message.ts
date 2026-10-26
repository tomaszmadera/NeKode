import type { DictationError } from '@shared/contracts/dictation-contract'

const cloudMessages: Partial<Record<DictationError, string>> = {
  'auth-failed': "Check the selected dictation provider's API key in Settings.",
  'cloud-consent-required':
    'Allow sending recordings and vocabulary hints to OpenWhispr Cloud in Settings before dictating.',
  'plan-required': 'OpenWhispr Cloud requires Pro or Business. Check your subscription.',
  forbidden:
    'Check your personal OpenWhispr key, transcriptions:write scope and organization Cloud policy in Settings.',
  'audio-rejected':
    'OpenWhispr Cloud rejected the audio or language. Check Settings and record a new take.',
  'audio-too-large':
    'This recording exceeds the OpenWhispr Cloud 4 MB limit. Record a shorter take (about two minutes).',
  'concurrency-limit':
    'Another transcription is using this OpenWhispr key. Wait until it finishes before retrying.',
  'quota-exceeded':
    'Your monthly OpenWhispr Cloud transcription allowance is exhausted. Wait for renewal.',
  'rate-limited': 'The OpenWhispr Cloud request limit was reached. Wait before retrying.',
  'service-unavailable': 'OpenWhispr Cloud beta is unavailable. Try again later.',
  'provider-failure': 'OpenWhispr Cloud could not transcribe this take. Try again later.',
}

export function dictationErrorMessage(error: DictationError, providerId?: string): string {
  if (providerId === 'openwhispr-cloud') {
    if (error === 'auth-failed')
      return 'Configure a valid personal OpenWhispr Cloud key in Settings.'
    if (error === 'malformed-response')
      return 'OpenWhispr Cloud returned an invalid response. Try again later.'
    if (error === 'unreachable')
      return 'Cannot reach OpenWhispr Cloud. Check your connection and try again.'
    if (error === 'timeout')
      return 'OpenWhispr Cloud timed out. Check your connection before trying again.'
  }
  return cloudMessages[error] ?? error
}
