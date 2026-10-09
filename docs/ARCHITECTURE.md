# BMW 模块、接口与局部验证

BMW 保持一个应用、唯一 `browser` 工具，以及 DSH、Codex、Qoder CN 三个官方驱动。当前目录定义 12 个模块、10 项接口保障和 3 项具体实现／装配保障；生成表是数量与依赖的准确来源。模块目录、公开入口、依赖方向、接口保障测试与测试分类分别由 `scripts/module-catalog.ts`、各 package 的 `exports`、`scripts/test-catalog.ts` 定义。本文生成区由 `npm run docs:architecture` 刷新，`npm run check:architecture` 检查，不能只修改文档而绕过源码约束。

应用入口负责选择并装配具体驱动与自有 Assistant，平台 Host 协调会话、设置和资源，不读取具体驱动协议与存储。Agent 契约是提供方无关的数据／生命周期接口；三个 harness 分别实现它，`agent-ui` 仅通过可信 Host IPC 展示对话。Browser 管理 Project 页面和受认证的操作队列，Feature 只通过具名宿主接口取得 Project、设置、媒体与浏览器执行。Media 接受未知输入后校验，返回未知的跨进程回复后再次校验；不把结构断言当作数据验证。Video Feature 管理草稿和工作流，复用媒体实现，不拥有第二套浏览器或 Agent 循环。

平台内部进一步分为 application lifecycle、Project/state storage、settings/permissions/schedules、Shell/preload。媒体内部进一步分为 host/controller/artifact IO 和 sandboxed workers。Feature 内部分为 draft/service/context 和 Studio/preload/renderer。这些进程边界也有 sender/token/Project/revision 的保障；同一 package 不代表同一信任域。

公开包入口允许 Node 使用 package subpath，也允许浏览器 ES 模块使用指向同一公开文件的相对 URL。跨模块导入内部文件、未声明依赖、运行时依赖环、Core 导入具体 harness 或 Apps、Renderer 导入宿主权限均会失败。类型依赖允许 Feature 实现平台生命周期，但编译后不形成运行时循环。开发脚本和测试可以检查实现细节，不能被产品模块反向依赖，生产代码也不能经同包测试目录间接访问具体 harness，日常运行时不能导入 harness 的显式迁移入口。公开入口不能导出测试文件。Renderer 的 Node 内建模块检查包含裸名称、node: 前缀和间接辅助库。生产计算式导入默认拒绝；DSH 安装版插件只能以声明的固定包名字面量解析依赖。

Shell 的全部 invoke 共用 sender、主框架和固定本地 URL 准入，在应用逻辑执行前拒绝其他 Renderer、子框架及已导航页面。Project、设置、计划任务、权限、布局、登录保持配置和加密快照在启动时预读；损坏、读取或解密失败提供重试/退出，后台写入不能替换不可读原文件。

Studio 的中立 AssistantStudioTarget 扩展为可选的闭合 layer {id,kind}；Feature 负责本地/全片容器存在性，Agent UI 负责第一笔输入固定范围和已有输入保护，Host FIFO 保存不可变请求上下文。对象元数据仅包含名称、类型及时间，不增加模型工具、宿主权限或核心到具体 harness 的依赖。浮框与停靠属于平台布局：实测属性列和时间轴边界限制 Native View；小窗强制停靠是临时有效布局，不覆盖用户原偏好。

## 直接接口保障与实现保障

代码依赖方向是三个 harness → `agent-contract`，Platform 将 Browser 与通用 AgentBackend 连接起来。Browser 和 AgentDriver 抽象均不依赖 DSH；接口的消费方、测试选择关系与运行时导入依赖是不同概念。

接口表的“直接接口保障测试”验证提供方的契约。`browser-model` 和 `agent-driver` 使用不加载 DSH 的 `driver` 夹具：使用 Platform 注入的 Host 私有连接配置，启动 BMW MCP 适配器，以模型侧客户端完成 initialize、唯一工具发现和真实 browser action 调用，并检查 GUI 页面一致性、权限、认证、绑定和 Project 切换。夹具没有 Agent 循环或付费模型。

“具体实现与产品装配保障”分别列出三驱动默认入口、Shell 准入与 DSH 实际装配；三驱动设置和会话契约也有直接保障，付费模型验收仍独立 opt-in。Browser Schema、目录、Bridge 或 MCP 适配器单独改动会选择通用 `driver`，不会自动启动真实 DSH。通用 Agent 契约、DSH 实现或 BMW 产品组装改动会选择 `bmw-dsh-assembly`；混合改动保留两侧保障，完整基线仍执行 DSH。安装版 DSH smoke 主要验证启动、认证、上下文和会话生命周期，不能替代 Browser 直接协议保障。

