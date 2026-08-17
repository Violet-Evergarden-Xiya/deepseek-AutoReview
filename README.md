# deepseek-autoreview

A「替我审核」(review-on-my-behalf) permission preset for DeepSeek Harness: a fourth permission mode beside `read-only` / `workspace-write` / `danger-full-access`. Escalation asks run through a **three-tier funnel** — a conservative whitelist (zero-token fast approval), a danger blocklist (zero-token interception), and an independent reviewer model for the gray zone. Safe operations auto-approve, unsafe/uncertain ones fall through to the human approval prompt, and obviously malicious asks can be denied outright. Fail-closed by construction, with a user-switchable reviewer model in General settings.

## The four modes

| Preset | Sandbox | Approval | Inside workspace | Escalations |
| --- | --- | --- | --- | --- |
| read-only | read-only | ask | writes denied | human approval |
| workspace-write | workspace-write | ask | ✅ silent | human approval |
| **review (替我审核)** | **workspace-write** | **ask** | ✅ silent | **whitelist → blocklist → reviewer model; safe auto-approves, else human/deny** |
| danger-full-access | danger-full-access | never | ✅ silent | ✅ silent |

## Install

Requires a dsh profile (`~/.dsh/profiles/<name>`, new `dsh.profile.bundles` + `cordis.patch.yml` structure).

```bash
# npm (after publishing)
dsh plugin add deepseek-autoreview
# straight from GitHub
dsh plugin add github:Violet-Evergarden-Xiya/deepseek-AutoReview
# local checkout
dsh plugin add file:/path/to/deepseek-AutoReview
```

Then register the bundle in the profile's `package.json` (`dsh plugin add` only installs the dependency):

```jsonc
{
  "dependencies": { "deepseek-autoreview": "1.1.0" },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "deepseek-autoreview"]
    }
  }
}
```

Restart dsh (no hot reload for the host patch layer):

```bash
dsh web
```

The preset picker then shows the fourth entry「替我审核」.

## Usage

Switch a session to「替我审核」:

- workspace edits run silently;
- escalations pass the funnel: structurally verifiable commands (`npm/pnpm/pip install`, `git clone/pull/fetch`, no shell metacharacters) fast-approve with zero tokens; catastrophic shapes and sensitive paths (`rm -rf /`, `curl | sh`, writes to `/etc` …) intercept with zero tokens; the gray zone is judged by the reviewer model;
- auto-approvals are rate-limited (5/min, 30/hour by default) — over-budget asks delegate to the human.

## Switching the reviewer model in settings

After install, **Settings → General** gains a「替我审核模型」row, switchable at any time with immediate effect:

- **Follow main conversation** (default): the reviewer reuses the session's current model;
- **Fixed model**: fill Provider / Model (e.g. `deepseek-official` / `deepseek-v4-flash`); the host validates the route against the LLM catalog and falls back to the session route (flagged in the audit) when invalid;
- Priority: settings (fixed) > composition config > session route.

## Configuration (profile `cordis.patch.yml`)

```yaml
- id: permission-review
  name: deepseek-autoreview
  config:
    provider: deepseek-official   # optional deployment-level fallback route (paired with model)
    model: deepseek-v4-flash
```

| Field | Default | Meaning |
| --- | --- | --- |
| `presets` | `['review']` | Preset table keys that activate the reviewer. |
| `provider` / `model` | unset | Composition-level fallback route, supplied together. |
| `maxInputBytes` | `1024` | Byte budget for the current-turn user context. |
| `maxOutputTokens` | `160` | Judgment response token cap. |
| `timeoutMs` | `10000` | End-to-end judgment deadline; timeout delegates. |
| `maxConcurrent` | `4` | In-flight judgment cap; over-capacity asks delegate. |
| `whitelist` | `true` | Zero-token fast approval for structurally verifiable commands. |
| `whitelistVerbs` | `[npm,pnpm,yarn,pip,pip3,poetry,cargo,git]` | Whitelisted command verbs. |
| `preflight` | `true` | Deterministic blocklist interception. |
| `blocklist` | 26 built-in rules | `{id, pattern, tools?}` string-pattern rules. |
| `staticDeny` | `false` | Blocklist hits reject (`deny`) instead of delegating. |
| `deny` | `true` | Allow the model to decide `deny`. |
| `maxAutoPerMinute` / `maxAutoPerHour` | `5` / `30` | Auto-approval budget; overflow delegates. |
| `retryTransient` | `true` | Retry transient failures once (rate limits/network); timeouts and invalid outputs never retry. |
| `rubric` | built-in | Full replacement for the reviewer system prompt. |

## How it works

- **Preset table**: the bundle patch overrides the `permission` row's preset table with `review` appended (`workspace-write` + `ask`).
- **Three-tier funnel**: whitelist (zero tokens) → blocklist (zero tokens) → reviewer model over the **real tool arguments** recovered from the session log by `callId`, the current turn's user request, and the asker's self-reported reason (least trusted).
- **Answerer**: a PREPENDED `approval/request` listener ahead of the human channel, gated on the `review` preset.
- **Closed vocabulary**: `allow` / `refer` / `deny` (deny rides the platform's `rejected` semantics).

## Audit and records

- `review/verdict` (log-only): `{ toolName, callId?, decision, rationale?, source, model?, latencyMs?, evidenceSha256?, rateLimited?, routeFallback?, error? }` — `source` names the deciding layer, `evidenceSha256` fingerprints the operation.
- One concise in-conversation notice per decision.

## Boundaries

- Delegated subagents keep their pinned `never` policy — the reviewer never sees child escalations.
- The whitelist only approves structurally verifiable commands (single verb, no `; | & < > $ = \` ( ) { }` anywhere), so composite or obfuscated commands always land in the blocklist or the model.
- **The preset-table override replaces the whole `presets` key** (the three shipped entries are restated + `review`); hand-merge `review` into custom tables.
- Network access is outside the review scope.
- Judgment quality depends on the chosen model; iterate on the rubric.

## Build & test from source

```bash
pnpm install
pnpm typecheck
pnpm test      # 27 cases incl. adversarial samples (command chaining, path tricks), fake adapter, zero tokens
pnpm build     # tsc declarations → tsdown lib/ (host half + browser client bundle)
```

Publish:

```bash
pnpm publish   # runs prepublishOnly (typecheck + test) first
```
