# deepseek-autoreview

DeepSeek Harness 的「替我审核」权限预设插件：在 `read-only` / `workspace-write` / `danger-full-access` 三种模式之外，提供第四种权限模式。越界/提权请求走**三级判定漏斗**——保守白名单（零 token 自动放行）、危险黑名单（零 token 拦截）、独立审核模型判定灰区——判定安全则自动批准，不安全转人工、明显恶意可直接拒绝，全程 fail-closed。

## 四种模式

| 预设 | 沙箱 | 审批策略 | 工作区内操作 | 越界/提权操作 |
| --- | --- | --- | --- | --- |
| read-only | read-only | ask | 写被拒，需提权 | 人工审批 |
| workspace-write | workspace-write | ask | ✅ 自动 | 人工审批 |
| **替我审核（review）** | **workspace-write** | **ask** | ✅ 自动 | **三级漏斗：白名单→黑名单→审核模型，安全自动批准，否则转人工/拒绝** |
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
    "deepseek-autoreview": "1.1.0"
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

最后重启 dsh（host 侧 patch 层不支持热重载）：

```bash
dsh web
```

重启后，新会话的预设选择器里会出现第四项「**替我审核**」（General 设置中也可设为默认）。

## 使用

把某个会话切到「替我审核」后：

- 工作区内读写：完全自动，零打扰；
- 越界/提权操作：三级漏斗裁定——白名单命令（`npm/pnpm/pip install`、`git clone/pull` 等**结构可验证**形态）零 token 直接放行；危险形态/敏感路径（`rm -rf /`、`curl|sh`、写 `/etc` 等）零 token 拦截；灰区由审核模型判定。安全自动执行并留下「已自动批准…」记录，不安全/不确定转人工审批，明显恶意直接拒绝；
- 自动批准受**速率预算**约束（默认 5 次/分钟、30 次/小时），超限自动转人工，防提权风暴。

## 设置中切换审核模型

安装后，**设置 → General** 里会出现「**替我审核模型**」一项，随时切换、即时生效（无需重启）：

- **跟随主会话**（默认）：审核模型自动跟随主会话当前模型；
- **指定模型**：填 Provider / Model（例如 `deepseek-official` / `deepseek-v4-flash`），宿主侧会校验模型是否存在；无效时自动回退主会话路由并在审计中标注；
- 组合配置的 `provider`/`model` 仍可作为部署级兜底；优先级：设置（指定模型）> 组合配置 > 主会话路由。

## 可选配置（profile 的 cordis.patch.yml）

```yaml
- id: permission-review
  name: deepseek-autoreview
  config:
    provider: deepseek-official   # 可选：部署级兜底路由（与 model 成对）
    model: deepseek-v4-flash
```

全部配置字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `presets` | `['review']` | 激活审核者的预设表键。 |
| `provider` / `model` | 未设置 | 组合级兜底路由，成对提供；低于设置的「指定模型」。 |
| `maxInputBytes` | `1024` | 判定请求中当前 turn 用户上下文字节上限。 |
| `maxOutputTokens` | `160` | 判定响应 token 上限。 |
| `timeoutMs` | `10000` | 单次判定端到端超时；超时转人工。 |
| `maxConcurrent` | `4` | 并发判定上限；超限请求直接转人工。 |
| `whitelist` | `true` | 保守白名单自动放行（仅结构可验证命令，禁止任何 shell 元字符）。 |
| `whitelistVerbs` | `[npm,pnpm,yarn,pip,pip3,poetry,cargo,git]` | 白名单动词集。 |
| `preflight` | `true` | 黑名单静态拦截（危险命令形态 + 敏感路径）。 |
| `blocklist` | 内置 26 条 | 黑名单规则（`{id, pattern, tools?}`，pattern 为字符串正则）。 |
| `staticDeny` | `false` | 黑名单命中直接拒绝（`true`）而非转人工。 |
| `deny` | `true` | 允许审核模型输出「直接拒绝」。 |
| `maxAutoPerMinute` / `maxAutoPerHour` | `5` / `30` | 自动批准速率预算，超限转人工。 |
| `retryTransient` | `true` | 瞬时错误（限流/网络）重试一次，超时与非法输出不重试。 |
| `rubric` | 内置 | 审核者系统提示词整体覆盖。 |

## 工作原理

- **预设表**：bundle patch 覆盖 `permission` 行的预设表，新增 `review` 项（workspace-write + ask）。GUI 预设选择器与 General 设置由该表生成。
- **三级漏斗**：白名单（零 token 放行）→ 黑名单（零 token 拦截）→ 审核模型（灰区判定，输入为会话日志中按 `callId` 找回的**真实工具参数**、当前 turn 用户请求与主模型自述理由）。
- **answerer**：以 `prepend: true` 注册 `approval/request` 监听器，排在人工审批通道之前；只认领当前预设为 `review` 的会话的请求，其余原样下传。
- **判定词表**：`allow`（自动批准）/ `refer`（转人工）/ `deny`（直接拒绝，走系统既有 rejected 语义）。

## 记录与审计

- `review/verdict`（log-only 会话事件）：`{ toolName, callId?, decision, rationale?, source, model?, latencyMs?, evidenceSha256?, rateLimited?, routeFallback?, error? }`——`source` 标明裁决层级（whitelist/blocklist/model），`evidenceSha256` 为操作指纹，便于事后审计。
- 会话内注入一条简明 notice：「已自动批准/已转人工审批/已拒绝…（仅记录）」。

## 边界与安全说明

- 委派子代理的审批策略被钉死为 `never`，在 answerer 之前短路——审核模式不影响子代理。
- 白名单只放行**结构可验证**的命令（单动词 + 全程禁止 `; | & < > $ = \` ( ) { }` 等元字符），拼接/混淆形态必然落入黑名单或模型判定。
- **预设表为整键覆盖**：bundle patch 会重写 `permission` 行的整个 `presets` 表（含三个出厂项 + review）。若你的部署自定义过其他预设，请在 profile 的 `cordis.patch.yml` 里手工合并。
- 网络访问不在审核范围内（harness 对网络本就不做限制）。
- 审核判定质量取决于所选模型，rubric 需要在使用中迭代。

## 从源码构建 / 测试

```bash
pnpm install
pnpm typecheck
pnpm test      # 27 个用例：三级漏斗、deny、节流、缓存、对抗样例（命令拼接/路径欺骗/提示注入），假模型适配器零 token 消耗
pnpm build     # tsc 声明产物 → tsdown 打包 lib/（host 半 + 浏览器 client bundle）
```

发布：

```bash
pnpm publish   # 运行 prepublishOnly（typecheck + test）后发布
```