## 测试分类与日常入口

| 分类 | 验证内容 | 执行方式 |
|---|---|---|
| unit | 单模块算法、状态和可复现存储规则 | Node + 临时目录 |
| contract | 提供方/消费方、Schema、迁移、回复准入、取消/身份保障 | Node + 内存或临时夹具 |
| boundary | 模块依赖、公开入口、唯一工具、禁止能力 | Node + 全局静态检查 |
| type | 正例与 `@ts-expect-error` 反例消费者 | 每次新构建必须通过 |
| integration | Electron/驱动/Studio/后台页面 | 临时 Profile、Project、DSH Home |
| desktop | 工作区、Project/会话及实际重启、设置、原生焦点/键盘，以及 Studio 原生交互专项 | 工作区四组与 Studio 各环境分支独立报告 |
| media | 实际编码、播放、音频、取消和回滚 | Electron + 临时素材 + 本地 TTS |
| external | 付费模型、Edge 外部语音 | 单列 opt-in，不自动纳入局部或完整离线验证 |

```bash
# 显式改动范围：先看原因，再执行最小保障集。
npm run test:plan -- --files packages/browser-capability/src/renderer-read.ts
npm run test:affected -- --files packages/browser-capability/src/renderer-read.ts

# 模块级、Git 基线级或类别级验证。
npm run test:affected -- --module feature-video
npm run test:affected -- --base HEAD
npm run test:unit
npm run test:contracts
npm run test:boundaries

# 建立完整可信基线；之后默认 affected 对比这份基线，避免已有脏工作区混淆。
npm run verify:stability
npm run test:affected
```

入口顺序执行一次新构建，再执行被选择的测试；构建同时检查所有公开接口的正反类型夹具。构建哈希收据防止直接调用 runner 时使用过期 JS。测试入口不扫描生成 JS 的通配符，因此同步产生的 `*.test 2.js` 等副本不会成为测试或覆盖证据。所有测试仍以 authored TypeScript 清单为准。

“最小”是文件级、可解释的保障集：Node 测试依据 TypeScript AST 的导入与重导出依赖闭包选择；运行时测试对共享验证辅助库的改动自动追踪导入/重导出闭包，对生产模块依据明确的行为/间接依赖 watch 与接口保障矩阵选择；任何源代码修改都保留全局 boundary；接口改动追加消费方契约保障。一个测试文件内的全部断言仍会执行，不按名字猜测可以删掉的断言。中心 `main.ts` 或共享接口改动可能需要较广覆盖，这是该文件职责的实际影响。

未知路径、删除、共享构建配置、产品组合、选择器自身或验证代码中无法证明范围的动态模块导入会保守升级为完整离线集。生产计算式导入在架构检查时直接拒绝。运行时测试入口按显式行为/实现范围选择；未选中的入口不会仅因初始化时动态加载外部依赖就扩大其他模块的覆盖。直接修改这些入口，或影响共享测试库中的动态导入，仍保守升级。重命名同时处理旧、新路径；未追踪源文件纳入 Git 范围。新增测试未分类、接口没有保障测试、文档清单过期会直接失败。显式 `--files` 是调用者声明的范围；默认命令对比最后完整通过的哈希基线，能发现全部尚未验证的改动。没有基线时回退到 Git HEAD。

`--layer` 只验证所选类别，不声明完整改动覆盖，不能与文件范围混用。完整验证只有全部自动测试通过且运行期间源码未改变才更新 `.bmw-runtime/test-baseline.json`；局部通过不会覆盖完整基线。报告记录 selected/excluded 及原因、通过/失败/未执行、依赖版本、源码哈希和日志。桌面 Project 组包含独立重启，原生焦点失败仍是失败。生产 Profile、钥匙串与真实桌面体验保留人工验收；离线成功不代表付费模型或外部服务通过。

<!-- BEGIN GENERATED MODULE CONTRACTS -->

### 模块与允许的依赖

