/**
 * Browser half of deepseek-autoreview: the General-settings row switching the
 * reviewer model route at runtime (follow the main conversation, or pin a
 * provider/model pair). Settings travel through the settings-scope transport;
 * the host re-judges the route on the next ask without a restart.
 */
import React from 'react'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { REVIEW_SETTINGS_NAMESPACE } from '../settings-shared.ts'
import type { ReviewSettings } from '../settings-shared.ts'
import { ReviewRow } from './ReviewRow.ts'

/**
 * Compose the settings row: bind the settings scope and contribute the
 * compact row to the General section.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  const host: SettingsScope<ReviewSettings> = ctx.settingsScope.bind<ReviewSettings>({ namespace: REVIEW_SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'autoreview',
    order: 30,
  }, (props) => React.createElement(ReviewRow, { ...props, host })))
}
