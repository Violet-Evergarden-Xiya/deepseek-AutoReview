import { clientBundle } from './tsdown.client.ts'

/**
 * Node half (index + invariant companion) plus the browser client bundle
 * (the General-settings reviewer-route row).
 */
export default clientBundle(
  'deepseek-autoreview',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {},
)