| 模块 | 职责 | 运行时依赖 | 额外类型依赖 |
|---|---|---|---|
| agent-contract | Provider-neutral Agent backend, settings, events and BMW Project/Session context contracts. | 无 | 无 |
| agent-ui | BMW-owned sandboxed conversation renderer and preload; only typed Host IPC, no provider or browser execution privileges. | agent-contract | 无 |
| media-native | Project artifact IO, capture, decode, processing, narration, composition and sandboxed workers. | 无 | 无 |
| browser-capability | One browser catalog, validated actions, Project pages, Bridge/MCP admission, FIFO and renderer reads. | 无 | media-native |
| platform | Application lifecycle, Projects/storage, permissions/settings/schedules, Shell and typed Feature host. | agent-contract, browser-capability, media-native | 无 |
| feature-video | Video actions, draft/CAS/audio provenance, Studio state/IPC/UI and prompt context. | browser-capability, media-native | platform |
| harness-dsh | Official DSH Agent process/auth/transport, native Project mappings, effective tool admission and explicit cold migration export. | agent-contract | 无 |
| harness-qoder | Official Qoder CN SDK/Worker Agent loop, pre-input effective browser catalog admission and normalized stream events. | agent-contract | 无 |
| harness-codex | Official Codex App Server, isolated effective model catalog preflight, dynamic browser tool transport and normalized receipts/events. | agent-contract | 无 |
| product-bmw | BMW product composition and enabled Features; no driver selection or application loop. | platform, feature-video | 无 |
| application | Select BMW and its configured drivers, then enter the platform application. | product-bmw, harness-dsh, harness-qoder, harness-codex, agent-ui, platform | 无 |
| validation | Development-only verification, fixtures, dependency analysis and test selection; never a model capability. | agent-contract, agent-ui, media-native, browser-capability, platform, feature-video, harness-dsh, harness-qoder, harness-codex, product-bmw, application | 无 |

### 跨模块接口与保障

| 接口 | 提供方 → 消费方 | 保证 | 直接接口保障测试 |
|---|---|---|---|
| agent-driver | agent-contract → platform, harness-dsh, harness-qoder, harness-codex, application | Stable BMW Sessions, closed event/capability admission, lifecycle and per-driver provider resume anchors; core owns no provider Agent loop. | agent.context, agent.conversation, api.types, driver |
| agent-settings | agent-contract → platform, agent-ui, harness-dsh, harness-qoder, harness-codex, application | Closed official-control requests and redacted account/model projections, no echoed secrets or model input; settings and actual native cleanup hold Host exclusion before Project transitions. | agent.driver-settings, agent.assistant-ui, platform.agent-settings, codex.settings, codex.backend, qoder.settings, dsh.settings, assistant.application, dsh |
| agent-conversations | platform → application | Visible blank Sessions, durable submission receipts, Project membership, immutable provider bindings, FIFO until actual resource drain, generic display-history ownership and uncertain-delivery recovery without replay. | platform.conversation-store, platform.agent-history, platform.agent-host, agent.data-migration |
| feature-lifecycle | platform → feature-video, product-bmw | Named activation/configure/layout/context/shutdown hooks; malformed runtime hooks fail before wiring; no extra model tools. | platform.feature-contract, api.types, desktop.workspace |
| browser-feature-host | browser-capability → platform, feature-video | Minimum Project/settings/media ports, actor enum, cancellation signal; validated action dispatch remains the only execution entry. | browser.host-contract, api.types, video.boundary, driver |
| browser-model | browser-capability → platform, feature-video | Exactly browser; bounded closed requests, authenticated Project/Session admission, FIFO, cancellation and image admission. | browser.sources, browser.schema, browser.catalog, browser.operations, browser.shutdown, browser.deadline, platform.boundaries, driver |
| native-media | media-native → browser-capability, platform, feature-video | Artifact IDs rather than caller paths; bounded request/reply admission; actual duration/track checks; bounded local/global layers, explicit keyframes and streamed independent audio share preview/export; cancellation drains output before rollback. | speech, media.speech, platform.sources, video.sources, sources, media.port-contract, api.types, media.controller, media.processing, media.production, media.processing-runtime, video, studio, localNarration |
| project-storage | platform → browser-capability, feature-video, application | BMW Project identity/documents/page state without native mappings, preserved unreadable Project/settings/tasks/permissions/layout/login state and encrypted snapshots, only missing-file initialization; no production Profile in tests. | platform.sources, platform.projects, platform.state, platform.permission-store, platform.continuity-state, platform.driver-binding, startup-recovery, startup-exit, startup.permissions.retry, startup.permissions.exit, startup.layout.retry, startup.layout.exit, startup.continuity-config.retry, startup.continuity-config.exit, startup.continuity-snapshot.retry, startup.continuity-snapshot.exit, desktop.projects |
| studio-draft | feature-video → platform, browser-capability | Canonical Video Document 2.0, lossless v1 migration, reversible simple subset, content-derived advanced guard, typed CAS edits; Project-owned drafts/artifacts, revision conflicts, actual narration provenance and stale export rejection; independent caption/visual edits. | video.schema, studio.schema, video.sources, video.studio, video.settings, video.boundary, studio, desktop.workspace |
| sandbox-io | media-native → feature-video, platform | Pinned Project artifacts, token/sender/offset bounds, isolated browser workers; no shell, cookies or unrestricted filesystem exposure. | media.processing, media.controller, media.capture, video, studio |

