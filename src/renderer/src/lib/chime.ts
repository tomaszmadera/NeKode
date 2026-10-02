// Attention chime (attention-alert-settings spec Behaviour 5): one short
// synthesized tone played when a chat's attention signal sets or re-sets
// attention state. Renderer-side Web Audio — no files, no dependencies, no
// persistence, and it never touches the terminal data path. A missing or
// failed AudioContext degrades silently to no sound (spec Behaviour 7 /
// Errors): detection, state, and badges are unaffected and nothing surfaces.
//
// The context is created per play and closed when the tone ends: a chime is
// rare (one per detected signal), so no cached-context bookkeeping is worth
// the test seam.

export function playAttentionChime(): void {
  if (typeof AudioContext === 'undefined') {
    return
  }
  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    return
  }
  try {
    if (context.state === 'suspended') {
      // Autoplay policies can start the context suspended; a resume attempt
      // is best effort — the tone plays once a gesture has happened anyway.
      void context.resume().catch(() => undefined)
    }
    const now = context.currentTime
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    // A soft descending blip (~0.3 s), quiet by default (spec Non-goals:
    // no volume configuration — one fixed quiet tone).
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.exponentialRampToValueAtTime(660, now + 0.25)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.32)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
      void context.close().catch(() => undefined)
    }
  } catch {
    void context.close().catch(() => undefined)
  }
}
