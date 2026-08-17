/**
 * The General-settings row for the reviewer route preference: follow the main
 * conversation model, or pin a provider/model pair (validated host-side with
 * catalog fallback). Writes travel through the settings-scope transport; the
 * host re-judges the route on the next ask, no restart required.
 */
import React from 'react';
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ReviewSettings } from '../settings-shared.ts';
/** Full component props: runtime share + the bound settings scope. */
export interface ReviewRowProps {
    readonly host: SettingsScope<ReviewSettings>;
}
export type ReviewRowComponentProps = PropsRuntime<'settings.general.item'> & ReviewRowProps;
/** Render the compact reviewer-route row. */
export declare function ReviewRow(props: ReviewRowComponentProps): React.ReactElement;