### 具体实现与产品装配保障

这些测试验证实现对通用契约的符合性，不能解释为抽象模块的代码依赖。Browser Schema、目录、Bridge 或 MCP 单独改动执行通用 driver 连接保障；DSH 实现、通用 Agent 契约或产品组装改动，以及完整基线执行这些集成保障。

| 保障 | 归属 | 消费的契约 | 验证内容 | 测试 | 自动选择范围 |
|---|---|---|---|---|---|
| bmw-agent-entry | application, platform, agent-ui, harness-dsh, harness-codex, harness-qoder | agent-driver, agent-settings, agent-conversations, studio-draft, project-storage | Production entry owns the Assistant, creates independent blank driver Sessions before input, preserves Project pages and Studio ownership across driver changes/restart, runs schedules on their pinned driver/Session with restored selection, and rejects invalid saved bindings without fallback. | bmw.agent-assembly, assistant.default, assistant.application, assistant.schedules | scripts/product-entry.ts, apps/bmw/, packages/platform/src/assistant-service.ts, packages/platform/src/main.ts |
| platform-shell-admission | platform | browser-model, project-storage, feature-lifecycle | Every Shell invoke admits only its live trusted main frame before application code; other Renderers, child frames and navigated content are denied. | platform.shell-ipc, driver | packages/platform/src/shell-ipc.ts, packages/platform/src/main.ts, packages/platform/src/preload/shell-preload.cts |
| bmw-dsh-assembly | harness-dsh, application, platform | agent-driver, browser-model | Actual installed DSH startup/authentication, prompt assembly, native lifecycle, harness-owned immutable Workspace mappings and explicit cold history export. Consumes the generic interfaces; does not define Browser or AgentDriver code dependencies. | dsh, dsh.project-bindings, dsh.migration-history, agent.data-migration | packages/harness-dsh/, packages/agent-contract/, apps/bmw/, packages/product-bmw/ |

### 安装依赖解析

生产计算式导入默认拒绝；以下安装依赖仅允许 requireDsh.resolve 使用列出的固定包名字面量。额外计算式导入仍被拒绝。

| 模块 | 文件 | 固定安装包 |
|---|---|---|
| harness-dsh | packages/harness-dsh/dsh/plugins/browser-mcp/index.ts | @deepseek-ai/dsh-mcp-client |

### 公开入口

跨模块相对导入也只能指向这些入口；浏览器中的 ES 模块继续使用相对 URL。

