/**
 * Local deterministic layers: the conservative whitelist (zero-token
 * fast-approval for structurally verifiable commands) and the blocklist
 * (zero-token interception of catastrophic shapes and sensitive paths).
 * @module deepseek-autoreview
 */

/** One config-shaped blocklist rule (YAML-safe: pattern is a string). */
export interface BlocklistRuleConfig {
  /** Stable diagnostic id recorded in verdicts and tests. */
  id: string
  /** Regular expression source, compiled at load. */
  pattern: string
  /** Tool names the rule applies to; omitted means every tool. */
  tools?: string[]
}

/** One compiled blocklist rule. */
export interface CompiledBlocklistRule {
  id: string
  pattern: RegExp
  tools?: readonly string[]
}

/** Backward-compatible alias of a compiled rule. */
export type DangerousPattern = CompiledBlocklistRule

/**
 * Deliberately narrow — one catastrophic shape per entry — because a false
 * positive only costs a human prompt (or a model call at worst), while a miss
 * must still be caught by the reviewer rubric.
 */
/** Default blocklist rule (tools always declared, matching the config schema). */
type BlocklistDefaultRule = Omit<BlocklistRuleConfig, 'tools'> & { tools: string[] }

export const DEFAULT_BLOCKLIST: readonly BlocklistDefaultRule[] = [
  { id: 'rm-root', pattern: '\\brm\\s+(?:-\\w+\\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\\s+(?:\\/\\s|\\/\\*|\\/$|~\\s|~$)', tools: ['bash'] },
  { id: 'rm-system-dir', pattern: '\\brm\\s+(?:-\\w+\\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\\s+\\/(?:etc|usr|var|opt|bin|sbin|boot|dev|proc|sys|lib|lib64)(?:\\/|\\s|$)', tools: ['bash'] },
  { id: 'fork-bomb', pattern: ':\\s*\\(\\s*\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:', tools: ['bash'] },
  { id: 'disk-device-write', pattern: '\\b(?:dd|cat|cp)\\b[^\\n]*>\\s*\\/dev\\/(?:sd[a-z]|nvme\\d+n\\d+|disk|mmcblk|mapper)', tools: ['bash'] },
  { id: 'mkfs-device', pattern: '\\bmkfs(?:\\.[a-z0-9]+)?\\s+\\/dev\\/', tools: ['bash'] },
  { id: 'curl-sh', pattern: '\\b(?:curl|wget)\\b[^\\n|]*\\|\\s*(?:ba|dash|z)?sh\\b', tools: ['bash'] },
  { id: 'eval-base64', pattern: '\\beval\\s+[^\\n]*base64[^\\n]*(?:-d|--decode)', tools: ['bash'] },
  { id: 'xargs-shell', pattern: '\\bxargs\\b[^\\n]*(?:-0\\s+)?(?:ba|dash|z)?sh\\b', tools: ['bash'] },
  { id: 'secret-exfiltration', pattern: '\\b(?:curl|wget|nc|netcat|ssh|scp)\\b[^\\n]*(?:\\.env|id_rsa|\\.ssh\\/|\\.aws\\/credentials|\\/etc\\/shadow)[^\\n]*\\bhttps?:\\/\\/', tools: ['bash'] },
  { id: 'chmod-system-777', pattern: '\\bchmod\\s+[^\\n]*777[^\\n]*\\/(?:etc|usr|var|opt|bin|sbin|boot)', tools: ['bash'] },
  { id: 'sudo-rm', pattern: '\\bsudo\\s+(?:-\\w+\\s+)*rm\\s+(?:-\\w+\\s+)*?-[a-zA-Z]*[rf]', tools: ['bash'] },
  { id: 'git-force-push', pattern: '\\bgit\\s+push\\b[^\\n]*(?:--force(?:-with-lease)?|-f)(?:\\s|$)', tools: ['bash'] },
  { id: 'crontab', pattern: '\\bcrontab\\b', tools: ['bash'] },
  { id: 'sensitive-path-etc', pattern: '^/etc(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-usr', pattern: '^/usr(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-boot', pattern: '^/boot(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-bin', pattern: '^/bin(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-sbin', pattern: '^/sbin(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-lib', pattern: '^/lib(?:32|64)?(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-opt', pattern: '^/opt(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-var', pattern: '^/var(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-proc', pattern: '^/proc(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-sys', pattern: '^/sys(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-root', pattern: '^/root(?:/|$)', tools: ['write', 'edit'] },
  { id: 'sensitive-path-dotfiles', pattern: '^(?:~|/home/[^/]+)/\\.(?:ssh|aws|gnupg)(?:/|$)', tools: ['write', 'edit'] },
  { id: 'parent-traversal', pattern: '(?:^|/)\\.\\.(?:/|$)', tools: ['write', 'edit'] },
]

