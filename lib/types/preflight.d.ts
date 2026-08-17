/**
 * Static danger stop-list matched against bash command text before the model
 * review runs. A hit delegates the ask (refer) without spending a model call.
 * @module @deepseek-ai/dsh-review-approval
 */
/** One static danger pattern. */
export interface DangerousPattern {
    /** Stable diagnostic id. */
    readonly id: string;
    /** Matched against the reviewed bash command text. */
    readonly pattern: RegExp;
}
/**
 * Deliberately narrow — one catastrophic shape per entry — because a false
 * positive only costs a human prompt, while a miss must still be caught by
 * the reviewer rubric. Preflight applies to `bash` asks only; file writes are
 * reviewed by the model over their real path and content head.
 */
export declare const DANGEROUS_PATTERNS: readonly DangerousPattern[];
