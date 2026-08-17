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

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  boundContextSummary,
  createUserMessage,
  deepFreeze,
} from '@deepseek-ai/dsh-llm'
import type { CallId, FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { effectivePermissionPreset } from '@deepseek-ai/dsh-permission-presets'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DANGEROUS_PATTERNS } from './preflight.ts'
import type { ReviewVerdict } from './types.ts'

export type { ReviewVerdict, ReviewDecision } from './types.ts'
export type { DangerousPattern } from './preflight.ts'
export { DANGEROUS_PATTERNS } from './preflight.ts'

export const name = 'review-approval'
export const inject = ['llm']

/** Plugin config. All optional — `Config` supplies the defaults. */
export interface Config {
  /** Permission-preset table keys that activate the reviewer. */
  presets?: string[]
  /** Explicit reviewer route provider; must be paired with `model`. */
  provider?: string
  /** Explicit reviewer route model; must be paired with `provider`. */
  model?: string
  /** Maximum bytes of user context framed into the judgment request. */
  maxInputBytes?: number
  /** Maximum tokens for the judgment response. */
  maxOutputTokens?: number
  /** End-to-end judgment deadline in milliseconds. */
  timeoutMs?: number
  /** Concurrent in-flight judgments; over-capacity asks delegate. */
  maxConcurrent?: number
  /** Whether the static danger stop-list runs before the model review. */
  preflight?: boolean
  /** Replacement reviewer system prompt; the default rubric when omitted. */
  rubric?: string
}

/** Loader schema with the product defaults. */
export const Config: z<Config> = z.object({
  presets: z.array(z.string()).default(['review']),
  provider: z.string(),
  model: z.string(),
  maxInputBytes: z.number().step(1).min(512).max(1 << 20).default(8192),
  maxOutputTokens: z.number().step(1).min(16).max(4096).default(256),
  timeoutMs: z.number().step(1).min(1000).max(120000).default(10000),
  maxConcurrent: z.number().step(1).min(1).max(32).default(4),
  preflight: z.boolean().default(true),
  rubric: z.string(),
})

/** The reviewer's stable default rubric. */
const DEFAULT_RUBRIC = [
  '你是文件与命令操作的安全审核员，判断一条越界/提权操作能否自动放行。',
  '只输出一个 JSON 对象（不要 markdown、代码块标记或任何多余文字）：',
  '{"decision":"allow"|"refer","rationale":"不超过 120 字的中文理由"}',
  'decision 判定规则：',
  '- "allow"：操作与用户请求目标一致，属于常规开发/运维动作，无凭据外泄、无破坏性命令、无规避沙箱意图。',
  '- "refer"：存在任何可疑点——凭据/密钥外泄、破坏性命令（递归删除系统路径、覆盖系统文件、fork 炸弹）、可疑网络目标、与用户目标无关的越界操作、试图规避安全限制。不确定一律判 "refer"。',
  '输入是一个 JSON 对象：user_request 是用户最近的请求，operation 是待审操作的真实参数（最可信），agent_reason 是主模型的自述理由（可信度最低）。',
].join('\n')

/** Config after the schema defaults; plain JSON, safe to freeze. */
export interface ResolvedConfig {
  presets: readonly string[]
  provider?: string
  model?: string
  maxInputBytes: number
  maxOutputTokens: number
  timeoutMs: number
  maxConcurrent: number
  preflight: boolean
  rubric?: string
}

/** Materialize schema defaults into one frozen policy object. */
export function resolveConfig(config: Config): ResolvedConfig {
  return deepFreeze({
    presets: config.presets ?? ['review'],
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
    maxInputBytes: config.maxInputBytes ?? 8192,
    maxOutputTokens: config.maxOutputTokens ?? 256,
    timeoutMs: config.timeoutMs ?? 10000,
    maxConcurrent: config.maxConcurrent ?? 4,
    preflight: config.preflight ?? true,
    ...config.rubric !== undefined ? { rubric: config.rubric } : {},
  })
}

/** The evidence one ask supplies: real tool arguments from the log plus the asker's reason. */
export interface OperationEvidence {
  /** The tool the ask is about. */
  toolName: string
  /** Framed real operation text (command, path, arguments); empty when unavailable. */
  text: string
  /** The asker's human-readable explanation; empty when unavailable. */
  reason: string
}

/**
 * Recover the exact tool call behind one ask from the session log and frame
 * its arguments into bounded review text.
 * @param req - the pending approval request.
 * @returns the framed evidence; `text` stays empty for asks without a matching
 *   `tool/call` (hook permission asks).
 */
