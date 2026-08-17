/**
 * Static danger stop-list matched against bash command text before the model
 * review runs. A hit delegates the ask (refer) without spending a model call.
 * @module @deepseek-ai/dsh-review-approval
 */

/** One static danger pattern. */
export interface DangerousPattern {
  /** Stable diagnostic id. */
  readonly id: string
  /** Matched against the reviewed bash command text. */
  readonly pattern: RegExp
}

/**
 * Deliberately narrow — one catastrophic shape per entry — because a false
 * positive only costs a human prompt, while a miss must still be caught by
 * the reviewer rubric. Preflight applies to `bash` asks only; file writes are
 * reviewed by the model over their real path and content head.
 */
export const DANGEROUS_PATTERNS: readonly DangerousPattern[] = [
  {
    id: 'rm-root',
    pattern: /\brm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\/\s|\/\*|\/$|~\s|~$)/,
  },
  {
    id: 'rm-system-dir',
    pattern: /\brm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(?:etc|usr|var|opt|bin|sbin|boot|dev|proc|sys|lib|lib64)(?:\/|\s|$)/,
  },
  {
    id: 'fork-bomb',
    pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  },
  {
    id: 'disk-device-write',
    pattern: /\b(?:dd|cat|cp)\b[^\n]*>\s*\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk|mmcblk|mapper)/,
  },
  {
    id: 'mkfs-device',
    pattern: /\bmkfs(?:\.[a-z0-9]+)?\s+\/dev\//,
  },
  {
    id: 'curl-sh',
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|dash|z)?sh\b/,
  },
  {
    id: 'eval-base64',
    pattern: /\beval\s+[^\n]*base64[^\n]*(?:-d|--decode)/,
  },
  {
    id: 'xargs-shell',
    pattern: /\bxargs\b[^\n]*(?:-0\s+)?(?:ba|dash|z)?sh\b/,
  },
  {
    id: 'secret-exfiltration',
    pattern: /\b(?:curl|wget|nc|netcat|ssh|scp)\b[^\n]*(?:\.env|id_rsa|\.ssh\/|\.aws\/credentials|\/etc\/shadow)[^\n]*\bhttps?:\/\//,
  },
  {
    id: 'chmod-system-777',
    pattern: /\bchmod\s+[^\n]*777[^\n]*\/(?:etc|usr|var|opt|bin|sbin|boot)/,
  },
  {
    id: 'sudo-rm',
    pattern: /\bsudo\s+(?:-\w+\s+)*rm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf]/,
  },
]
