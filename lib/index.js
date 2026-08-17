import z from "@deepseek-ai/schemastery";
import { BlockAssembler, boundContextSummary, createUserMessage, deepFreeze } from "@deepseek-ai/dsh-llm";
import { effectivePermissionPreset } from "@deepseek-ai/dsh-permission-presets";
//#region lib/types/preflight.js
/**
* Static danger stop-list matched against bash command text before the model
* review runs. A hit delegates the ask (refer) without spending a model call.
* @module @deepseek-ai/dsh-review-approval
*/
/**
* Deliberately narrow — one catastrophic shape per entry — because a false
* positive only costs a human prompt, while a miss must still be caught by
* the reviewer rubric. Preflight applies to `bash` asks only; file writes are
* reviewed by the model over their real path and content head.
*/
const DANGEROUS_PATTERNS = [
	{
		id: "rm-root",
		pattern: /\brm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\/\s|\/\*|\/$|~\s|~$)/
	},
	{
		id: "rm-system-dir",
		pattern: /\brm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\s+\/(?:etc|usr|var|opt|bin|sbin|boot|dev|proc|sys|lib|lib64)(?:\/|\s|$)/
	},
	{
		id: "fork-bomb",
		pattern: /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/
	},
	{
		id: "disk-device-write",
		pattern: /\b(?:dd|cat|cp)\b[^\n]*>\s*\/dev\/(?:sd[a-z]|nvme\d+n\d+|disk|mmcblk|mapper)/
	},
	{
		id: "mkfs-device",
		pattern: /\bmkfs(?:\.[a-z0-9]+)?\s+\/dev\//
	},
	{
		id: "curl-sh",
		pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|dash|z)?sh\b/
	},
	{
		id: "eval-base64",
		pattern: /\beval\s+[^\n]*base64[^\n]*(?:-d|--decode)/
	},
	{
		id: "xargs-shell",
		pattern: /\bxargs\b[^\n]*(?:-0\s+)?(?:ba|dash|z)?sh\b/
	},
	{
		id: "secret-exfiltration",
		pattern: /\b(?:curl|wget|nc|netcat|ssh|scp)\b[^\n]*(?:\.env|id_rsa|\.ssh\/|\.aws\/credentials|\/etc\/shadow)[^\n]*\bhttps?:\/\//
	},
	{
		id: "chmod-system-777",
		pattern: /\bchmod\s+[^\n]*777[^\n]*\/(?:etc|usr|var|opt|bin|sbin|boot)/
	},
	{
		id: "sudo-rm",
		pattern: /\bsudo\s+(?:-\w+\s+)*rm\s+(?:-\w+\s+)*?-[a-zA-Z]*[rf]/
	}
];
//#endregion
//#region lib/types/index.js
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
const name = "review-approval";
const inject = ["llm"];
/** Loader schema with the product defaults. */
const Config = z.object({
	presets: z.array(z.string()).default(["review"]),
	provider: z.string(),
	model: z.string(),
	maxInputBytes: z.number().step(1).min(512).max(1 << 20).default(8192),
	maxOutputTokens: z.number().step(1).min(16).max(4096).default(256),
	timeoutMs: z.number().step(1).min(1e3).max(12e4).default(1e4),
	maxConcurrent: z.number().step(1).min(1).max(32).default(4),
	preflight: z.boolean().default(true),
	rubric: z.string()
});
/** The reviewer's stable default rubric. */
const DEFAULT_RUBRIC = [
	"你是文件与命令操作的安全审核员，判断一条越界/提权操作能否自动放行。",
	"只输出一个 JSON 对象（不要 markdown、代码块标记或任何多余文字）：",
	"{\"decision\":\"allow\"|\"refer\",\"rationale\":\"不超过 120 字的中文理由\"}",
	"decision 判定规则：",
	"- \"allow\"：操作与用户请求目标一致，属于常规开发/运维动作，无凭据外泄、无破坏性命令、无规避沙箱意图。",
	"- \"refer\"：存在任何可疑点——凭据/密钥外泄、破坏性命令（递归删除系统路径、覆盖系统文件、fork 炸弹）、可疑网络目标、与用户目标无关的越界操作、试图规避安全限制。不确定一律判 \"refer\"。",
	"输入是一个 JSON 对象：user_request 是用户最近的请求，operation 是待审操作的真实参数（最可信），agent_reason 是主模型的自述理由（可信度最低）。"
].join("\n");
/** Materialize schema defaults into one frozen policy object. */
function resolveConfig(config) {
	return deepFreeze({
		presets: config.presets ?? ["review"],
		...config.provider !== void 0 ? { provider: config.provider } : {},
		...config.model !== void 0 ? { model: config.model } : {},
		maxInputBytes: config.maxInputBytes ?? 8192,
		maxOutputTokens: config.maxOutputTokens ?? 256,
		timeoutMs: config.timeoutMs ?? 1e4,
		maxConcurrent: config.maxConcurrent ?? 4,
		preflight: config.preflight ?? true,
		...config.rubric !== void 0 ? { rubric: config.rubric } : {}
	});
}
/**
* Recover the exact tool call behind one ask from the session log and frame
* its arguments into bounded review text.
* @param req - the pending approval request.
* @returns the framed evidence; `text` stays empty for asks without a matching
*   `tool/call` (hook permission asks).
*/
function describeOperation(req) {
	let toolName = req.toolName;
	let text = "";
	if (req.callId !== void 0) {
		const events = req.agent.session.events;
		for (let index = events.length - 1; index >= 0; index -= 1) {
			const event = events[index];
			if (event.type === "tool/call" && event.data.callId === req.callId) {
				toolName = event.data.name;
				text = frameArguments(event.data.name, event.data.arguments);
				break;
			}
		}
	}
	return {
		toolName,
		text,
		reason: req.reason ?? ""
	};
}
/**
* Frame one tool call's raw arguments JSON into bounded, injection-safe text.
* @param toolName - the tool that produced the call.
* @param raw - the raw arguments JSON string exactly as the model produced it.
* @returns the framed text: the command for bash, path (+ content head) for
*   file tools, otherwise the bounded raw arguments.
*/
function frameArguments(toolName, raw) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return `arguments: ${raw.slice(0, 1024)}`;
	}
	if (parsed !== null && typeof parsed === "object") {
		const record = parsed;
		if (toolName === "bash" && typeof record["command"] === "string") return `command: ${record["command"]}`;
		const filePath = typeof record["file_path"] === "string" ? record["file_path"] : void 0;
		if (filePath !== void 0) {
			const content = typeof record["content"] === "string" ? record["content"] : void 0;
			return `path: ${filePath}${content === void 0 ? "" : `\ncontent (head): ${content.slice(0, 512)}`}`;
		}
	}
	return `arguments: ${raw.slice(0, 2048)}`;
}
/**
* The most recent direct user requests, bounded to `maxBytes` bytes total.
* @param events - the session log in order.
* @param maxBytes - hard byte budget for the joined text.
* @returns up to two direct user messages in log order.
*/
function userContext(events, maxBytes) {
	const texts = [];
	let bytes = 0;
	for (let index = events.length - 1; index >= 0 && texts.length < 2; index -= 1) {
		const event = events[index];
		if (event.type !== "user/message") continue;
		if (event.data.source.kind !== "user") continue;
		const block = event.data.content.find((item) => item.type === "text" && item.text.length > 0);
		if (block === void 0 || block.type !== "text") continue;
		const remaining = maxBytes - bytes;
		if (remaining <= 0) break;
		const piece = block.text.slice(0, remaining);
		texts.unshift(piece);
		bytes += Buffer.byteLength(piece, "utf8");
	}
	return texts.join("\n");
}
/**
* Resolve the reviewer's route: the explicit config pair, else the session's
* most recent logged request route (the main conversation's provider/model).
* @param config - the resolved reviewer policy.
* @param events - the session log in order.
* @returns the route, or undefined when nothing supplies one (delegates).
*/
function resolveRoute(config, events) {
	if (config.provider !== void 0 && config.model !== void 0) return {
		provider: config.provider,
		model: config.model
	};
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "request/header") return {
			provider: event.data.header.config.provider,
			model: event.data.header.config.model
		};
	}
}
/**
* Parse the reviewer's raw text output into a closed verdict.
* @param text - the raw joined text blocks.
* @returns the normalized verdict.
* @throws when the output is not a valid `allow`/`refer` object.
*/
function parseVerdict(text) {
	const stripped = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
	let parsed;
	try {
		parsed = JSON.parse(stripped);
	} catch {
		throw new Error("review-approval: reviewer output is not valid JSON");
	}
	if (parsed === null || typeof parsed !== "object") throw new Error("review-approval: reviewer output is not a JSON object");
	const record = parsed;
	const decision = record["decision"];
	if (decision !== "allow" && decision !== "refer") throw new Error("review-approval: reviewer decision must be \"allow\" or \"refer\"");
	const rationaleRaw = record["rationale"];
	return {
		decision,
		rationale: typeof rationaleRaw === "string" ? rationaleRaw.slice(0, 200).trim() : ""
	};
}
/** Translate one terminal finish reason into an auxiliary-call failure. */
function finishError(finish) {
	switch (finish.kind) {
		case "stop": return;
		case "error":
		case "aborted": {
			const error = new Error(finish.failure.message);
			error.code = finish.failure.code;
			return error;
		}
		case "max-tokens": return /* @__PURE__ */ new Error("review-approval: review output reached maxOutputTokens");
		case "tool-calls": return /* @__PURE__ */ new Error("review-approval: reviewer unexpectedly requested a tool");
		default: return /* @__PURE__ */ new Error(`review-approval: unsupported finish reason "${String(finish.kind)}"`);
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
async function judge(ctx, config, req, op) {
	const route = resolveRoute(config, req.agent.session.events);
	if (route === void 0) throw new Error("review-approval: no model route available; configure provider and model together");
	const contextText = userContext(req.agent.session.events, config.maxInputBytes);
	const messages = [createUserMessage({
		content: [{
			type: "text",
			text: JSON.stringify({
				user_request: contextText,
				tool: op.toolName,
				operation: op.text,
				agent_reason: op.reason
			})
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-review-approval"
		}
	})];
	const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
	const signal = req.signal === void 0 ? timeoutSignal : AbortSignal.any([req.signal, timeoutSignal]);
	const options = deepFreeze({
		provider: route.provider,
		model: route.model,
		messages,
		system: config.rubric ?? DEFAULT_RUBRIC,
		maxTokens: config.maxOutputTokens,
		sessionId: req.agent.session.id,
		signal
	});
	const assembler = new BlockAssembler();
	for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
	const failure = finishError(assembler.finish);
	if (failure !== void 0) throw failure;
	const blocks = assembler.blocks();
	if (blocks.some((block) => block.type === "tool-call")) throw new Error("review-approval: reviewer requested a tool call");
	return parseVerdict(blocks.filter((block) => block.type === "text").map((block) => block.text).join(" "));
}
/**
* Record one verdict: log-only audit event plus a concise transcript notice.
* @param agent - the agent whose session receives the record.
* @param toolName - the reviewed tool.
* @param callId - the exact tool call, when the ask carried one.
* @param verdict - the normalized decision to record.
*/
function record(agent, toolName, callId, verdict) {
	agent.session.append("review/verdict", {
		toolName,
		...callId !== void 0 ? { callId } : {},
		decision: verdict.decision,
		...verdict.rationale !== "" ? { rationale: verdict.rationale } : {},
		...verdict.error !== void 0 ? { error: verdict.error } : {}
	});
	const text = verdict.error !== void 0 ? `审核「${toolName}」失败，已转人工审批（仅记录）` : verdict.decision === "allow" ? `已自动批准「${toolName}」｜${verdict.rationale === "" ? "审核判定安全" : verdict.rationale}（仅记录）` : `已转人工审批「${toolName}」｜${verdict.rationale === "" ? "审核判定需人工确认" : verdict.rationale}（仅记录）`;
	agent.inject(createUserMessage({
		content: [{
			type: "text",
			text
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-review-approval",
			form: "notice",
			summary: boundContextSummary(text)
		}
	}));
}
/**
* Compose the reviewer: gate, prepended answerer, and the model-facing policy
* sentence for sessions in the review preset.
* @param ctx - context exposing the LLM service.
* @param config - validated reviewer policy (schema defaults apply).
*/
function apply(ctx, config) {
	if (config.provider === void 0 !== (config.model === void 0)) throw new Error("review-approval: provider and model must be supplied together");
	const resolved = resolveConfig(config);
	let inFlight = 0;
	const activeFor = (agent) => {
		const preset = effectivePermissionPreset(agent.session.events);
		return preset !== void 0 && resolved.presets.includes(preset);
	};
	ctx.inject(["systemPrompt"], (scope) => {
		scope.systemPrompt.context({
			name: "review:policy",
			order: 116,
			text: (context) => {
				const agent = context.agent;
				if (agent === void 0 || !activeFor(agent)) return "";
				return "当前权限模式为「替我审核」：越界或需要提权的操作会先由独立审核模型自动裁定，判定安全的直接执行，不安全或不确定的才转人工审批。请正常尝试所需操作，无需预先征询。";
			}
		});
	});
	ctx.on("approval/request", async (req, next) => {
		if (!activeFor(req.agent)) return next();
		if (req.signal?.aborted === true) return next();
		if (inFlight >= resolved.maxConcurrent) return next();
		const op = describeOperation(req);
		if (op.text === "" && op.reason === "") return next();
		if (resolved.preflight && op.toolName === "bash" && DANGEROUS_PATTERNS.some((pattern) => pattern.pattern.test(op.text))) {
			record(req.agent, op.toolName, req.callId, {
				decision: "refer",
				rationale: "命中危险命令静态规则"
			});
			return next();
		}
		inFlight += 1;
		try {
			const verdict = await judge(ctx, resolved, req, op);
			record(req.agent, op.toolName, req.callId, verdict);
			if (verdict.decision === "allow") return "allowed-once";
			return next();
		} catch (error) {
			const message = error instanceof Error ? error.message : "unknown review failure";
			record(req.agent, op.toolName, req.callId, {
				decision: "refer",
				rationale: "",
				error: message.slice(0, 200)
			});
			return next();
		} finally {
			inFlight -= 1;
		}
	}, { prepend: true });
}
//#endregion
export { Config, DANGEROUS_PATTERNS, apply, describeOperation, frameArguments, inject, name, parseVerdict, resolveConfig, resolveRoute, userContext };
