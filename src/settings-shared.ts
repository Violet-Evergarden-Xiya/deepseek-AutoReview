/**
 * Shared settings contract for the reviewer route — imported by both the
 * host half (settings registration) and the browser half (the settings row).
 * Pure constants and types only: no runtime imports reach the client bundle.
 * @module deepseek-autoreview/settings-shared
 */

import type { SettingsNamespace } from '@deepseek-ai/dsh-settings/types'

/** Settings namespace owning the reviewer route preference. */
export const REVIEW_SETTINGS_NAMESPACE = 'autoreview' as SettingsNamespace

/** How the reviewer route is chosen. */
export type ReviewRouteMode = 'session' | 'fixed'

/** The reviewer route preference persisted in user settings. */
export interface ReviewSettings {
  /** `session` follows the main conversation route; `fixed` pins provider/model. */
  route: ReviewRouteMode
  /** Pinned provider id; required for `fixed`. */
  provider: string
  /** Pinned model id; required for `fixed`. */
  model: string
}

/** Composition entry: follow the main conversation route. */
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { route: 'session', provider: '', model: '' }
