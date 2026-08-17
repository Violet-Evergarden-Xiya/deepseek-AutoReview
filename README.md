# deepseek-autoreview

A「替我审核」(review-on-my-behalf) permission preset for DeepSeek Harness: a fourth permission mode beside `read-only` / `workspace-write` / `danger-full-access`. Escalation asks are judged by an independent reviewer model (reuses the session's main route by default; `deepseek-v4-flash` recommended) — safe operations auto-approve, unsafe, uncertain, or failed judgments fall through to the human approval prompt. Fail-closed by construction.

## The four modes

| Preset | Sandbox | Approval | Inside workspace | Escalations |
| --- | --- | --- | --- | --- |
| read-only | read-only | ask | writes denied | human approval |
| workspace-write | workspace-write | ask | ✅ silent | human approval |
| **review (替我审核)** | **workspace-write** | **ask** | ✅ silent | **reviewer model: safe → auto-approve; else → human** |
| danger-full-access | danger-full-access | never | ✅ silent | ✅ silent |

## Install

Requires a dsh profile (`~/.dsh/profiles/<name>`, new `dsh.profile.bundles` + `cordis.patch.yml` structure).

**From npm (after publishing):**

```bash
dsh plugin add deepseek-autoreview
# equivalent to `pnpm add deepseek-autoreview` inside the profile directory
```

**Straight from GitHub (before publishing):**

```bash
dsh plugin add github:Violet-Evergarden-Xiya/deepseek-AutoReview
```

**From a local checkout:**

```bash
dsh plugin add file:/path/to/deepseek-AutoReview
```

Then register the bundle: `dsh plugin add` only installs the dependency, so add the package name to `dsh.profile.bundles` in the profile's `package.json`:

```jsonc
{
  "dependencies": {
    "deepseek-autoreview": "1.0.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "deepseek-autoreview"
      ]
    }
  }
}
```

Restart dsh (the host patch layer has no hot reload):

```bash
dsh web
```

The preset picker then shows the fourth entry「替我审核」for every session (and General settings can make it the default).

## Usage

Switch a session to「替我审核」:

- workspace edits run silently;
- escalations are judged by the reviewer — safe ones execute with a concise「已自动批准…」transcript notice, unsafe/uncertain ones reach the normal human approval prompt.

## Optional configuration

No configuration is needed: the reviewer reuses the session's most recent logged `request/header` route. To pin an explicit route, override in your own profile `cordis.patch.yml`:

```yaml
- id: permission-review
  name: deepseek-autoreview
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
```

Full config table:

| Field | Default | Meaning |
| --- | --- | --- |
| `presets` | `['review']` | Preset table keys that activate the reviewer. |
| `provider` / `model` | unset | Reviewer route, supplied together; falls back to the main conversation route. |
| `maxInputBytes` | `8192` | Byte budget for the user context in the judgment request. |
| `maxOutputTokens` | `256` | Judgment response token cap. |
| `timeoutMs` | `10000` | End-to-end judgment deadline; timeout delegates. |
| `maxConcurrent` | `4` | In-flight judgment cap; over-capacity asks delegate. |
| `preflight` | `true` | Static danger stop-list before the model call (zero token cost). |
| `rubric` | built-in | Full replacement for the reviewer system prompt. |

## How it works

- **Preset table**: the bundle patch overrides the `permission` row's preset table with `review` appended (`workspace-write` + `ask`). The GUI picker and General settings derive from this table — zero web changes.
- **Reviewer answerer**: registers a PREPENDED `approval/request` listener ahead of the human channel; claims asks only for sessions whose selected preset is `review`, everything else passes through via `next()`.
- **Judgment**: one independent model call per escalation over the **real tool arguments** recovered from the session log by `callId`, the latest user request, and the main model's self-reported reason (least trusted).
- **Guardrails**: failures, timeouts, and invalid outputs always delegate; `bash` asks hit a static danger stop-list (`rm -rf /`, fork bombs, `curl | sh`, credential exfiltration, …) before any model call.

## Audit and records

- `review/verdict` (log-only session event): `{ toolName, callId?, decision, rationale?, error? }`, persisted before the matching `approval/decided`.
- One concise in-conversation notice per decision (「已自动批准…」/「已转人工审批…」).

## Boundaries

- Delegated subagents keep their pinned `never` policy — the reviewer never sees child escalations.
- The reviewer has no veto: unsafe or uncertain asks always reach the human for the final call.
- Network access is outside the v1 review scope.
- **The preset-table override replaces the whole `presets` key** (the three shipped entries are restated + `review`). Deployments with extra custom presets should hand-merge `review` into their own table in the profile patch layer instead of using the bundle override.
- Judgment quality depends on the chosen model; iterate on the rubric in practice.

## Build & test from source

```bash
pnpm install
pnpm typecheck
pnpm test      # 15 unit/integration cases against a fake model adapter — no real tokens
pnpm build     # tsc declarations → tsdown bundles lib/
```

Publish:

```bash
pnpm publish   # runs prepublishOnly (typecheck + test) first
```
