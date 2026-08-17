/**
 * Model-backed permission reviewer: the "review on my behalf" preset.
 *
 * Registers a PREPENDED `approval/request` answerer that claims asks only for
 * sessions whose selected permission preset names this plugin (default table
 * key `review`). Decisions run through a three-tier funnel:
 *
 * 1. deterministic whitelist — structurally verifiable commands (package
 *    managers, safe git subcommands) auto-approve with zero tokens;
 * 2. deterministic blocklist — catastrophic shapes and sensitive paths
 *    intercept with zero tokens (`refer`, or `deny` under `staticDeny`);
 * 3. model judgment — the gray zone is judged by one auxiliary model call
 *    over the real tool arguments recovered from the session log, the current
 *    turn's user request, and the asker's self-reported reason.
 *
 * `allow` auto-approves; `refer` delegates to the next answerer (the human
 * approval channel); `deny` returns the closed `rejected` outcome. Failures,
 * timeouts, and invalid outputs always delegate — the seam stays fail-closed.
 * Auto-approvals are rate-limited per session (minute/hour budgets) to bound
 * escalation storms. The reviewer route is user-switchable at runtime through
 * the `autoreview` settings namespace (`session` follows the main model route;
 * `fixed` pins provider/model, validated against the LLM catalog with
 * fallback). Every decision appends a log-only `review/verdict` audit event
 * and injects a concise transcript notice.
 *
 * @module deepseek-autoreview
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import type { BlocklistRuleConfig, CompiledBlocklistRule } from './preflight.ts';
import type { ReviewSettings } from './settings-shared.ts';
import type { ReviewVerdict } from './types.ts';
export type { ReviewVerdict, ReviewDecision, ReviewSource } from './types.ts';
export type { DangerousPattern, BlocklistRuleConfig, CompiledBlocklistRule } from './preflight.ts';
export { DANGEROUS_PATTERNS, DEFAULT_BLOCKLIST, DEFAULT_WHITELIST_VERBS, blocklistHit, compileBlocklist, whitelistHit } from './preflight.ts';
export type { ReviewSettings, ReviewRouteMode } from './settings-shared.ts';
export { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_NAMESPACE } from './settings-shared.ts';
export declare const name = "deepseek-autoreview";
export declare const inject: string[];
/** Plugin config. All optional — `Config` supplies the defaults. */
export interface Config {
    /** Permission-preset table keys that activate the reviewer. */
    presets?: string[];
    /** Explicit reviewer route provider (composition-level); pair with `model`. */
    provider?: string;
    /** Explicit reviewer route model (composition-level); pair with `provider`. */
    model?: string;
    /** Byte budget for the current-turn user context in the judgment request. */
    maxInputBytes?: number;
    /** Maximum tokens for the judgment response. */
    maxOutputTokens?: number;
    /** End-to-end judgment deadline in milliseconds. */
    timeoutMs?: number;
    /** Concurrent in-flight judgments; over-capacity asks delegate. */
    maxConcurrent?: number;
    /** Whether the deterministic blocklist runs before the model review. */
    preflight?: boolean;
    /** Whether the deterministic whitelist fast-approves verifiable commands. */
    whitelist?: boolean;
    /** Whitelisted command verbs (see {@link DEFAULT_WHITELIST_VERBS}). */
    whitelistVerbs?: string[];
    /** Blocklist rules (string patterns compiled at load; see {@link DEFAULT_BLOCKLIST}). */
    blocklist?: BlocklistRuleConfig[];
    /** Blocklist hits reject (`deny`) instead of delegating (`refer`). */
    staticDeny?: boolean;
    /** Whether the model may decide `deny` (obviously malicious asks). */
    deny?: boolean;
    /** Auto-approval budget per session per minute; over-budget asks delegate. */
    maxAutoPerMinute?: number;
    /** Auto-approval budget per session per hour; over-budget asks delegate. */
    maxAutoPerHour?: number;
    /** Retry transient transport failures (rate limits, network) once. */
    retryTransient?: boolean;
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
    whitelist: boolean;
    whitelistVerbs: readonly string[];
    blocklist: readonly CompiledBlocklistRule[];
    staticDeny: boolean;
    deny: boolean;
    maxAutoPerMinute: number;
    maxAutoPerHour: number;
    retryTransient: boolean;
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
    /** Raw bash command, when the call is a bash one. */
    command?: string;
    /** Raw target path for write/edit calls. */
    filePath?: string;
    /** The asker's human-readable explanation; empty when unavailable. */
    reason: string;
}
/** Structured fields parsed out of a tool call's raw arguments JSON. */
export interface ParsedToolArguments {
    command?: string;
    filePath?: string;
}
/** Parse the structured fields a review needs from raw tool arguments. */
export declare function parseToolArguments(raw: string): ParsedToolArguments;
/**
 * Recover the exact tool call behind one ask from the session log and frame
 * its arguments into bounded review evidence.
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
 * Direct user messages inside the current (open) turn, bounded to `maxBytes`.
 * Historical turns no longer contribute: the judgment concerns the task at
 * hand, and dropping older context both saves tokens and shrinks the
 * injection surface.
 * @param events - the session log in order.
 * @param maxBytes - hard byte budget for the joined text.
 * @returns the current turn's direct user messages in log order.
 */
