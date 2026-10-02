// Attention alert settings (attention-alert-settings spec Data/API): four
// app-global off-switches persisted in the flat app_state store. Missing key
// or any value other than '0' means enabled — every toggle defaults on and
// only an explicit turn-off persists '0'.

import { APP_STATE_KEY } from '../../../shared/ipc-contract'

export interface AttentionSettings {
  /** Amber badge on unselected chats' rows. */
  badge: boolean
  /** Chime when an unselected chat needs attention. */
  chime: boolean
  /** Chime when the active (selected) chat needs attention. */
  activeChime: boolean
  /** Amber indicator on the active chat's row. */
  activeIndicator: boolean
}

export const DEFAULT_ATTENTION_SETTINGS: AttentionSettings = {
  badge: true,
  chime: true,
  activeChime: true,
  activeIndicator: true,
}

/** app_state key per setting, in AttentionSettings field order. */
export const ATTENTION_SETTING_KEYS: Record<keyof AttentionSettings, string> = {
  badge: APP_STATE_KEY.attentionBadgeEnabled,
  chime: APP_STATE_KEY.attentionChimeEnabled,
  activeChime: APP_STATE_KEY.attentionActiveChimeEnabled,
  activeIndicator: APP_STATE_KEY.attentionActiveIndicatorEnabled,
}

/** Off-switch parse: '0' disables; missing or anything else enables. */
export function parseAttentionSettings(values: {
  badge: string | null
  chime: string | null
  activeChime: string | null
  activeIndicator: string | null
}): AttentionSettings {
  return {
    badge: values.badge !== '0',
    chime: values.chime !== '0',
    activeChime: values.activeChime !== '0',
    activeIndicator: values.activeIndicator !== '0',
  }
}
