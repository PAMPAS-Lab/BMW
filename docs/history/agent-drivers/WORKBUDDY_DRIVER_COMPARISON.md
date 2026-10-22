# WorkBuddy 第四驱动 · 方案对比（官方文档调研修正版）

> 2026-10-22 合并旧分支后归档。以下为当时路线比较与初版回执，保留其证据范围；不是当前待办。现行实现已经增加实际工具目录门禁、系统加密与真实清理隔离，见[驱动架构](../../AGENT_DRIVER_DESIGN.md)及[功能规格](../../FUNCTIONAL_SPEC.md)。文内代码样式路径按原仓库根解释。

状态：调研完成，待拍板。仅分析与设计，未改代码。
日期：2026-10-19。基 commit：`7d4a294`。
关联：`docs/plans/WORKBUDDY_DRIVER.md`（初版设计，其 §0.1 结论已被本文更正）。

---

## 0. 结论速览

**可以做，而且比上一版判断的干净得多。**

| 项 | 上一版结论 | 本次结论（有官方文档 + 本机实测支撑） |
|---|---|---|
| 认证 | 没有独立认证，只能借 WorkBuddy 桌面壳 | ❌ **错**。官方有 3 类独立认证：`CODEBUDDY_API_KEY`、`CODEBUDDY_AUTH_TOKEN`、SDK `authenticate()`；ACP 还额外暴露 4 种 OAuth 登录方式 |
| 是否需要 broker | 需要主进程 broker，外部进程复刻不了 | ❌ **错**。broker 只是 **桌面 App 拉起 CLI 的方式**，不是 CLI 运行的前提。裸进程可独立运行 |
| 之前为什么挂住 | 缺 broker | ✅ **真因已定位**：①本地控制端口与 WorkBuddy 桌面进程冲突；②继承了本会话的 agent 上下文环境变量 |
| 集成方式 | 只能 stream-json（ACP 握手无响应） | ✅ ACP 已实测握手成功，且能力声明完整 |

推荐：**以 ACP（`--acp`）为主干传输，官方 Agent SDK 作为登录与交叉验证的加速器**；详见 §6。

---

## 1. 调研方法

1. 官方文档：`workbuddy.cn/docs/cli/*`、`codebuddy.cn/docs/cli/*`、`codebuddy.ai/docs/cli/*`（CLI 参考、Headless、环境变量、IAM 身份与访问管理、SDK、SDK-TypeScript、SDK-Python、ACP 协议集成、IDE 集成）。
2. 本机实测：装 `@tencent-ai/agent-sdk@0.3.284`（官方 npm 包，含内置 CLI），在**干净环境**下分别验证 `-p` 与 `--acp` 两条链路。
3. BMW 侧对照：`packages/agent-contract/src/conversation.ts` 的 `AgentBackend` 契约、现有三个 harness 的实现形态。

---

## 2. 已确证事实

### 2.1 官方稳定入口（4 类）

| 入口 | 形态 | 官方文档 | 本机实测 |
|---|---|---|---|
| CLI `-p` + `--output-format stream-json` | 子进程、行式 JSON | ✅ Headless Mode | ✅ 启动正常，未登录时**明确报错退出** |
| CLI `--acp` | JSON-RPC 2.0 over stdio（ndJsonStream） | ✅ ACP Protocol Integration | ✅ `initialize` 握手成功，见 2.3 |
| CLI `--serve` | 本地 HTTP：Web UI + REST API + ACP over HTTP SSE | ✅ CLI 参考 | 未实测（不建议，见 §4.4） |
| Agent SDK | `query()` / `CodeBuddySDKClient` | ✅ SDK 文档 | ✅ 包可安装，导出完整 |

### 2.2 认证（三选一，均为官方口径）

| 方式 | 用法 | 适用 |
|---|---|---|
| API Key | `CODEBUDDY_API_KEY=…`（+ `CODEBUDDY_INTERNET_ENVIRONMENT=internal` 中国版） | 个人开发者、最简 |
| OAuth Token | `CODEBUDDY_AUTH_TOKEN=…` 或 `apiKeyHelper` 脚本 | CI/CD、企业 |
| 交互式登录 | SDK `unstable_v2_authenticate({ onAuthUrl })` 两阶段；ACP `authMethods` + `authenticate` 方法 | 桌面 App，**可嵌进设置面板** |

