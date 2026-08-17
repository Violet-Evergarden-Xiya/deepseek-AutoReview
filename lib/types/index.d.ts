/**
 * Model-backed permission reviewer: the "review on my behalf" preset.
 *
 * Registers a PREPENDED `approval/request` answerer that claims asks only for
 * sessions whose selected permission preset names this plugin (default table
 * key `review`). Each claimed ask is judged by one auxiliary model call over
 * the real tool arguments recovered from the session log plus the latest user
 * request: `allow` auto-approves the escalation; anything else — `refer`,
 * judgment failure, timeout, or the static danger stop-list — delegates to
 * the next answerer (the human approval channel), so the seam stays
 * fail-closed. Every decision appends a log-only `review/verdict` audit event
 * and injects a concise transcript notice.
 *
 * @module @deepseek-ai/dsh-review-approval
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import type { ReviewVerdict } from './types.ts';
export type { ReviewVerdict, ReviewDecision } from './types.ts';
export type { DangerousPattern } from './preflight.ts';
export { DANGEROUS_PATTERNS } from './preflight.ts';
export declare const name = "review-approval";
export declare const inject: string[];
/** Plugin config. All optional — `Config` supplies the defaults. */
export interface Config {
    /** Permission-preset table keys that activate the reviewer. */
    presets?: string[];
    /** Explicit reviewer route provider; must be paired with `model`. */
    provider?: string;
    /** Explicit reviewer route model; must be paired with `provider`. */
    model?: string;
    /** Maximum bytes of user context framed into the judgment request. */
    maxInputBytes?: number;
    /** Maximum tokens for the judgment response. */
    maxOutputTokens?: number;
    /** End-to-end judgment deadline in milliseconds. */
    timeoutMs?: number;
    /** Concurrent in-flight judgments; over-capacity asks delegate. */
    maxConcurrent?: number;
    /** Whether the static danger stop-list runs before the model review. */
    preflight?: boolean;
    /** Replacement reviewer system prompt; the default rubric when omitted. */
    rubric?: string;
}
/** Loader schema with the product defaults. */
export declare const Config: z<Config>;
/** Config after the schema defaults; plain JSON, safe to freeze. */
export interface ResolvedConfig {
    presets: readonly string[];
    provider?: string;
    model?: string;
    maxInputBytes: number;
    maxOutputTokens: number;
    timeoutMs: number;
    maxConcurrent: number;
    preflight: boolean;
    rubric?: string;
}
/** Materialize schema defaults into one frozen policy object. */
export declare function resolveConfig(config: Config): ResolvedConfig;
/** The evidence one ask supplies: real tool arguments from the log plus the asker's reason. */
export interface OperationEvidence {
    /** The tool the ask is about. */
    toolName: string;
    /** Framed real operation text (command, path, arguments); empty when unavailable. */
    text: string;
    /** The asker's human-readable explanation; empty when unavailable. */
    reason: string;
}
/**
 * Recover the exact tool call behind one ask from the session log and frame
 * its arguments into bounded review text.
 * @param req - the pending approval request.
 * @returns the framed evidence; `text` stays empty for asks without a matching
 *   `tool/call` (hook permission asks).
 */
export declare function describeOperation(req: ApprovalRequest): OperationEvidence;
/**
 * Frame one tool call's raw arguments JSON into bounded, injection-safe text.
 * @param toolName - the tool that produced the call.
 * @param raw - the raw arguments JSON string exactly as the model produced it.
 * @returns the framed text: the command for bash, path (+ content head) for
 *   file tools, otherwise the bounded raw arguments.
 */
export declare function frameArguments(toolName: string, raw: string): string;
/**
 * The most recent direct user requests, bounded to `maxBytes` bytes total.
 * @param events - the session log in order.
 * @param maxBytes - hard byte budget for the joined text.
 * @returns up to two direct user messages in log order.
 */
export declare function userContext(events: readonly SessionEvent[], maxBytes: number): string;
/** One resolved reviewer route. */
export interface ReviewerRoute {
    provider: string;
    model: string;
}
/**
 * Resolve the reviewer's route: the explicit config pair, else the session's
 * most recent logged request route (the main conversation's provider/model).
 * @param config - the resolved reviewer policy.
 * @param events - the session log in order.
 * @returns the route, or undefined when nothing supplies one (delegates).
 */
export declare function resolveRoute(config: ResolvedConfig, events: readonly SessionEvent[]): ReviewerRoute | undefined;
/**
 * Parse the reviewer's raw text output into a closed verdict.
 * @param text - the raw joined text blocks.
 * @returns the normalized verdict.
 * @throws when the output is not a valid `allow`/`refer` object.
 */
export declare function parseVerdict(text: string): ReviewVerdict;
/**
 * Compose the reviewer: gate, prepended answerer, and the model-facing policy
 * sentence for sessions in the review preset.
 * @param ctx - context exposing the LLM service.
 * @param config - validated reviewer policy (schema defaults apply).
 */
export declare function apply(ctx: Context, config: Config): void;