export declare function userContext(events: readonly SessionEvent[], maxBytes: number): string;
/** One resolved reviewer route. */
export interface ResolvedReviewRoute {
    provider: string;
    model: string;
    source: 'settings' | 'config' | 'session';
    /** A pinned settings route failed validation; a fallback route ran. */
    routeFallback?: boolean;
}
/** Incremental session-route cache: rescans only events after the last visit. */
export interface SessionRouteCache {
    eventsRef?: readonly SessionEvent[];
    index: number;
    route?: {
        provider: string;
        model: string;
    };
}
/** Resolve the session's most recent logged request route, incrementally. */
export declare function resolveSessionRoute(events: readonly SessionEvent[], cache: SessionRouteCache): {
    provider: string;
    model: string;
} | undefined;
/** Whether the LLM catalog resolves one exact route. */
export declare function modelExists(ctx: Context, provider: string, model: string): Promise<boolean>;
/**
 * Resolve the reviewer's route: the pinned settings route (validated against
 * the catalog, with fallback), else the composition config pair, else the
 * session's most recent logged request route.
 * @param ctx - context exposing the LLM catalog.
 * @param resolved - the resolved reviewer policy.
 * @param settingsSource - thunk returning the current settings value.
 * @param events - the session log in order.
 * @param cache - the incremental session-route cache.
 * @returns the route, or undefined when nothing supplies one (delegates).
 */
export declare function resolveReviewRoute(ctx: Context, resolved: ResolvedConfig, settingsSource: () => ReviewSettings, events: readonly SessionEvent[], cache: SessionRouteCache): Promise<ResolvedReviewRoute | undefined>;
/**
 * Parse the reviewer's raw text output into a closed verdict.
 * @param text - the raw joined text blocks.
 * @returns the normalized verdict.
 * @throws when the output is not a valid `allow`/`refer`/`deny` object.
 */
export declare function parseVerdict(text: string): ReviewVerdict;
/** Per-session sliding-window auto-approval budget. */
export interface AutoApproveBudget {
    overBudget(session: object): boolean;
    recordAllow(session: object): void;
}
/** Create the per-session rate limiter for auto-approvals. */
export declare function createAutoApproveBudget(resolved: ResolvedConfig): AutoApproveBudget;
/**
 * Compose the reviewer: gate, deterministic funnel, throttled prepended
 * answerer, the model-facing policy sentence, and the user-switchable route
 * settings section.
 * @param ctx - context exposing the LLM service.
 * @param config - validated reviewer policy (schema defaults apply).
 */
export declare function apply(ctx: Context, config: Config): void;