/** Compile string-shaped rules into regexes at load time. */
export function compileBlocklist(rules: readonly BlocklistRuleConfig[]): readonly CompiledBlocklistRule[] {
  return rules.map(rule => ({
    id: rule.id,
    pattern: new RegExp(rule.pattern),
    ...rule.tools === undefined ? {} : { tools: rule.tools },
  }))
}

/** Backward-compatible compiled bash patterns (the pre-1.1 export). */
export const DANGEROUS_PATTERNS: readonly DangerousPattern[] = compileBlocklist(
  DEFAULT_BLOCKLIST.filter(rule => rule.tools === undefined || rule.tools.includes('bash')),
)

/** shell meta characters that disqualify a command from whitelist fast-approval. */
const FORBIDDEN_META = /[;&|<>$=\\`(){}]/

/** Default whitelist verbs (package managers and safe git subcommands). */
export const DEFAULT_WHITELIST_VERBS = ['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'poetry', 'cargo', 'git'] as const

/** Package-manager verbs and their safe install subcommands. */
const INSTALL_SUBCOMMANDS: Record<string, readonly string[]> = {
  npm: ['install', 'i', 'ci', 'add'],
  pnpm: ['install', 'i', 'add'],
  yarn: ['add', 'install'],
  pip: ['install'],
  pip3: ['install'],
  poetry: ['add', 'install'],
  cargo: ['add', 'install'],
}

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
export function whitelistHit(command: string, verbs: readonly string[] = DEFAULT_WHITELIST_VERBS): boolean {
  const trimmed = command.trim()
  if (trimmed === '' || FORBIDDEN_META.test(trimmed)) return false
  const head = /^([A-Za-z0-9-]+)\s+(\S+)/.exec(trimmed)
  if (head === null) return false
  const verb = head[1]
  const sub = head[2]
  if (!verbs.includes(verb)) return false
  if (verb === 'git') {
    if (sub !== 'clone' && sub !== 'pull' && sub !== 'fetch') return false
    if (sub !== 'clone') return true
    const rest = trimmed.slice(head[0].length).trim()
    if (rest === '') return false
    const last = rest.split(/\s+/).at(-1) ?? ''
    return !(last.startsWith('/') && !last.startsWith('/home/') && !last.startsWith('/tmp/'))
  }
  const allowed = INSTALL_SUBCOMMANDS[verb]
  return allowed !== undefined && allowed.includes(sub)
}

/**
 * Match one operation against the compiled blocklist.
 * @param rules - compiled rules in declaration order.
 * @param op - the framed evidence of the pending operation.
 * @returns the id of the first matching rule, or undefined.
 */
export function blocklistHit(
  rules: readonly CompiledBlocklistRule[],
  op: { toolName: string; text: string; filePath?: string },
): string | undefined {
  for (const rule of rules) {
    if (rule.tools !== undefined && !rule.tools.includes(op.toolName)) continue
    const fileRule = rule.tools !== undefined && rule.tools.every(tool => tool === 'write' || tool === 'edit')
    const target = fileRule ? (op.filePath ?? op.text) : op.text
    if (rule.pattern.test(target)) return rule.id
  }
  return undefined
}