- agent-contract: `packages/agent-contract/index.ts`
- agent-ui: `packages/agent-ui/index.ts`
- media-native: `packages/media-native/src/media-controller.ts`, `packages/media-native/src/media-port.ts`, `packages/media-native/src/media-contract.ts`, `packages/media-native/src/composition-contract.ts`, `packages/media-native/src/card-templates.ts`, `packages/media-native/src/composition-layers.ts`, `packages/media-native/src/media/composition-layers-paint.ts`, `packages/media-native/src/narration-contract.ts`, `packages/media-native/src/video-options.ts`, `packages/media-native/src/video-options-form.ts`, `packages/media-native/src/artifact-job-io.ts`, `packages/media-native/src/media/composition-audio.ts`, `packages/media-native/src/media/composition-paint.ts`, `packages/media-native/src/media/linear-frames.ts`, `packages/media-native/src/image-contract.ts`, `packages/media-native/src/media/image-decoder.ts`, `packages/media-native/src/caption-export.ts`, `packages/media-native/src/text-export.ts`, `packages/media-native/src/focus-contract.ts`, `packages/media-native/src/recording-contract.ts`, `packages/media-native/src/visual-segments.ts`, `packages/media-native/src/image-drawing-contract.ts`, `packages/media-native/src/media/processing.cover-contract.ts`, `packages/media-native/src/source-contract.ts`, `packages/media-native/src/speech-contract.ts`, `packages/media-native/src/visual-effects.ts`, `packages/media-native/src/card-details.ts`
- browser-capability: `packages/browser-capability/src/browser-schema.ts`, `packages/browser-capability/src/bridge-server.ts`, `packages/browser-capability/src/browser-kernel.ts`, `packages/browser-capability/src/browser-capability-registry.ts`, `packages/browser-capability/src/browser-host.ts`
- platform: `packages/platform/src/product-definition.ts`, `packages/platform/src/main.ts`, `packages/platform/src/assistant-service.ts`, `packages/platform/src/feature-contract.ts`, `packages/platform/src/agent-data-schema.ts`
- feature-video: `packages/feature-video/index.ts`
- harness-dsh: `packages/harness-dsh/index.ts`, `packages/harness-dsh/migration/index.ts`
- harness-qoder: `packages/harness-qoder/index.ts`
- harness-codex: `packages/harness-codex/index.ts`
- product-bmw: `packages/product-bmw/index.ts`

### 分类测试清单

