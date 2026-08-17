/**
 * Verdict vocabulary for the model-backed permission reviewer.
 * @module @deepseek-ai/dsh-review-approval
 */

import type { CallId } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One reviewer decision on a permission ask — log-only audit (like
     * `approval/*`; NOT a surface event, carries no `surfaceOp`). `allow`
     * auto-approves the ask; `refer` delegates it to the next answerer (the
     * human approval channel). Appended before the matching
     * `approval/decided`, so replay keeps the pair inside the ask.
     */
    'review/verdict': {
      /** The tool the reviewed ask is about. */
      toolName: string
      /** The exact tool call, when the ask carried one. */
      callId?: CallId
      /** The reviewer's decision on this ask. */
      decision: ReviewDecision
      /** Short human-readable rationale, when the reviewer supplied one. */
      rationale?: string
      /** Why the review failed (judgment error or timeout); implies `refer`. */
      error?: string
    }
  }
}

/** One closed reviewer decision: auto-approve or hand to the next answerer. */
export type ReviewDecision = 'allow' | 'refer'

/** The reviewer's normalized answer for one ask. */
export interface ReviewVerdict {
  /** `allow` auto-approves the ask; `refer` delegates it onward. */
  decision: ReviewDecision
  /** Bounded human-readable rationale; empty when unavailable. */
  rationale: string
  /** Set when the review itself failed; the caller delegates. */
  error?: string
}