优先级：`CODEBUDDY_AUTH_TOKEN` > `apiKeyHelper` > `CODEBUDDY_API_KEY`。

Key 获取页：中国版 `https://copilot.tencent.com/profile/`；海外版 `https://www.codebuddy.ai/profile/keys`。

> 合规性结论：**这一层完全满足** `docs/AGENT_DRIVER_DESIGN.md` 的「各驱动使用独立配置和官方正常登录流程，不读取原生桌面的私有凭据」。上一版要求的"契约豁免"不再需要。

### 2.3 ACP 实测握手结果（决定性证据）

```
$ codebuddy --acp   ← 发送 initialize
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":1,
  "agentCapabilities":{
    "promptCapabilities":{"image":true,"embeddedContext":true},
    "mcpCapabilities":{"http":true,"sse":true},
    "loadSession":true,
    "delegateToolsSupport":true,
    "mainAgentSupport":false,
    "multitaskSupport":true,
    "metaPromptSupport":true},
  "authMethods":[
    {"id":"iOA","name":"Login with iOA"},
    {"id":"external","name":"Login with Google/Github"},
    {"id":"internal","name":"Login with WeChat"},
    {"id":"selfhosted","name":"Login with Enterprise Domain"}]}}
```

要点：`image:true`（可开图像输入）、`loadSession:true`（原生续聊）、`mcpCapabilities` http/sse、**`authMethods` 把 4 种登录方式都暴露给客户端**。

### 2.4 版本与包体事实

| 对象 | 事实 |
|---|---|
| 官方 SDK | `@tencent-ai/agent-sdk@0.3.284`（今天发布），MIT，168MB，依赖 `@agentclientprotocol/sdk@1.7.0` + `@modelcontextprotocol/sdk` |
| SDK 内置 CLI | `2.169.0`（`cli/bin/codebuddy`），可用 `--acp` / `-p` / `--serve` / `--port` / `--auth` |
| WorkBuddy App 内置 CLI | `2.161.0`，是 **lite-wb 精简打包变体**（`dist/codebuddy-lite-wb.mjs`），独立执行会 `Cannot find module '../dist/codebuddy'`，**不能直接复用** |
| SDK 关键含义 | 官方 SDK 自身依赖 ACP SDK ⇒ **SDK 的传输层就是 ACP**。ACP 不是"替代路线"，而是官方主干 |

### 2.5 之前"静默挂住"的真实根因（已复现并修复验证）

| 现象 | 根因 | 证据 |
|---|---|---|
| `-p` 启动即 `EADDRINUSE 127.0.0.1:63533` | CLI 会绑定稳定的本地控制端口，与 WorkBuddy 桌面进程占用的端口冲突 | `--port 64111` 后该错误消失 |
| 换端口后 `EPERM … ~/.workbuddy/projects/private-tmp/*.jsonl` | 继承了本会话的 agent 上下文变量（`CODEBUDDY_ARTIFACTS`、`CODEBUDDY_SANDBOX_BROKER_*` 等），导致 transcript 写到 WorkBuddy 目录并被沙箱拒绝 | 用 `env -i` 干净环境后不再出现 |
| 干净环境下 | **启动正常，立刻给出明确终态**：`Authentication required. Please use /login command to sign in to your account` | 退出码 1，不再挂住 |

即：**不是"缺 broker 无法运行"，而是"环境被污染 + 端口撞车"**。这是本次最重要的更正。

---

## 3. 四条路线总览

