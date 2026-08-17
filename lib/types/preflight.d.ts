/**
 * Local deterministic layers: the conservative whitelist (zero-token
 * fast-approval for structurally verifiable commands) and the blocklist
 * (zero-token interception of catastrophic shapes and sensitive paths).
 * @module deepseek-autoreview
 */
/** One config-shaped blocklist rule (YAML-safe: pattern is a string). */
export interface BlocklistRuleConfig {
    /** Stable diagnostic id recorded in verdicts and tests. */
    id: string;
    /** Regular expression source, compiled at load. */
    pattern: string;
    /** Tool names the rule applies to; omitted means every tool. */
    tools?: string[];
}
/** One compiled blocklist rule. */
export interface CompiledBlocklistRule {
    id: string;
    pattern: RegExp;
    tools?: readonly string[];
}
/** Backward-compatible alias of a compiled rule. */
export type DangerousPattern = CompiledBlocklistRule;
/**
 * Deliberately narrow — one catastrophic shape per entry — because a false
 * positive only costs a human prompt (or a model call at worst), while a miss
 * must still be caught by the reviewer rubric.
 */
/** Default blocklist rule (tools always declared, matching the config schema). */
type BlocklistDefaultRule = Omit<BlocklistRuleConfig, 'tools'> & {
    tools: string[];
};
export declare const DEFAULT_BLOCKLIST: readonly BlocklistDefaultRule[];
/** Compile string-shaped rules into regexes at load time. */
export declare function compileBlocklist(rules: readonly BlocklistRuleConfig[]): readonly CompiledBlocklistRule[];
/** Backward-compatible compiled bash patterns (the pre-1.1 export). */
export declare const DANGEROUS_PATTERNS: readonly DangerousPattern[];
/** Default whitelist verbs (package managers and safe git subcommands). */
export declare const DEFAULT_WHITELIST_VERBS: readonly ["npm", "pnpm", "yarn", "pip", "pip3", "poetry", "cargo", "git"];
/**
 * Whether a bash command qualifies for zero-token fast approval. The shape
 * must be structurally verifiable: one whitelisted verb, and no shell
 * metacharacters anywhere (no `;`, `|`, `&`, redirects, substitutions,
 * braces, or `=`), so a composite or obfuscated command can never ride the
 * whitelist. `git clone` destinations must stay relative or under the home
 * and temporary roots.
 * @param command - the exact command text from the tool call.
 * @param verbs - whitelisted verbs (defaults to {@link DEFAULT_WHITELIST_VERBS}).
 * @returns true when the command may be fast-approved without a model call.
 */
export declare function whitelistHit(command: string, verbs?: readonly string[]): boolean;
/**
 * Match one operation against the compiled blocklist.
 * @param rules - compiled rules in declaration order.
 * @param op - the framed evidence of the pending operation.
 * @returns the id of the first matching rule, or undefined.
 */
export declare function blocklistHit(rules: readonly CompiledBlocklistRule[], op: {
    toolName: string;
    text: string;
    filePath?: string;
}): string | undefined;
export {};
