# deepseek-autoreview

DeepSeek Harness 的「替我审核」权限预设插件：在 `read-only` / `workspace-write` / `danger-full-access` 三种模式之外，提供第四种权限模式。越界/提权请求先由独立审核模型（默认随主对话路由，建议 `deepseek-v4-flash`）做一次安全判定——判定安全则**自动批准**，不安全、不确定或判定失败则**转人工审批**，全程 fail-closed。

## 四种模式

| 预设 | 沙箱 | 审批策略 | 工作区内操作 | 越界/提权操作 |
| --- | --- | --- | --- | --- |
| read-only | read-only | ask | 写被拒，需提权 | 人工审批 |
| workspace-write | workspace-write | ask | ✅ 自动 | 人工审批 |
| **替我审核（review）** | **workspace-write** | **ask** | ✅ 自动 | **审核模型裁决：安全→自动批准；否则→人工审批** |
| danger-full-access | danger-full-access | never | ✅ 自动 | ✅ 自动 |

## 安装

前置：已有一个 dsh profile（`~/.dsh/profiles/<name>`，新结构：`dsh.profile.bundles` + `cordis.patch.yml`）。

**方式一：npm（发布后）**

```bash
dsh plugin add deepseek-autoreview
# 等价于在 profile 目录执行 pnpm add deepseek-autoreview
```

**方式二：GitHub 直接安装（未发布时）**

```bash
dsh plugin add github:Violet-Evergarden-Xiya/deepseek-AutoReview
```

**方式三：本地目录**

```bash
dsh plugin add file:/path/to/deepseek-AutoReview
```

三种方式装完后，还需要**注册 bundle**：在 profile 的 `package.json` 中把包名加进 `dsh.profile.bundles`（`dsh plugin add` 只负责安装依赖，不注册 bundle）：

```jsonc
{
  "dependencies": {
    "deepseek-autoreview": "1.0.0"
    // …其余依赖…
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "deepseek-autoreview"
        // …其余 bundle…
      ]
    }
  }
}
```

最后重启 dsh（host 侧 patch 层不支持热重载）：

```bash
# 重启你的 dsh 进程，例如
dsh web
```

重启后，新会话的预设选择器里会出现第四项「**替我审核**」（General 设置中也可设为默认）。

## 使用

把某个会话切到「替我审核」后：

- 工作区内读写：完全自动，零打扰；
- 越界/提权操作：审核模型判定——安全自动执行，会话内出现一条「已自动批准…」记录；不安全/不确定转人工审批。

## 可选配置

默认无需配置：审核模型复用会话最近一次 `request/header` 记录的主对话路由。需要固定路由时，在你自己的 profile `cordis.patch.yml` 里覆盖：

```yaml
- id: permission-review
  name: deepseek-autoreview
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
```

全部配置字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `presets` | `['review']` | 激活审核者的预设表键。 |
| `provider` / `model` | 未设置 | 审核模型路由，成对提供；缺省回退主对话路由。 |
| `maxInputBytes` | `8192` | 纳入判定请求的用户上下文字节上限。 |
| `maxOutputTokens` | `256` | 判定响应 token 上限。 |
| `timeoutMs` | `10000` | 单次判定端到端超时；超时转人工。 |
| `maxConcurrent` | `4` | 并发判定上限；超限请求直接转人工。 |
| `preflight` | `true` | 判定前先跑静态危险命令停表（零模型消耗）。 |
| `rubric` | 内置 | 审核者系统提示词整体覆盖。 |

## 工作原理

- **预设表**：bundle patch 覆盖 `permission` 行的预设表，新增 `review` 项（workspace-write + ask）。GUI 预设选择器与 General 设置由该表生成，Web 端零改动。
- **审核 answerer**：以 `prepend: true` 注册 `approval/request` 监听器，排在人工审批通道之前；只认领当前预设为 `review` 的会话的请求，其余原样下传。
- **判定**：每次提权请求一次独立模型调用；输入为会话日志中按 `callId` 找回的**真实工具参数**（最可信）、最近的用户请求与主模型的自述理由（可信度最低）。
- **兜底**：判定失败/超时/输出非法一律转人工，绝不 fail-open；`bash` 请求先过静态危险命令停表（`rm -rf /`、fork 炸弹、`curl | sh`、凭据外泄等），命中即转人工且不消耗模型调用。

## 记录与审计

- `review/verdict`（log-only 会话事件）：`{ toolName, callId?, decision, rationale?, error? }`，先于对应的 `approval/decided` 落盘。
- 会话内注入一条简明 notice：「已自动批准「bash」｜理由…（仅记录）」/「已转人工审批…」。

## 边界与安全说明

- 委派子代理的审批策略被钉死为 `never`，在 answerer 之前短路——审核模式不影响子代理。
- 审核者没有拒绝权：不安全/不确定一律转人工，由人做最终决定。
- 网络访问不在 v1 审核范围内（harness 对网络本就不做限制）。
- **预设表为整键覆盖**：bundle patch 会重写 `permission` 行的整个 `presets` 表（含 read-only / workspace-write / danger-full-access 三个出厂项 + review）。若你的部署自定义过其他预设，请在 profile 的 `cordis.patch.yml` 里手工合并而不是直接使用本 bundle 的覆盖条目。
- 审核判定质量取决于所选模型，rubric 需要在使用中迭代。

## 从源码构建 / 测试

```bash
pnpm install
pnpm typecheck
pnpm test      # 15 个单元/集成用例，使用假模型适配器，不消耗真实额度
pnpm build     # tsc 声明产物 → tsdown 打包 lib/
```

发布：

```bash
pnpm publish   # 运行 prepublishOnly（typecheck + test）后发布
```