| 路线 | 传输 | 认证入口 | 依赖 | 与现有三驱动的同构度 |
|---|---|---|---|---|
| **A. 官方 Agent SDK** | `query()` / `createSession()`（内部再 spawn CLI） | `unstable_v2_authenticate` | +168MB npm 包 | 与 Qoder（SDK `query()`）同构 |
| **B. ACP** | `--acp` JSON-RPC over stdio | ACP `authMethods`/`authenticate` | 可选 `@agentclientprotocol/sdk` | 与 Codex（App Server JSON-RPC）同构 |
| **C. stream-json** | `-p --output-format stream-json` | 只能靠 env 里的 Key | 零新增 | 与 DSH（本地 JSON 行）同构 |
| **D. `--serve` HTTP** | 本地 HTTP + `--auth password` | 同 C，另有 HTTP 层口令 | 零新增 | 无同构先例 |

---

## 4. 按 BMW 契约逐项对比

契约来源：`packages/agent-contract/src/conversation.ts` 的 `AgentBackend`（`description` / `prepare` / `run` / `interrupt` / `respond` / `close` / `drain` / `settings`）。

### 4.1 综合矩阵

图例：✅ 原生支持 ｜ 🟡 可实现但需自己补齐 ｜ ❌ 做不到/很勉强

| BMW 契约要求 | A. SDK | B. ACP | C. stream-json | D. serve |
|---|---|---|---|---|
| `prepare()` 读实际工具目录再放行 | ✅ `system/init` 有 `tools[]`+`mcp_servers[]`；另有 `mcpServerStatus()` | ✅ `session/new` 返回会话后才可列工具 | 🟡 解析 `system/init` 的 `tools[]` | 🟡 同 C，但要多跳一层 HTTP |
| `run()` 流式事件 | ✅ 类型化 `Message` 联合 | ✅ `session/update` 通知 | 🟡 自己解析 ndjson | 🟡 自己解析 SSE |
| `interrupt()` 取消 | ✅ `Query.interrupt()` + `AbortError` + `EXIT_REASONS.user_cancelled` | ✅ `session/cancel`（协议一等公民） | ❌ 只能 kill 进程（`-p` 无中途中止语义） | 🟡 HTTP 侧取消语义未文档化 |
| `respond()` 审批 | ✅ `canUseTool` 回调（进程内、可同步 deny） | ✅ `session/request_permission`（客户端裁决） | ❌ 只能事后终止 | ❌ 同 C |
| 越界工具**执行前**拦截 | ✅ `canUseTool` → `{behavior:'deny'}` | ✅ 声明不支持 fs/terminal 能力 → 反向代理自然失效 | ❌ 只能"事后抛错终止本轮" | ❌ 同 C |
| 会话续聊 | ✅ `resume` / `continue` / `resumeSessionAt` / `forkSession` | ✅ `loadSession:true` + `session/load` | ✅ `--resume <id>` | 🟡 需自管会话映射 |
| 配置隔离（不读桌面私有凭据） | ✅ `settingSources` **默认不加载任何文件配置** | 🟡 靠独立 `HOME`/配置目录 | 🟡 靠 `env -i` 式环境构造 | 🟡 同 C |
| 设置面板 `auth.login` | ✅ `authenticate({onAuthUrl})` 返回登录 URL，两阶段完成 | ✅ `authMethods` 列表 + `authenticate` | ❌ 只有 TUI `/login`，无法程序化 | ❌ 同 C |
| 模型目录 | ✅ `supportedModels()` / `getAvailableModels()` | ✅ `getConfigOptions` 类方法 | 🟡 只能硬编码白名单 | 🟡 同 C |
| 版本漂移风险 | 🟡 SDK 标注 `unstable_*`，API 会变 | 🟢 开放协议，有规范 | 🟡 事件字段形状无文档保证 | 🔴 HTTP API 无稳定文档 |
| 落地工作量 | 最小（~200 行） | 中（~350 行 + 协议客户端） | 中（~300 行，事件映射全自写） | 大（+端口/口令/进程生命周期） |

### 4.2 路线 A：官方 Agent SDK

**能力面**（`Options` 实测导出，非推测）：
`allowedTools` / `disallowedTools` / `canUseTool` / `permissionMode` / `mcpServers` / `strictMcpConfig` / `settingSources` / `resume` / `continue` / `forkSession` / `maxTurns` / `model` / `fallbackModel` / `thinking` / `effort` / `env` / `cwd` / `additionalDirectories` / `pathToCodebuddyCode` / `abortController` / `hooks` / `agents` / `sandbox`。

