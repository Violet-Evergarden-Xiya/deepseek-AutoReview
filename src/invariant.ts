/**
 * Package-owned verdict-stream invariant for the model-backed reviewer.
 * @module deepseek-autoreview/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'deepseek-autoreview'
const DECISIONS = ['allow', 'refer', 'deny'] as const

/** Cordis companion plugin name. */
export const name = 'autoreview-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'review/verdict') return
    if (event.data.toolName.length === 0) fail('review/verdict toolName must be non-empty')
    if (!DECISIONS.includes(event.data.decision)) {
      fail(`review/verdict carries unknown decision ${JSON.stringify(event.data.decision)}`)
    }
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the reviewer invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
