/** Live microphone level for the dictation meter (NEKODE-200).
 *
 * The audio worklet reports an RMS value about ten times per second; this
 * module maps it onto the 0..1 range the CSS meter consumes. The dBFS window
 * puts silence at -60 dBFS and a loud, close microphone at -10 dBFS, so a weak
 * or disconnected microphone stays low instead of looking like normal speech.
 */

export const DICTATION_LEVEL_FLOOR_DBFS = -60
export const DICTATION_LEVEL_CEILING_DBFS = -10
export const DICTATION_LEVEL_WINDOW_SECONDS = 0.1

export function dictationLevelFromRms(rms: number): number {
  if (!(rms > 0)) return 0
  const dbfs = 20 * Math.log10(rms)
  const scaled =
    (dbfs - DICTATION_LEVEL_FLOOR_DBFS) /
    (DICTATION_LEVEL_CEILING_DBFS - DICTATION_LEVEL_FLOOR_DBFS)
  return Math.min(1, Math.max(0, scaled))
}