**优点**
1. 三行就能跑一次查询，`canUseTool` 天然满足"执行前拒绝"，比 BMW 现有三家都强。
2. `settingSources` 默认空 ⇒ 干净环境开箱即得，不用像 ACP 那样自己造 HOME。
3. `authenticate()` 直接产出登录 URL，设置面板的 `auth.login` 一次成型。
4. 官方维护，与 CLI 版本绑定打包 ⇒ 不会踩用户机器上 CLI 版本不一致的坑。

**缺点**
1. **+168MB** 进 `package.json`（不过仓库已有先例：`harness-qoder` 也依赖带二进制的 SDK 包）。
2. 多个关键 API 标 `unstable_v2_*`，官方明说会变。
3. `query()` 会注入 `CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS=1` 并在首个 `result` 处关闭子进程；要多轮长会话得用 `unstable_v2_createSession`。
4. 仍是子进程模型，`interrupt()` 的可靠性取决于 SDK 实现，BMW 侧仍需进程级兜底。

### 4.3 路线 B：ACP

**优点**
1. **唯一能同时干净实现 `interrupt()` 和 `respond()` 的路线**：`session/cancel` 是协议一等公民，`session/request_permission` 直接对应 BMW 的审批回执。
2. 与 Codex App Server 同构，BMW 已有 JSON-RPC 客户端经验与测试夹具范式。
3. 免去 168MB；协议客户端可用 `@agentclientprotocol/sdk@1.7.0`（44KB 级）。
4. `authMethods` 由 agent 端声明 ⇒ 设置面板可以动态渲染"微信 / Google-GitHub / iOA / 企业域名"四种登录，而不是硬编码。
5. `image:true`、`loadSession:true` 都由协议层声明，能力位可如实填写。

**缺点**
1. 需自己管子进程生命周期（起、握手、`session/new`、`prompt`、`cancel`、退出清理）——但这也正是 Codex 驱动已经在做的事。
2. 文档只给了方法名与部分扩展字段，**完整方法集要按本机版本实测**（下一步 M1 就是干这个）。
3. 配置隔离要自己造环境（独立 `HOME`/配置目录 + 干净继承）。

### 4.4 路线 C：stream-json

**唯一优势是零新增依赖、纯参数控制。** 致命短板是 `interrupt()` 和 `respond()` 都无法真正满足契约：`-p` 模式下没有中途中止语义，只能 kill；越界工具只能"发现后终止"，做不到"执行前拒绝"。它适合做 **兜底/降级通道**，不适合做主干。

### 4.5 路线 D：`--serve`

`--serve` 确实存在（`--port` / `--host` / `--auth password|none` / ACP over HTTP SSE），但它解决的是"多客户端/远程接入"，对一个单用户桌面 App 是负收益：要额外管端口、口令、进程常驻、崩溃重启，且 REST API 没有稳定文档契约。**不建议。**

---

## 5. 推荐

### 5.1 主干：路线 B（ACP）

理由按权重排序：

1. **契约契合度最高**。BMW 的 `AgentBackend` 里 `interrupt` 和 `respond` 两个方法，现有三家（DSH / Codex / Qoder）分别靠官方 interrupt、`turn/interrupt`、`query.interrupt()` 实现，`respond` 基本都是 throw。ACP 是唯一能让 `respond` **真正实现**的路线，也顺手把"越界工具执行前拒绝"从"事后终止"升级为"事前不放行"。
2. **不引重依赖**，符合仓库"模块化、按场景可复用"的取向。
3. **协议是公开规范**，比解析 stream-json 的隐式字段稳。
4. 与 Codex 驱动同构，测试夹具、事件归一化层可复用，长期维护成本最低。

### 5.2 加速器：路线 A（SDK）只做两件事，不做主干

1. **M1 打通登录**：用 `unstable_v2_authenticate({ onAuthUrl })` 拿一次真实凭据，验证"官方登录流程"端到端可用，不用等 ACP 全链路写通。
2. **交叉验证**：ACP 事件映射写完后，用 SDK 的 `query()` 跑同一 prompt，比对两边事件语义是否一致，作为归一化层的第二份真值。