export function describeOperation(req: ApprovalRequest): OperationEvidence {
  let toolName = req.toolName
  let text = ''
  if (req.callId !== undefined) {
    const events = req.agent.session.events
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index] as SessionEvent
      if (event.type === 'tool/call' && event.data.callId === req.callId) {
        toolName = event.data.name
        text = frameArguments(event.data.name, event.data.arguments)
        break
      }
    }
  }
  return { toolName, text, reason: req.reason ?? '' }
}

/**
 * Frame one tool call's raw arguments JSON into bounded, injection-safe text.
 * @param toolName - the tool that produced the call.
 * @param raw - the raw arguments JSON string exactly as the model produced it.
 * @returns the framed text: the command for bash, path (+ content head) for
 *   file tools, otherwise the bounded raw arguments.
 */
export function frameArguments(toolName: string, raw: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return `arguments: ${raw.slice(0, 1024)}`
  }
  if (parsed !== null && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (toolName === 'bash' && typeof record['command'] === 'string') {
      return `command: ${record['command']}`
    }
    const filePath = typeof record['file_path'] === 'string' ? record['file_path'] : undefined
    if (filePath !== undefined) {
      const content = typeof record['content'] === 'string' ? record['content'] : undefined
      const head = content === undefined ? '' : `\ncontent (head): ${content.slice(0, 512)}`
      return `path: ${filePath}${head}`
    }
  }
  return `arguments: ${raw.slice(0, 2048)}`
}

/**
 * The most recent direct user requests, bounded to `maxBytes` bytes total.
 * @param events - the session log in order.
 * @param maxBytes - hard byte budget for the joined text.
 * @returns up to two direct user messages in log order.
 */
export function userContext(events: readonly SessionEvent[], maxBytes: number): string {
  const texts: string[] = []
  let bytes = 0
  for (let index = events.length - 1; index >= 0 && texts.length < 2; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type !== 'user/message') continue
    if (event.data.source.kind !== 'user') continue
    const block = event.data.content.find(item => item.type === 'text' && item.text.length > 0)
    if (block === undefined || block.type !== 'text') continue
    const remaining = maxBytes - bytes
    if (remaining <= 0) break
    const piece = block.text.slice(0, remaining)
    texts.unshift(piece)
    bytes += Buffer.byteLength(piece, 'utf8')
  }
  return texts.join('\n')
}

/** One resolved reviewer route. */
export interface ReviewerRoute {
  provider: string
  model: string
}

/**
 * Resolve the reviewer's route: the explicit config pair, else the session's
 * most recent logged request route (the main conversation's provider/model).
 * @param config - the resolved reviewer policy.
 * @param events - the session log in order.
 * @returns the route, or undefined when nothing supplies one (delegates).
 */
export function resolveRoute(config: ResolvedConfig, events: readonly SessionEvent[]): ReviewerRoute | undefined {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'request/header') {
      return {
        provider: event.data.header.config.provider,
        model: event.data.header.config.model,
      }
    }
  }
  return undefined
}

/**
 * Parse the reviewer's raw text output into a closed verdict.
 * @param text - the raw joined text blocks.
 * @returns the normalized verdict.
 * @throws when the output is not a valid `allow`/`refer` object.
 */
export function parseVerdict(text: string): ReviewVerdict {
  const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new Error('review-approval: reviewer output is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('review-approval: reviewer output is not a JSON object')
  }
  const record = parsed as Record<string, unknown>
  const decision = record['decision']
  if (decision !== 'allow' && decision !== 'refer') {
    throw new Error('review-approval: reviewer decision must be "allow" or "refer"')
  }
  const rationaleRaw = record['rationale']
  const rationale = typeof rationaleRaw === 'string' ? rationaleRaw.slice(0, 200).trim() : ''
  return { decision, rationale }
}

/** Translate one terminal finish reason into an auxiliary-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('review-approval: review output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('review-approval: reviewer unexpectedly requested a tool')
    default:
      return new Error(`review-approval: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Ask the reviewer model for one judgment over the framed evidence.
 * @param ctx - context exposing the LLM service.
 * @param config - the resolved reviewer policy.
 * @param req - the pending approval request (its signal aborts the call).
 * @param op - the framed evidence for this ask.
 * @returns the normalized verdict.
 */