| ID | 分类 | 归属 | 入口 | 配置／分支 |
|---|---|---|---|---|
| agent.context | contract | agent-contract | packages/agent-contract/test/context-sync.test.ts | 默认 |
| agent.conversation | contract | agent-contract | packages/agent-contract/test/conversation.test.ts | 默认 |
| bmw.agent-assembly | contract | application, agent-ui, harness-dsh, harness-codex, harness-qoder | scripts/agent-assembly.test.ts | 默认 |
| agent.data-migration | contract | validation, platform, harness-dsh | scripts/agent-data-migration.test.ts | 默认 |
| dsh.project-bindings | contract | harness-dsh | packages/harness-dsh/test/project-bindings.test.ts | 默认 |
| dsh.migration-history | contract | harness-dsh | packages/harness-dsh/test/dsh-migration.test.ts | 默认 |
| agent.studio-composer | contract | agent-ui | packages/agent-ui/test/studio-composer-scope.test.ts | 默认 |
| agent.assistant-ui | contract | agent-contract | packages/agent-contract/test/assistant-ui.test.ts | 默认 |
| agent.driver-settings | contract | agent-contract | packages/agent-contract/test/driver-settings.test.ts | 默认 |
| platform.agent-settings | contract | platform | packages/platform/test/agent-settings-controller.test.ts | 默认 |
| codex.settings | contract | harness-codex | packages/harness-codex/test/codex-settings.test.ts | 默认 |
| codex.installation | contract | harness-codex | packages/harness-codex/test/codex-installation.test.ts | 默认 |
| qoder.settings | contract | harness-qoder | packages/harness-qoder/test/qoder-settings.test.ts | 默认 |
| dsh.settings | contract | harness-dsh | packages/harness-dsh/test/dsh-settings.test.ts | 默认 |
| platform.assistant-controller | contract | platform | packages/platform/test/assistant-controller.test.ts | 默认 |
| platform.conversation-store | contract | platform | packages/platform/test/conversation-store.test.ts | 默认 |
| platform.agent-history | contract | platform | packages/platform/test/agent-history-store.test.ts | 默认 |
| platform.agent-host | contract | platform | packages/platform/test/agent-host.test.ts | 默认 |
| browser.session-leases | contract | browser-capability | packages/browser-capability/test/session-leases.test.ts | 默认 |
| codex.policy | contract | harness-codex | packages/harness-codex/test/codex-policy.test.ts | 默认 |
| codex.backend | contract | harness-codex | packages/harness-codex/test/codex-backend.test.ts | 默认 |
| dsh.events | contract | harness-dsh | packages/harness-dsh/test/dsh-events.test.ts | 默认 |
| dsh.backend | contract | harness-dsh | packages/harness-dsh/test/dsh-backend.test.ts | 默认 |
| qoder.events | contract | harness-qoder | packages/harness-qoder/test/qoder-events.test.ts | 默认 |
| qoder.backend | contract | harness-qoder | packages/harness-qoder/test/qoder-backend.test.ts | 默认 |
| browser.schema | contract | browser-capability | packages/browser-capability/test/browser-schema.test.ts | 默认 |
| browser.catalog | contract | browser-capability | packages/browser-capability/test/mcp-tool-catalog.test.ts | 默认 |
| browser.operations | contract | browser-capability | packages/browser-capability/test/session-operations.test.ts | 默认 |
| browser.shutdown | contract | browser-capability | packages/browser-capability/test/bridge-shutdown.test.ts | 默认 |
| browser.deadline | contract | browser-capability | packages/browser-capability/test/browser-deadline.test.ts | 默认 |
| browser.screenshot | unit | browser-capability | packages/browser-capability/test/screenshot-read.test.ts | 默认 |
| browser.renderer-read | unit | browser-capability | packages/browser-capability/test/renderer-read.test.ts | 默认 |
| browser.download | unit | browser-capability | packages/browser-capability/test/media-artifact.test.ts | 默认 |
| browser.tab-policy | unit | browser-capability | packages/browser-capability/test/tab-policy.test.ts | 默认 |
| browser.sources | contract | browser-capability | packages/browser-capability/test/collect-page-source.test.ts | 默认 |
| platform.sources | contract | platform | packages/platform/test/project-source-store.test.ts | 默认 |
| video.sources | contract | feature-video | packages/feature-video/test/studio-sources.test.ts | 默认 |
| browser.host-contract | contract | browser-capability | packages/browser-capability/test/browser-host.test.ts | 默认 |
| dsh.dsh-runtime | contract | harness-dsh | packages/harness-dsh/test/dsh-runtime.test.ts | 默认 |
| dsh.dsh-transport | contract | harness-dsh | packages/harness-dsh/test/dsh-transport.test.ts | 默认 |
| dsh.dsh-preset | contract | harness-dsh | packages/harness-dsh/test/dsh-preset.test.ts | 默认 |
| dsh.browser-failure-guard | unit | harness-dsh | packages/harness-dsh/test/browser-failure-guard.test.ts | 默认 |
| dsh.workspace-context | contract | harness-dsh | packages/harness-dsh/test/workspace-context.test.ts | 默认 |
| dsh.video-case-log | unit | harness-dsh | packages/harness-dsh/test/video-case-log.test.ts | 默认 |
| media.controller | contract | media-native | packages/media-native/test/media-controller.test.ts | 默认 |
| media.processing | contract | media-native | packages/media-native/test/media-processing.test.ts | 默认 |
| media.production | contract | media-native | packages/media-native/test/video-production.test.ts | 默认 |
| media.options | unit | media-native | packages/media-native/test/video-options.test.ts | 默认 |
| media.scene-clock | media | media-native, feature-video | scripts/scene-clock-smoke.ts | 默认 |
| media.speech | contract | media-native | packages/media-native/test/speech.test.ts | 默认 |
| media.port-contract | contract | media-native | packages/media-native/test/media-port.test.ts | 默认 |
| platform.projects | unit | platform | packages/platform/test/project-store.test.ts | 默认 |
| platform.settings | unit | platform | packages/platform/test/global-settings-store.test.ts | 默认 |
| platform.schedules | unit | platform | packages/platform/test/scheduled-task-store.test.ts | 默认 |
| platform.state | contract | platform | packages/platform/test/state-load.test.ts | 默认 |
| platform.layout | unit | platform | packages/platform/test/layout-store.test.ts | 默认 |
| platform.docking | unit | platform | packages/platform/test/layout-docking.test.ts | 默认 |
| platform.permissions | unit | platform | packages/platform/test/permission-policy.test.ts | 默认 |
| platform.menu | unit | platform | packages/platform/test/menu-policy.test.ts | 默认 |
| platform.restart | unit | platform | packages/platform/test/restart-policy.test.ts | 默认 |
| platform.continuity | contract | platform | packages/platform/test/session-continuity.test.ts | 默认 |
| platform.user-agent | unit | platform | packages/platform/test/browser-user-agent.test.ts | 默认 |
| platform.project-panel | unit | platform | packages/platform/test/project-panel-layering.test.ts | 默认 |
| platform.driver-binding | contract | platform | packages/platform/test/driver-boundary.test.ts | 默认 |
| platform.catalog | boundary | platform | packages/platform/test/bmw-catalog.test.ts | 默认 |
| platform.boundaries | boundary | platform | packages/platform/test/product-boundaries.test.ts | 默认 |
| platform.remote-boundary | boundary | platform | packages/platform/test/remote-control-boundary.test.ts | 默认 |
| platform.shell-ipc | contract | platform | packages/platform/test/shell-ipc.test.ts | 默认 |
| platform.permission-store | contract | platform | packages/platform/test/permission-store.test.ts | 默认 |
| platform.continuity-state | contract | platform | packages/platform/test/continuity-state.test.ts | 默认 |
| platform.feature-contract | contract | platform | packages/platform/test/feature-contract.test.ts | 默认 |
| video.schema-publication | contract | feature-video, validation | scripts/video-schema-document.ts | 默认 |
| video.schema | contract | feature-video | packages/feature-video/test/video-document.test.ts | 默认 |
| video.materials | unit | feature-video | packages/feature-video/test/studio-materials.test.ts | 默认 |
| video.studio | contract | feature-video | packages/feature-video/test/video-studio.test.ts | 默认 |
| video.settings | contract | feature-video | packages/feature-video/test/video-settings.test.ts | 默认 |
| video.boundary | boundary | feature-video | packages/feature-video/test/video-boundary.test.ts | 默认 |
| architecture.boundaries | boundary | validation | scripts/test/module-boundary.test.ts | 默认 |
| validation.selection | unit | validation | scripts/test/test-selection.test.ts | 默认 |
| api.types | type | validation, platform, agent-contract, browser-capability, media-native, feature-video | scripts/test/public-interfaces.type-test.ts | 默认 |
| sources | media | platform, browser-capability, media-native, feature-video | scripts/source-studio-smoke.ts | 默认 |
| assistant.default | integration | application, platform, agent-contract, agent-ui, harness-dsh, harness-codex, harness-qoder, browser-capability, feature-video | scripts/assistant-default-suite.ts | 默认 |
| assistant.application | integration | platform, agent-contract, agent-ui, browser-capability, feature-video | scripts/assistant-application-smoke.ts | 默认 |
| assistant.schedules | integration | platform, agent-contract, agent-ui, browser-capability, feature-video | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_SCHEDULE_CASE=1 |
| assistant.startup.conversations.retry | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=conversations; BMW_ASSISTANT_STARTUP_SCENARIO=retry |
| assistant.startup.conversations.exit | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=conversations; BMW_ASSISTANT_STARTUP_SCENARIO=exit |
| assistant.startup.preferences.retry | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=preferences; BMW_ASSISTANT_STARTUP_SCENARIO=retry |
| assistant.startup.preferences.exit | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=preferences; BMW_ASSISTANT_STARTUP_SCENARIO=exit |
| assistant.startup.history.retry | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=history; BMW_ASSISTANT_STARTUP_SCENARIO=retry |
| assistant.startup.history.exit | integration | platform, agent-contract, agent-ui | scripts/assistant-application-smoke.ts | BMW_ASSISTANT_STARTUP_KIND=history; BMW_ASSISTANT_STARTUP_SCENARIO=exit |
| driver | integration | platform, agent-contract, browser-capability | scripts/agent-driver-smoke.ts | 默认 |
| startup-recovery | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_SCENARIO=retry |
| startup-exit | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_SCENARIO=exit |
| startup.permissions.retry | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=permissions; BMW_STATE_STARTUP_SCENARIO=retry |
| startup.permissions.exit | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=permissions; BMW_STATE_STARTUP_SCENARIO=exit |
| startup.layout.retry | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=layout; BMW_STATE_STARTUP_SCENARIO=retry |
| startup.layout.exit | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=layout; BMW_STATE_STARTUP_SCENARIO=exit |
| startup.continuity-config.retry | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=continuity-config; BMW_STATE_STARTUP_SCENARIO=retry |
| startup.continuity-config.exit | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=continuity-config; BMW_STATE_STARTUP_SCENARIO=exit |
| startup.continuity-snapshot.retry | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=continuity-snapshot; BMW_STATE_STARTUP_SCENARIO=retry |
| startup.continuity-snapshot.exit | integration | platform | scripts/state-load-smoke.ts | BMW_STATE_STARTUP_KIND=continuity-snapshot; BMW_STATE_STARTUP_SCENARIO=exit |
| dsh | integration | harness-dsh, agent-contract | scripts/dsh-compatibility-smoke.ts | 默认 |
| desktop.workspace | desktop | platform, harness-dsh, browser-capability, feature-video | scripts/desktop-smoke.ts | group=workspace |
| desktop.projects | desktop | platform, harness-dsh, browser-capability, feature-video | scripts/desktop-smoke.ts | group=projects |
| desktop.settings | desktop | platform, harness-dsh, browser-capability, feature-video | scripts/desktop-smoke.ts | group=settings |
| desktop.native | desktop | platform, harness-dsh, browser-capability, feature-video | scripts/desktop-smoke.ts | group=native |
| studio.next | integration | feature-video, media-native | scripts/studio-next-smoke.ts | 默认 |
| studio.schema | desktop | platform, feature-video, media-native, browser-capability | scripts/video-studio-smoke.ts | BMW_STUDIO_SCHEMA_CASE=1 |
| studio.workflow-entry | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_WORKFLOW_ENTRY_CASE=1 |
| studio.materials-entry | desktop | platform, feature-video, browser-capability | scripts/video-studio-smoke.ts | BMW_STUDIO_MATERIALS_ENTRY_CASE=1 |
| studio.visual-effects | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_VISUAL_EFFECTS_CASE=1 |
| studio.main-mute | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_MAIN_MUTE_CASE=1 |
| studio.track-menu | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_TRACK_MENU_CASE=1 |
| studio.card-text | desktop | feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_CARD_TEXT_CASE=1 |
| studio.news-options | desktop | feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_NEWS_OPTIONS_CASE=1 |
| studio.card-pair | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_CARD_PAIR_CASE=1 |
| studio.reference-analysis | desktop | platform, feature-video, media-native, browser-capability | scripts/video-studio-smoke.ts | BMW_STUDIO_REFERENCE_CASE=1 |
| studio.review-adoption | desktop | platform, feature-video, media-native, browser-capability | scripts/video-studio-smoke.ts | BMW_STUDIO_REVIEW_CASE=1 |
| studio.production-recovery | desktop | platform, feature-video, media-native, browser-capability | scripts/video-studio-smoke.ts | BMW_STUDIO_PRODUCTION_RECOVERY_CASE=1 |
| studio.bound-scene-split | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_BOUND_SCENE_CASE=1 |
| studio.whole-scene-split | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_WHOLE_SCENE_CASE=1 |
| studio.approved-history | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_SNAPSHOT_CASE=1 |
| studio.source-caption-rebind | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_SOURCE_REBIND_CASE=1 |
| studio.layer-fade-continuity | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_LAYER_FADE_CASE=1 |
| studio.workspace-resume | desktop | platform, feature-video, media-native | scripts/video-studio-smoke.ts | BMW_STUDIO_RESUME_CASE=1 |
| studio | integration | feature-video, media-native | scripts/video-studio-smoke.ts | 默认 |
| browser.background | integration | browser-capability | scripts/browser-background-smoke.ts | 默认 |
| media.capture | media | media-native, browser-capability | scripts/media-capture-smoke.ts | 默认 |
| media.processing-runtime | media | media-native | scripts/media-processing-smoke.ts | 默认 |
| video | media | media-native, feature-video | scripts/video-production-smoke.ts | 默认 |
| speech | media | media-native | scripts/speech-alignment-smoke.ts | 默认 |
| localNarration | media | media-native | scripts/narration-smoke.ts | BMW_TTS_TEST_PROVIDER=local-matcha |
| external.assistant.qoder-cn | external (opt-in) | agent-ui, platform, browser-capability, feature-video, harness-qoder, harness-codex, harness-dsh | scripts/native-assistant-case.ts | BMW_NATIVE_DRIVER=qoder-cn; opt-in: BMW_NATIVE_DRIVER=qoder-cn |
| external.assistant.codex | external (opt-in) | agent-ui, platform, browser-capability, feature-video, harness-qoder, harness-codex, harness-dsh | scripts/native-assistant-case.ts | BMW_NATIVE_DRIVER=codex; opt-in: BMW_NATIVE_DRIVER=codex |
| external.assistant.dsh | external (opt-in) | agent-ui, platform, browser-capability, feature-video, harness-qoder, harness-codex, harness-dsh | scripts/native-assistant-case.ts | BMW_NATIVE_DRIVER=dsh; opt-in: BMW_NATIVE_DRIVER=dsh |
| external.vision | external (opt-in) | browser-capability, harness-dsh | scripts/vision-model-smoke.ts | opt-in: BMW_VISION_TEST=1 |
| external.edge | external (opt-in) | media-native | scripts/narration-smoke.ts | BMW_TTS_TEST_PROVIDER=edge; opt-in: BMW_TTS_TEST_PROVIDER=edge |

<!-- END GENERATED MODULE CONTRACTS -->