这样 SDK 不进产品依赖，只在 `scripts/` 里当验证工具。

### 5.3 兜底：路线 C

若 ACP 在 M1 实测中方法集有缺口（比如 `session/new` 拿不到工具目录），退到 stream-json，但明确记录"`interrupt`/`respond` 降级为 kill + 事后终止"这一能力缺口，并在 `description.capabilities` 里如实标 `approvals:false`。

---

## 6. 推荐方案落地形态（在初版设计上收敛）

初版 `WORKBUDDY_DRIVER.md` 的 §4 包清单、§6 三层工具边界、§9 失败模式、§10 验证计划 **全部继续有效**，只需替换传输层与认证层：

| 模块 | 初版（stream-json） | 收敛后（ACP） |
|---|---|---|
| 传输 | spawn `-p`，解析 stdout 行 | spawn `--acp`，JSON-RPC over stdio |
| 事件源 | `system/init`、`assistant`、`tool_use`、`result` | `session/update` 各 `kind`、`PromptResponse` |
| 取消 | 关 stdin → SIGTERM → SIGKILL | `session/cancel` → 兜底进程信号 |
| 审批 | 抛错 | `session/request_permission` → `respond()` |
| 认证 | 无（借壳） | `authMethods` + `authenticate` → 设置面板真正可选登录 |
| 工具边界 | `--tools ""` + `--strict-mcp-config` | 同上 + **不声明 fs/terminal 能力**，让反向代理由此天然失效 |
| 配置隔离 | 独立 config dir | 独立 `HOME` + 干净 env（`env -i` 白名单） |

**必须写进 CLAUDE/AGENTS 级约束的两条新坑**（本次实测所得）：

1. 子进程必须用**干净环境**构造（白名单 `HOME`/`PATH`/`TERM`），绝不能让 BMW 进程继承自身或 WorkBuddy 的 `CODEBUDDY_*` / `SANDBOX_*` 变量。
2. 子进程必须显式指定 `--port`（或等价参数），避开桌面 App 的稳定端口；并做 `EADDRINUSE` 重试。

---

## 7. 版本兼容性

| 依赖项 | 结论 |
|---|---|
| Node | SDK 要求 ≥18.20；BMW 用 Node 24，满足 |
| CLI 版本准入 | 以 `--acp` 的 `protocolVersion` 与 `agentCapabilities` 为准，而非版本号硬编码；`protocolVersion != 1` 直接拒绝并提示升级 |
| 模型白名单 | `--model` 实际列表含 `deepseek-v4.1-flash`、`glm-5.3`、`gpt-5.6-*`、`gemini-3.5-flash`、`kimi-k3` 等；仍按"官方目录 ∩ 白名单"取交集 |
| 已安装的 WorkBuddy App | **不依赖**。App 内 CLI 是 lite 变体，不可独立执行；驱动自带/指定 CLI 路径 |

---

## 8. 剩余风险

| 风险 | 等级 | 处置 |
|---|---|---|
| ACP 完整方法集未实测（尤其 `session/new` 后能否拿到工具目录） | 中 | M1 首要任务；不通过则退路线 C |
| 登录态存储位置与刷新策略（token 过期） | 中 | M1 一并确认；设置面板给"重新登录"入口 |
| `unstable_v2_*`（若采用 SDK 加速器） | 低（不进产品依赖） | 仅 `scripts/` 使用 |
| 用户机器上 CLI 来源（BMW 自带 vs 复用 App） | 中 | 建议驱动自带固定版本 CLI，避免版本漂移；`BMW_WORKBUDDY_EXECUTABLE` 可覆盖 |
| docs 门禁 | 低 | 新增包后 `docs:architecture` / `docs:features` 重跑 |

---

## 9. 需要拍板

1. **主选路线**：建议 B（ACP）。若你更看重"先看到效果"，选 A（SDK），代价是 168MB 依赖 + `unstable_*` API。
2. **CLI 来源**：驱动自带固定版本（推荐，可复现）／复用用户已装 WorkBuddy 的 CLI（省空间，但版本漂移且 lite 变体不可独立执行，实际不可行）。
3. **认证方式优先级**：设置面板先做哪条？API Key（最快、纯本地）／ACP 四种 OAuth（体验好、要写浏览器回调）。
4. **是否保留 stream-json 兜底通道**：保留（多写一层归一化分支）／不保留（ACP 不通就整体阻塞）。

