/**
 * Verdict vocabulary for the model-backed permission reviewer.
 * @module deepseek-autoreview
 */

import type { CallId } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One reviewer decision on a permission ask — log-only audit (like
     * `approval/*`; NOT a surface event, carries no `surfaceOp`). `allow`
     * auto-approves the ask; `refer` delegates it to the next answerer (the
     * human approval channel); `deny` rejects it deterministically.
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
      /** Which layer produced the decision. */
      source?: ReviewSource
      /** Reviewer model id that produced a model judgment. */
      model?: string
      /** Judgment latency in milliseconds. */
      latencyMs?: number
      /** First 12 hex of the sha256 of the framed operation text. */
      evidenceSha256?: string
      /** The decision was a rate-limit delegate, not a judgment. */
      rateLimited?: boolean
      /** A pinned settings route was invalid; the judgment fell back. */
      routeFallback?: boolean
    }
  }
}

/** One closed reviewer decision. */
export type ReviewDecision = 'allow' | 'refer' | 'deny'

/** Which deterministic or model layer produced a decision. */
export type ReviewSource = 'whitelist' | 'blocklist' | 'model'

/** The reviewer's normalized answer for one ask. */
export interface ReviewVerdict {
  /** `allow` auto-approves, `refer` delegates onward, `deny` rejects. */
  decision: ReviewDecision
  /** Bounded human-readable rationale; empty when unavailable. */
  rationale: string
  /** Set when the review itself failed; the caller delegates. */
  error?: string
  /** Decision layer (deterministic layers skip the model entirely). */
  source?: ReviewSource
  /** Model id behind a model judgment. */
  model?: string
  /** Judgment latency in milliseconds. */
  latencyMs?: number
  /** Operation evidence fingerprint (first 12 hex of sha256). */
  evidenceSha256?: string
  /** True when the ask was delegated for rate-limit budget. */
  rateLimited?: boolean
  /** True when a pinned settings route failed validation and a fallback ran. */
  routeFallback?: boolean
}
