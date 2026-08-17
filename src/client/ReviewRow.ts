/**
 * The General-settings row for the reviewer route preference: follow the main
 * conversation model, or pin a provider/model pair (validated host-side with
 * catalog fallback). Writes travel through the settings-scope transport; the
 * host re-judges the route on the next ask, no restart required.
 */
import React from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReviewSettings } from '../settings-shared.ts'
import { DEFAULT_REVIEW_SETTINGS } from '../settings-shared.ts'

/** Full component props: runtime share + the bound settings scope. */
export interface ReviewRowProps {
  readonly host: SettingsScope<ReviewSettings>
}

export type ReviewRowComponentProps = PropsRuntime<'settings.general.item'> & ReviewRowProps

/** Read the settings scope reactively. */
function useReviewSettings(host: SettingsScope<ReviewSettings>): ReviewSettings {
  return React.useSyncExternalStore(
    (onStoreChange) => host.subscribe(onStoreChange),
    () => host.getSnapshot().value ?? DEFAULT_REVIEW_SETTINGS,
  )
}

/** Render the compact reviewer-route row. */
export function ReviewRow(props: ReviewRowComponentProps): React.ReactElement {
  const { host } = props
  const settings = useReviewSettings(host)
  const setField = (field: keyof ReviewSettings, value: string): void => {
    void host.set(field, value)
  }
  const labelStyle = { fontSize: 12, color: 'var(--dsw-text-secondary, #888)', marginTop: 6 } as const
  const inputStyle = {
    padding: '6px 8px',
    fontSize: 13,
    border: '1px solid var(--dsw-border, #ccc)',
    borderRadius: 6,
    background: 'var(--dsw-surface, transparent)',
    color: 'var(--dsw-text, inherit)',
  } as const
  const inputs = settings.route === 'fixed'
    ? [
        React.createElement('label', { key: 'pl', style: labelStyle }, 'Provider'),
        React.createElement('input', {
          key: 'pi',
          value: settings.provider,
          placeholder: 'deepseek-official',
          style: inputStyle,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setField('provider', event.target.value) },
        }),
        React.createElement('label', { key: 'ml', style: labelStyle }, 'Model'),
        React.createElement('input', {
          key: 'mi',
          value: settings.model,
          placeholder: 'deepseek-v4-flash',
          style: inputStyle,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setField('model', event.target.value) },
        }),
        React.createElement('div', { key: 'hint', style: { fontSize: 11, color: 'var(--dsw-text-tertiary, #aaa)', marginTop: 4 } }, '例如 deepseek-official / deepseek-v4-flash'),
      ]
    : []
  return React.createElement('div', { style: { padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, '替我审核模型 · Auto-review model'),
    React.createElement('select', {
      value: settings.route,
      style: inputStyle,
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setField('route', event.target.value) },
    },
      React.createElement('option', { value: 'session' }, '跟随主会话 · Follow main conversation'),
      React.createElement('option', { value: 'fixed' }, '指定模型 · Fixed model'),
    ),
    ...inputs,
  )
}