拍板后我按 M1 → M4 推进，M1 的验收标准是：**ACP 全链路 `session/new` → `prompt` → `tool_use(browser)` → `result` 跑通，并证明工具目录恰好只有 `browser`**。

---

## 10. 已拍板并已实现（2026-10-19）

你的选择：**B（ACP）+ 固定 CLI 版本 + 认证只做 API Key + 不保留 stream-json 兜底**。代码已落库。

### 10.1 落地内容

| 项 | 实现 |
|---|---|
| 包 | `packages/harness-workbuddy`，driverId `workbuddy`，label `WorkBuddy` |
| CLI 固定 | 依赖 `@tencent-ai/codebuddy-code@2.169.0`（精确版本，无 `^`）；`prepare()` 每次校验 `--version` 必须等于 `2.169.0` |
| 传输 | `src/workbuddy-acp.ts`，JSON-RPC 2.0 over stdio，等价 Codex 的 App Server 传输 |
| 协议准入 | `initialize.protocolVersion` 必须为 1，否则拒绝并提示升级 |
| 认证 | `src/workbuddy-credentials.ts` 存 `agent-drivers/workbuddy/workbuddy-credentials.json`（0600、属主校验、拒绝 group/other 可读）；只经环境变量 `CODEBUDDY_API_KEY` 传给子进程 |
| 工具边界 | `--tools ""` + `--setting-sources user` + 客户端不声明 fs/terminal + 会话内唯一 `bmw` stdio MCP server；运行中非 browser 的 `tool_call` 或非 browser 的 `session/request_permission` 直接终止本轮 |
| 取消 | `session/cancel` 通知，超时后关传输（`cancellationTimeoutMs`） |
| 续聊 | `session/load`，返回的 `sessionId` 不等于请求值即拒绝 |
| 事件映射 | `agent_message_chunk`→`message.delta`（终轮补 `message.completed`）；`tool_call`/`tool_call_update`→`tool.started`/`tool.completed`；`StopReason`→`success`/`interrupted`/`failed` |
| 设置 | 只做 `initialize` + 一次 `session/new` 凭据校验，不产生模型输入；模型只列准入白名单 |

### 10.2 验收证据

| 层级 | 结果 |
|---|---|
| `npm run check` | 全绿（tsc / source policy / video schema / functional spec / architecture） |
| `npm test`（unit+contract+boundary） | 180 项，**98 passed / 0 failed**（82 为 opt-in external 层，未运行） |
| 新驱动单测 | 13 项全绿（环境白名单、参数、无 fs/terminal、越界工具终止、无 Key 拒绝、白名单模型拒绝、ACP 全流程事件序列） |
| 真实二进制冒烟 | 固定 CLI 2.169.0 解析成功；`--acp --tools "" --setting-sources user --model deepseek-v4.1-flash` 启动成功；`protocolVersion: 1`；`authMethods` 返回 iOA/external/internal/selfhosted；无凭据时 `session/new` 明确失败 |
| 真实模型往返 | **未验证**——需要你提供 WorkBuddy API Key（中国版 `https://copilot.tencent.com/profile/`） |

### 10.3 已知限制

1. **未做真实付费往返**：`browser` 工具的真实调用与续聊需要 Key 到位后台验。
2. **`browserOnly` 是结构保证 + 运行期强制**，不是"读回工具目录"：ACP v1 不返回工具清单，因此用参数（`--tools ""`）+ 会话声明（唯一 MCP server）+ 客户端能力（无 fs/terminal）+ 运行期拒绝四层共同构成。
3. **设置面板的 secret 输入框**由通用 UI 渲染（`loginMethods[].fields.secret`），需要 GUI 实机确认一次。
4. **`images: false`**：handshake 声明 `image:true`，但 BMW 侧图片准入未做，先保持关闭。