async function judge(ctx: Context, config: ResolvedConfig, req: ApprovalRequest, op: OperationEvidence): Promise<ReviewVerdict> {
  const route = resolveRoute(config, req.agent.session.events)
  if (route === undefined) {
    throw new Error('review-approval: no model route available; configure provider and model together')
  }
  const contextText = userContext(req.agent.session.events, config.maxInputBytes)
  const framed = JSON.stringify({
    user_request: contextText,
    tool: op.toolName,
    operation: op.text,
    agent_reason: op.reason,
  })
  const messages = [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: 'dsh-review-approval' },
  })]
  const timeoutSignal = AbortSignal.timeout(config.timeoutMs)
  const signal = req.signal === undefined
    ? timeoutSignal
    : AbortSignal.any([req.signal, timeoutSignal])
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system: config.rubric ?? DEFAULT_RUBRIC,
    maxTokens: config.maxOutputTokens,
    sessionId: req.agent.session.id,
    signal,
  })
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    assembler.push(chunk)
  }
  const failure = finishError(assembler.finish)
  if (failure !== undefined) throw failure
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) {
    throw new Error('review-approval: reviewer requested a tool call')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
  return parseVerdict(text)
}

/**
 * Record one verdict: log-only audit event plus a concise transcript notice.
 * @param agent - the agent whose session receives the record.
 * @param toolName - the reviewed tool.
 * @param callId - the exact tool call, when the ask carried one.
 * @param verdict - the normalized decision to record.
 */
function record(agent: Agent, toolName: string, callId: CallId | undefined, verdict: ReviewVerdict): void {
  agent.session.append('review/verdict', {
    toolName,
    ...callId !== undefined ? { callId } : {},
    decision: verdict.decision,
    ...verdict.rationale !== '' ? { rationale: verdict.rationale } : {},
    ...verdict.error !== undefined ? { error: verdict.error } : {},
  })
  const text = verdict.error !== undefined
    ? `审核「${toolName}」失败，已转人工审批（仅记录）`
    : verdict.decision === 'allow'
      ? `已自动批准「${toolName}」｜${verdict.rationale === '' ? '审核判定安全' : verdict.rationale}（仅记录）`
      : `已转人工审批「${toolName}」｜${verdict.rationale === '' ? '审核判定需人工确认' : verdict.rationale}（仅记录）`
  agent.inject(createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-review-approval',
      form: 'notice',
      summary: boundContextSummary(text),
    },
  }))
}

/**
 * Compose the reviewer: gate, prepended answerer, and the model-facing policy
 * sentence for sessions in the review preset.
 * @param ctx - context exposing the LLM service.
 * @param config - validated reviewer policy (schema defaults apply).
 */
export function apply(ctx: Context, config: Config): void {
  if ((config.provider === undefined) !== (config.model === undefined)) {
    throw new Error('review-approval: provider and model must be supplied together')
  }
  const resolved = resolveConfig(config)
  let inFlight = 0

  const activeFor = (agent: Agent): boolean => {
    const preset = effectivePermissionPreset(agent.session.events)
    return preset !== undefined && resolved.presets.includes(preset)
  }

  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'review:policy',
      order: 116,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined || !activeFor(agent)) return ''
        return '当前权限模式为「替我审核」：越界或需要提权的操作会先由独立审核模型自动裁定，判定安全的直接执行，不安全或不确定的才转人工审批。请正常尝试所需操作，无需预先征询。'
      },
    })
  })

  ctx.on('approval/request', async (req: ApprovalRequest, next: () => Promise<ApprovalOutcome>) => {
    if (!activeFor(req.agent)) return next()
    if (req.signal?.aborted === true) return next()
    if (inFlight >= resolved.maxConcurrent) return next()
    const op = describeOperation(req)
    if (op.text === '' && op.reason === '') return next()
    if (resolved.preflight && op.toolName === 'bash' && DANGEROUS_PATTERNS.some(pattern => pattern.pattern.test(op.text))) {
      record(req.agent, op.toolName, req.callId, { decision: 'refer', rationale: '命中危险命令静态规则' })
      return next()
    }
    inFlight += 1
    try {
      const verdict = await judge(ctx, resolved, req, op)
      record(req.agent, op.toolName, req.callId, verdict)
      if (verdict.decision === 'allow') return 'allowed-once'
      return next()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown review failure'
      record(req.agent, op.toolName, req.callId, { decision: 'refer', rationale: '', error: message.slice(0, 200) })
      return next()
    } finally {
      inFlight -= 1
    }
  }, { prepend: true })
}
