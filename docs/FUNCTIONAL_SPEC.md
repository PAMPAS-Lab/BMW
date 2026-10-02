# BMW 功能说明书

文档版本：0.1.0

最后更新：2026-10-02

适用仓库/产品：BMW（产品家族仅 BMW 与 BMWDev）

## 1. 文档定位与维护规则

本文件是 BMW 独立仓库 的权威功能清单、产品边界说明和测试保障索引。它描述当前仓库中已经实现并可从产品组合中获得的能力；规划项必须明确标为“边界已建”或“未实现”，不能与已交付功能混写。

覆盖标记的含义：

- **直接单测**：存在针对该行为或领域规则的自动化测试，表中给出测试文件和 `test(...)` 名称。
- **契约/间接**：测试覆盖 Action Catalog、产品组合或底层契约，但没有直接驱动完整用户界面或真实外部服务。
- **无直接单测**：代码已经实现，但当前没有足以证明该行为的专门自动化测试，需要人工验证。
- **边界已建**：只建立了产品、Feature 或命名空间边界，尚未交付完整业务能力。

维护要求：

1. 新增、修改、移除用户功能或 Browser Action 时，同一提交必须更新本文对应人工条目。
2. 新增、改名、移动或删除测试文件/测试函数后运行 `npm run docs:features`，提交自动刷新后的文末清单。
3. `npm run check` 会执行 `npm run check:features`；清单与源码不一致时检查失败。
4. 没有直接测试的能力必须继续标明“无直接单测”，直至补齐测试，不能用无关测试代替。
5. 文末两个注释标记之间为生成区，禁止手工编辑。

## 2. 产品定位与组合

本仓库只有 `bmw` App。BMWVideo 的产品简称为 BMW（id bmw）；BMWDev 继承完整 BMW 基础（id bmw-dev）。二者独立 repo、lockfile、Profile 和 DSH Home，不从另一 checkout 读取运行时代码。旧三产品架构已退休。

本产品包含浏览器/媒体核心和 Video Feature 扩展边界，不包含 Dev/WVL。

**直接测试**：`packages/platform/test/product-boundaries.test.ts` — `BMW repository builds one app with an inherited Video foundation`、`shared implementations never import apps or Dev capabilities`；MCP Catalog 使用认证 Bridge，不再反向 import App。MCP 边界仍校验唯一 tool 名、Schema、required action 与字符串 enum；直接测试：`packages/browser-capability/test/mcp-tool-catalog.test.ts` — `MCP catalog admission rejects extra tools and malformed action boundaries`。

## 3. 共享平台与 Agent 基础

| 编号 | 功能 | 行为与边界 | 覆盖与对应测试 |
|---|---|---|---|
| P-01 | DSH 唯一 Harness | BMW 启动并复用本机 DSH，通过 BMW 管理的 Preset、Home、Workspace 和 Session 工作；BMW 不实现第二套 Agent Loop。当前适配 DSH `0.2.0-rc.2`：启动使用官方 token/cookie 鉴权，日志隐藏 token；Workspace/Session 历史通过 `/api/remote.mux` 的官方 WebSocket opening snapshot 读取，收到快照即取消订阅；操作调用使用新版斜杠端点与命名参数。 | **直接单测**：`packages/harness-dsh/test/dsh-runtime.test.ts` — `DSH calls use the harness RPC envelope and validate the response`；`BMW creates new DSH sessions with the browser-only preset` |
| P-02 | HarnessPort 解耦 | 业务通过稳定端口执行健康检查、Session 操作、取消、事件订阅与能力探测，不直接散落依赖 DSH RPC。 | **直接单测**：`packages/harness-dsh/test/harness-port.test.ts` — `HarnessPort delegates runtime operations through a stable BMW interface`；`HarnessPort owns health, cancellation and runtime event subscriptions` |
| P-03 | DSH Preset 安装与升级隔离 | BMW 只安装/更新自己拥有的 Preset 与插件目录；不覆盖非 BMW 目录。产品 DSH Home 隔离，Credential 采用链接而非复制。通过官方 `dsh-agent-preset` 插件注册隔离预设，本仓库不安装 WVL 客户端。 | **直接单测**：`packages/harness-dsh/test/dsh-preset.test.ts` — `installs and safely updates only the BMW DSH preset`；`does not overwrite a preset directory not owned by BMW`；`isolates product state while linking rather than copying DSH credentials` |
| P-04 | 单一 Browser Tool | 本产品 MCP `tools/list` 均只返回一个 `browser` Tool；产品差异体现在其 Action enum。DSH 官方 MCP Client 仍负责连接、执行和回收；BMW 适配器把 `mcp__browser__browser` 注册名恢复为 `browser`，拒绝任何额外工具。 | **直接单测**：`packages/browser-capability/test/mcp-tool-catalog.test.ts` — `BMW MCP discovers exactly browser from the authenticated product catalog` |
| P-05 | Browser Action 注册表 | Core 与 Feature Action 在启动时组合；重名直接失败。MCP 对外暴露产品专属 Schema，核心请求至少校验对象类型和 Action，具体参数再由各 Handler 做运行时校验。 | **直接单测**：`packages/platform/test/product-boundaries.test.ts` — `feature action collisions fail before Electron startup`；`packages/browser-capability/test/browser-schema.test.ts` — `accepts every declared browser action`、`rejects unsupported and malformed requests` |
| P-06 | 产品继承与独立仓库 | BMW 不含 Dev/WVL；BMWDev 继承 BMW 的 Video 基础，并添加 Web Runtime/WVL；独立 Profile/Partition/Preset。 | **直接单测**：`packages/platform/test/product-boundaries.test.ts` — `BMW repository builds one app with an inherited Video foundation`、`shared implementations never import apps or Dev capabilities` |
| P-07 | 标准 Chromium 身份 | 页面 User-Agent 去除 Electron/BMW 产品标记，保留标准 Chrome 身份；不伪造浏览器外的额外能力。 | **直接单测**：`packages/platform/test/browser-user-agent.test.ts` — `page user agent exposes Chromium without Electron or BMW shell tokens`；`page user agent strips every BMW product brand and preserves standard Chrome` |
| P-08 | 首次启动 | 新 Profile 必须创建第一个真实 Project；Home URL 可空并使用 `about:blank`，随后选择侧栏或浮层布局。 | **直接单测**：`packages/platform/test/project-store.test.ts` — `requires the first real Project name without leaving a default BMW Browser project`；`new projects accept an empty home URL and use a blank-page preference`。布局选择由 `packages/platform/test/layout-store.test.ts` — `layout setup is required once and defaults to the sidebar` 保障 |
| P-09 | 显式导入适配契约 | 公共 ProfileImporter 供 BMWDev 继承使用。BMW 自身是导入来源，不显示 Import from BMW，不自动合并旧 BMWVideo Profile。公共导入过滤规则使用临时目标夹具测试，不能称 BMW 导入 UI 已启用。 | **适配契约测试**：`packages/platform/test/product-profile-importer.test.ts` — `profile import preview exposes selectable data, not secrets or DSH execution state`、`cookie import restores only explicitly selected origins and enables target re-encryption`；BMW 无导入 UI能力 |

DSH 新协议的直接契约测试在 `packages/harness-dsh/test/dsh-transport.test.ts`，覆盖鉴权 URL 边界、命名参数、请求关联、WebSocket cookie/取消/错误帧、单一工具注册。`npm run test:dsh-e2e` 使用临时 DSH Home 和临时 Workspace 验证本仓库产品启动、会话复用/改名/搜索/历史/空会话 Fork 拒绝/取消/归档；不访问真实用户 Profile，不调用付费模型。真实模型输出和完整浏览器 UI 交互仍需人工验证，不能由上述兼容性检查推定覆盖。

### 3.0 Browser Session 生命周期、串行化与图像结果

DSH 官方 MCP Client 继续拥有连接、重连、取消与图像附件存储。BMW 在工具执行时从真实 `execution.agent.session.header` 提取 Session ID 和 cwd，由受鉴权 Bridge 映射到尚未归档的 Project，发放随机绑定。身份不出现在模型 Schema；模型参数中伪造的内部字段会被可信适配器覆盖。每个活跃 Agent 的绑定在插件销毁时撤销，重连复用当前绑定，Fork/重新加载获得新绑定。尚未激活对应 Project 的调用被拒绝，不能按全局当前 Project 静默重定向。

Bridge 的浏览器调用按 FIFO 串行（比仅按 Project 更严格，因为当前 Electron 窗口共用展示上下文）；Kernel 也串行处理普通 Agent/用户命令。公共 Kernel 留有可信 Feature 内部 test 步骤的重入执行边界；BMW 无 WVL Feature。调用期间拒绝切换、导入、创建和归档 Project；这些 Project 变更的完整异步过程也占用互斥边界，完成前拒绝新的浏览器调用。Session 撤销或 MCP 取消阻止未开始的操作；已经送达网页的操作不会被强行回滚，关闭 Bridge 等待其收尾。Project 页面、登录与媒体 Artifact 保留，Session 生命周期不自动删除用户页面。不同 Session 仍共享同一 Project 页面，不新增 Session Cookie 分区。

`media.screenshot` 与 `page.diagnostics` 在保留 Artifact 元数据的同时返回 MCP PNG image block；Bridge 只读取该次截图结果、验证真实路径归属 Project artifacts、PNG 签名及 20 MiB 大小上限，无任意文件读取 Action。DSH 官方 Client 再进行自身模型图像准入和持久化；被 DSH 图像策略拒绝时由上游投影诊断文字，不能承诺模型一定获得每幅图像。

**直接自动化覆盖**：`packages/browser-capability/test/session-operations.test.ts` — `Session operations serialize, recheck admission and recover after failure`、`Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images`（包括真实 stdio MCP 图像结果）；`packages/harness-dsh/test/dsh-transport.test.ts` — `BMW injects trusted Session identity after model arguments while preserving execution context`。实际付费模型视觉理解、真实 DSH Session 销毁后的绑定撤销、所有 Electron IPC Project 变更入口没有独立完整 E2E 覆盖，不由上述单测推定。

### 3.1 官方 DSH Desktop 复用评估（0.2.0-rc.2）

结论：官方桌面实现可作为后续启动、通信和打包底座的参考或源码复用对象，不能直接作为 BMW 的替换组件。当前实现仍是 BMW 产品壳 + 官方 DSH Web/Remote 协议；本次没有宣称已迁移至 DSH Desktop。

核对固定 Release 源码，而非混用 master 或第三方同名项目：官方 [`apps/desktop/package.json`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/package.json) 把桌面应用标为 private；[架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/architecture.md) 描述完整 Electron 产品、私有 Desktop Host、独占的 desktop Profile、签名资源内的精确 DSH Runtime。其 `dsh-app://app/` 页面仍通过经过鉴权的 Web Host HTTP/WebSocket 通信，Node IPC 负责启动与生命周期；并非无需本地服务的第二套 Harness。

| 范围 | 官方 Desktop 已有实现 | BMW 需要保留/适配的差异 | 判断 |
|---|---|---|---|
| Harness 与协议 | 同一个 DSH Web 应用和官方 Remote 协议 | 隔离产品 Preset、恰好一个 `browser` Tool | 可以继续复用，目前已使用相同官方协议 |
| 桌面启动与资源 | Electron Node 子进程、打包页面、自定义协议、就绪/错误/退出通知 | 当前 BMW 用系统 `dsh`、产品独立 Home、Agent WebContentsView | 适合分阶段迁移；需要固定 Runtime 资源与 Host 契约 |
| 浏览器 Tab | Sidebar webview guest | BMW 管理 Project-owned Tab、弹窗、页面保存、权限与 Artifact | 不能直接替换 BrowserKernel |
| 浏览器状态与媒体 | 随进程存活的随机 Workspace 分区；禁止 guest 下载及屏幕捕获权限 | 持久分区、按 Origin 加密 Cookie 连续性、下载、截图、录屏和视频 Capture | 必须保留 BMW Browser/Media 实现或逐项移植 |
| Product UI | 官方 Workspace、Session、Settings、插件管理与桌面生命周期 | BMW Project 文档、Session Center、浮层、计划任务和两产品独立 | 完整替换属于产品 UI 重构，不是启动参数改动 |
| 更新与插件 | Shell 与精确 Runtime 作为一个签名更新单元 | BMW 自有品牌、发布渠道和独立数据目录 | 需要 BMW 发布流水线，不能沿用上游更新身份 |

浏览器差异直接来自官方 [`browser-guests.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/apps/desktop/src/browser-guests.ts)：分区名不带 `persist:`，`setDisplayMediaRequestHandler` 返回空授权，`will-download` 阻止下载。这里的限制属于官方 guest 设计，不是 DSH Agent 本身缺少媒体能力。

建议迁移顺序：先将 HarnessPort 后的启动适配独立成桌面 Runtime Carrier，逐步替换系统 CLI 依赖；再引入 BMW 自有安全协议和打包页面，保留官方 HTTP/WebSocket Remote；最后复用窗口生命周期、崩溃恢复与打包机制。BrowserKernel、MediaController、Project/Session 权限边界和两产品 Feature Graph 始终保留。每一阶段以临时 Profile 验证单 Tool、状态隔离、媒体、Session 和重启恢复，再决定是否切换默认载体。

**验证状态**：源码评估；尚未构建或运行官方 Desktop，也未交付 Runtime Carrier、自定义协议或新版签名安装包。官方 Electron 依赖与 BMW 当前版本不同，需单独验证兼容性。独立远程/移动端控制属于后续模块，不借用官方 desktop IPC 作为网络接口。

## 4. BMW 浏览器与研究能力

### 4.1 Browser Actions

| 编号 | Action/功能 | 用户可获得的行为 | 覆盖与对应测试 |
|---|---|---|---|
| B-01 | `status` | 读取当前产品、Project、激活 Tab 与浏览器状态。 | **契约/间接**：`packages/browser-capability/test/browser-schema.test.ts` — `accepts every declared browser action`；无直接状态内容单测 |
| B-02 | `tabs.list`、`tabs.open`、`tabs.show`、`tabs.close` | 列出、后台/前台打开、显示和关闭当前 Project 的 Tab；Agent 打开的 Tab 默认复用，避免污染用户 Tab。 | **直接单测**：`packages/browser-capability/test/tab-policy.test.ts` — `Agent tab reuse prefers an exact URL without navigating`；`Agent tab reuse navigates the most recent same-origin Agent tab but not a user tab`；`Agent tab cap closes only least-recent background Agent tabs` |
| B-03 | 页面 Popup 归属 | 页面发起的新窗口不会启动外部浏览器，而是转成当前 Project 的 BMW 前台 Tab。第三方（包括 Google）仍可基于嵌入式浏览器环境实施自己的登录风控。 | **无直接单测**：当前需人工验证 Popup、OAuth 回跳与真实账号风控 |
| B-04 | `navigate`、`back`、`forward`、`reload` | 在 Project-owned Tab 内导航、前进、后退和刷新。 | **契约/间接**：`packages/browser-capability/test/browser-schema.test.ts`；当前无逐项导航单测 |
| B-05 | `observe` | 读取视口、整页、后台或观察模式下的页面结构和可见文本，并限制返回字符数。 | **契约/间接**：Action Schema 有测试；当前无真实页面语义观察单测 |
| B-06 | `click`、`type`、`hover`、`key`、`wait` | 通过选择器/可见文本交互，输入字段、悬停、发键盘事件和执行有界等待。 | **契约/间接**：`packages/browser-capability/test/browser-schema.test.ts` — `rejects unsupported and malformed requests`。当前无 Electron 页面交互单测 |
| B-07 | `page.diagnostics` | 收集目标页面 Console 与网络失败诊断，并返回截图 image/Artifact；作为公共能力可被 BMWDev 继承。 | **契约/间接**：Browser Schema/Catalog 覆盖 Action 声明；本仓无独立真实页面 Console/Network 诊断测试，不引用 BMWDev 的 WVL 测试作为本产品直接覆盖 |
| B-08 | `page.viewport.set` | 设置宽、高、缩放与移动视口，支持响应式观察和验证。 | **契约/间接**：Action Schema 有测试；当前无 Electron 视口效果单测 |
| B-09 | `project.context` | 向 Agent 提供当前 Project 元数据及 AGENTS/Memory/Tasks 上下文。 | **契约/间接**：`packages/platform/test/project-store.test.ts` 保障文档边界；无 Browser Action 返回值专门测试 |
| B-10 | `project.memory.append`、`project.tasks.append` | 仅向 Project Memory/Tasks 追加带来源时间的信息，不允许任意文件写入。 | **直接单测**：`packages/platform/test/project-store.test.ts` — `agent append is limited to memory documents and records provenance time` |

### 4.2 原生媒体

| 编号 | Action/功能 | 用户可获得的行为 | 覆盖与对应测试 |
|---|---|---|---|
| M-01 | `page.media.list` | 从页面、选定元素和已观察网络响应中发现图片、视频源、Poster 等媒体 URL。 | **契约/间接**：Action Schema 有测试；当前无真实媒体页面发现单测 |
| M-02 | `media.screenshot` | 对视口、整页、后台页面或指定元素生成 Project-owned 截图 Artifact；支持选择器和匹配序号。 | **契约/间接**：BMW Catalog 与 Schema 覆盖 Action 存在；当前无截图像素/区域单测 |
| M-03 | `media.download` | 使用 BMW 浏览器 Session 下载 HTTP(S) 媒体到当前 Project Artifact；限制大小、清理文件名、推断扩展名并拒绝 DASH 初始化碎片。 | **直接单测**：`packages/browser-capability/test/media-artifact.test.ts` — `media download writes a bounded Project artifact through the browser fetch adapter`；`media download rejects non-web URLs and responses beyond its byte limit`；`artifact filenames remove path syntax and infer media extensions`；`media download rejects and removes DASH initialization fragments` |
| M-04 | `media.video.capture` | 对页面中的 `HTMLVideoElement` 使用 `captureStream()` + `MediaRecorder` 保存完整、可播放的 WebM；默认从头录制，时长上限 30 分钟，数据上限 512 MB，按序写入分段并校验 WebM。 | **直接单测 + Electron E2E**：`packages/media-native/test/media-controller.test.ts` — `browser-native video capture filenames remain Project-local WebM artifacts`、`video chunk decoding ignores commas inside codec parameters`；人工/本地 E2E 命令 `npm run test:media-e2e` |
| M-05 | `media.record.start`、`media.record.stop` | 录制当前 Tab 的画面/音频为 Project-owned WebM；媒体处理优先走 WebGPU Canvas 管线，不可用时回退 CPU/原始流。 | **契约/间接**：`packages/media-native/test/media-controller.test.ts` 覆盖 Artifact 命名边界；当前无完整 start/stop 单元测试，可用 `npm run test:media-e2e` 做本地 Electron 验证 |
| M-06 | BMW 媒体查看器 | 截图、录屏与下载媒体在 BMW 自有窗口/Tab 查看，不启动外部浏览器。 | **无直接单测**：需人工验证窗口与媒体播放 |

## 5. Projects、Sessions、设置与桌面体验

| 编号 | 功能 | 行为与边界 | 覆盖与对应测试 |
|---|---|---|---|
| U-01 | Project 创建/切换/更新/归档 | 左上角可快速下拉切换；Project Manager 负责创建、编辑和归档。归档不删除项目文件。 | **直接单测**：`packages/platform/test/project-store.test.ts` — `creates, switches, updates and archives projects without deleting their files` |
| U-02 | Project 文档 | 每项目持有独立 AGENTS、Memory、Tasks 等文档；项目目录和 Connector Binding 隔离。 | **直接单测**：`packages/platform/test/project-store.test.ts` — `agent append is limited to memory documents and records provenance time`；`connector bindings are isolated per project` |
| U-03 | Tab 状态恢复 | 保存有界数量的 HTTP(S) Tab 元数据，避免把不安全/无关 URL 写入 Project。 | **直接单测**：`packages/platform/test/project-store.test.ts` — `tab state keeps only bounded HTTP(S) URLs` |
| U-04 | Project Manager 层级 | 浏览器 Tab View 变化后，已打开的 Project Manager 会重新置顶，不被内容页遮挡。 | **直接单测**：`packages/platform/test/project-panel-layering.test.ts` — `an open Project Manager is re-raised after browser tab views change` |
| U-05 | Project-scoped DSH Session | 激活 Project 时创建或复用其持久 Session；Shell 与 DSH 显示同一 Project。 | **直接单测**：`packages/harness-dsh/test/dsh-runtime.test.ts` — `DSH project activation creates a project-scoped BMW session`；`DSH project activation reuses its persistent project session` |
| U-06 | Session Center | 按当前 Project 列表/搜索 Session，并支持创建、选择、改名、Fork、归档和顺序移动。产品独立 SQLite 索引在首次内容搜索时打开；会话创建使用各自产品预设。 | **直接单测/部分间接**：`packages/harness-dsh/test/dsh-runtime.test.ts` — `BMW Session Center lists only active sessions in its Project and searches content`、`BMW creates new DSH sessions with the browser-only preset`；改名/Fork/移动的 IPC UI 无逐项单测 |
| U-07 | DSH Sidebar 覆盖 | BMW Shell 覆盖常用 Project、Session 与设置入口；DSH 原 Sidebar 默认隐藏，可在高级设置启用兼容回退。 | **直接单测/部分间接**：`packages/platform/test/global-settings-store.test.ts` — `legacy DSH Sidebar is an explicit global compatibility fallback`；完整 UI 入口需人工验证 |
| U-08 | 侧栏/浮层布局 | 首次选择 DSH 侧栏或浮层；浮层可移动、缩放、全屏和设置透明度；拖到右上角可 Dock，点击状态行可回到浮层。 | **直接单测/部分间接**：`packages/platform/test/layout-store.test.ts` — `floating DSH settings persist with bounded size and supported opacity`；`packages/platform/test/layout-docking.test.ts` — `floating DSH docks when its upper-right corner reaches the target corner`、`floating DSH does not dock near only one target edge`、`dock detection rejects invalid window bounds`。拖拽 UI 需人工验证 |
| U-09 | 统一主题 | BMW Shell 与 DSH 共享 `system`/`light`/`dark` 配置；网页自身主题只在网站支持或 BMW 可注入适配时变化。 | **直接单测/部分间接**：`packages/platform/test/global-settings-store.test.ts` — `global appearance accepts one shared dark, light or system theme`；网页视觉跟随需人工验证 |
| U-10 | 代理与搜索引擎 | 默认使用系统代理；可配置手动代理。默认 Google，可选其他引擎或带查询占位符的 HTTP(S) 自定义模板。 | **直接单测**：`packages/platform/test/global-settings-store.test.ts` — `global settings default to system proxy and Google search`；`global settings persist manual proxy and generate selected search URLs`；`custom search templates require HTTP(S) and a query placeholder`；`proxy settings apply to the persistent BMW browser session` |
| U-11 | Browser Permission | 无害展示权限静默允许，敏感浏览器能力只提示一次，噪声/环境权限拒绝。Agent Control 由用户明确开启。 | **直接单测/部分间接**：`packages/platform/test/permission-policy.test.ts` — `denies noisy ambient site permissions without prompting`；`prompts once only for sensitive browser capabilities`；`allows harmless presentation capabilities silently` |
| U-12 | Cookie/Session 连续性 | 用户按 Origin 显式开启后，用 OS Keychain 加密 Cookie 快照并在重启恢复；关闭连续性只删快照，不清实时 Cookie。 | **直接单测**：`packages/platform/test/session-continuity.test.ts` — `encrypts and restores session cookies only for explicitly enabled origins`；`disabling continuity removes the encrypted snapshot without clearing live cookies`；`cookie matching includes parent-domain cookies but excludes unrelated sites` |
| U-13 | 后台智能保活 | 对已启用 Origin 优先发送 HEAD；拒绝 HEAD 时执行有界 GET，避免无界后台访问。 | **直接单测**：`packages/platform/test/session-continuity.test.ts` — `background keepalive uses HEAD first for an enabled origin`；`background keepalive falls back to a bounded GET when a site rejects HEAD` |
| U-14 | 页面保存与键盘菜单 | 页面聚焦时支持平台保存快捷键和完整/单文件保存；DSH 聚焦时不误激活页面保存。键盘菜单激活不抢占带修饰键的页面快捷键。 | **直接单测**：`packages/platform/test/menu-policy.test.ts` — `builds safe webpage filenames and selects complete or single-file saves`；`recognizes keyboard menu activation without stealing modified page shortcuts`；`recognizes only the platform save-page accelerator` |
| U-15 | DSH 自然语言创建每日任务 | 用户可直接在 DSH 描述“每天几点做什么”；Agent 通过 `schedule.create` 保存完整 Prompt、`HH:mm` 时间和 IANA 时区。`schedule.list`、`schedule.update`、`schedule.remove`、`schedule.run` 用于查询、启停、修改、删除和立即运行。 | **直接单测/契约**：`packages/platform/test/scheduled-task-store.test.ts` — `daily scheduled tasks use their IANA time zone and survive restart`；Browser Action 存在性由 `packages/browser-capability/test/browser-schema.test.ts` 与 Catalog 测试保障 |
| U-16 | Project/Session 绑定与后台执行 | 任务绑定创建时 Project 和 DSH Session，到点后串行恢复该上下文；DSH 仍只使用 `browser` Tool，并优先在后台 Tab 完成网页截图、媒体下载等工作。运行期间阻止切换/归档 Project，结束后恢复用户原 Project。 | **直接单测/部分间接**：`packages/platform/test/scheduled-task-store.test.ts` — `scheduled task runs are project isolated, durable, and recover interruption`、`scheduler serializes due and manual DSH task execution`；实际 DSH/网页后台执行需 Electron 人工验证 |
| U-17 | 重启、错过执行与历史 | BMW 重启后保留任务；正在执行的 Run 标为 `interrupted`，已排队 Run 恢复。应用退出或系统休眠期间错过多个周期时只补跑一次，再计算下一天。Scheduled 面板显示启停、下次运行、最近状态，并提供 Run now/Delete；终态发系统通知。macOS 可关闭/隐藏或最小化主窗口而保持调度，显式 Quit 才停止。 | **直接单测/部分间接**：`packages/platform/test/scheduled-task-store.test.ts` 覆盖持久化、中断恢复、串行队列和运行结果；面板、窗口隐藏与系统通知需人工验证。BMW 进程必须保持运行，不能承诺在完全退出时唤醒系统执行 |
| U-18 | 产品内安全重启 | Settings 与系统应用菜单可重启当前 BMW/BMWDev。重启复用同一产品 Profile、Project、Tab 元数据、已保存的登录连续性、DSH Session 和布局；退出前停止调度器、DSH、Bridge、Session 保活和产品 Feature。正在录制媒体、执行定时任务或运行 WVL 时拒绝重启；普通 DSH 回复运行中会明确警告可能被中断。 | **直接单测/部分间接**：`packages/platform/test/restart-policy.test.ts` — `allows restart when BMW has no active non-durable work`、`blocks restart while media, scheduled tasks, or WVL execution is active`；Electron `app.relaunch()`、菜单/Settings IPC、同 Profile 恢复需临时 Profile E2E 或人工验证 |

## 6. 远程控制与聊天软件边界

两个新仓库均不包含 connector-feishu 源码或 SDK，默认无聊天软件 Actions/UI/IPC/Relay。旧用户数据保持原状。独立远控/移动端未实现。

**直接测试**：`packages/platform/test/remote-control-boundary.test.ts` — `default products reject chat connector actions and retain one browser tool`、`default desktop exposes no Feishu UI, IPC or automatic relay startup`。

## 7. 视频制作边界（BMWVideo 简称 BMW）

Video Feature 是两个产品共同基础：BMW 直接组合，BMWDev 继承同一 Feature。当前 browser-native 截图、录屏、媒体下载与视频 Capture 可用；feature-video 的 `video.*` 制作动作仍为空，时间线/剪辑器/成片导出/FFmpeg 未实现。

**契约测试**：`packages/platform/test/bmw-catalog.test.ts` — `BMW exposes research/media actions and the Video extension boundary`；产品继承测试保证 Feature 存在，不代表视频制作已经完成。

## 10. 验证和覆盖边界

每个仓库独立运行 build/check/test/test:boundaries；使用临时数据运行 test:dsh-e2e、test:desktop-e2e、test:media-e2e。不调用付费模型，不检查真实 Profile。真实模型理解、完整交互与所有 IPC 安全面仍按各项覆盖说明保持未验证，不由冒烟推定。

## 11. 当前明确未交付

- BMWVideo 编辑器、时间线、FFmpeg、制作渲染管线。
- 默认捆绑的商业 WebContainer 许可与依赖。
- 安装包、签名/公证、自动更新与发布通道。
- CI 托管的 Electron UI、真实 Google/X 登录、真实飞书和 GPU 多机型 E2E。
- 通用 Shell、任意本机文件系统、通用 FFmpeg CLI 等模型 Tool；这些属于架构禁止项，不是待补功能。

## 12. 自动生成的能力与测试清单

<!-- BEGIN GENERATED CAPABILITY AND TEST INVENTORY -->

> 本区块由 `npm run docs:features` 生成。请修改上方人工维护的功能条目，再刷新本区块；不要手工编辑本区块。

### 当前 Browser Action 清单

- BMW 核心 Browser Actions（31）：`status`、`tabs.list`、`tabs.open`、`tabs.show`、`tabs.close`、`navigate`、`back`、`forward`、`reload`、`observe`、`click`、`type`、`wait`、`key`、`hover`、`page.diagnostics`、`page.media.list`、`page.viewport.set`、`media.screenshot`、`media.download`、`media.video.capture`、`media.record.start`、`media.record.stop`、`project.context`、`project.memory.append`、`project.tasks.append`、`schedule.list`、`schedule.create`、`schedule.update`、`schedule.remove`、`schedule.run`

### 当前自动化测试清单

#### `packages/browser-capability/test/browser-schema.test.ts`

- `accepts every declared browser action`
- `rejects unsupported and malformed requests`
- `returns only string tab ids`

#### `packages/browser-capability/test/mcp-tool-catalog.test.ts`

- `BMW MCP discovers exactly browser from the authenticated product catalog`
- `MCP catalog admission rejects extra tools and malformed action boundaries`

#### `packages/browser-capability/test/media-artifact.test.ts`

- `media download writes a bounded Project artifact through the browser fetch adapter`
- `media download rejects non-web URLs and responses beyond its byte limit`
- `artifact filenames remove path syntax and infer media extensions`
- `media download rejects and removes DASH initialization fragments`

#### `packages/browser-capability/test/session-operations.test.ts`

- `Session operations serialize, recheck admission and recover after failure`
- `Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images`

#### `packages/browser-capability/test/tab-policy.test.ts`

- `Agent tab reuse prefers an exact URL without navigating`
- `Agent tab reuse navigates the most recent same-origin Agent tab but not a user tab`
- `Agent tab cap closes only least-recent background Agent tabs`

#### `packages/harness-dsh/test/dsh-preset.test.ts`

- `installs and safely updates only the BMW DSH preset`
- `does not overwrite a preset directory not owned by BMW`
- `isolates product state while linking rather than copying DSH credentials`
- `keeps BMW as theme source without overwriting unrelated DSH settings`

#### `packages/harness-dsh/test/dsh-runtime.test.ts`

- `DSH calls use the harness RPC envelope and validate the response`
- `DSH project activation creates a project-scoped BMW session`
- `DSH project activation reuses its persistent project session`
- `BMW Session Center lists only active sessions in its Project and searches content`
- `BMW creates new DSH sessions with the browser-only preset`
- `DSH prompt submission preserves exact input and returns every Assistant output in order`

#### `packages/harness-dsh/test/dsh-transport.test.ts`

- `DSH launch authentication accepts only the owned origin and token`
- `DSH requests preserve named arguments and correlate prompt admission`
- `DSH WebSocket snapshots authenticate, cancel streams and reject mismatched frames`
- `BMW keeps exactly browser while delegating MCP execution and cleanup to DSH`
- `DSH command discovery normalizes the official array response and sends authentication`
- `BMW injects trusted Session identity after model arguments while preserving execution context`

#### `packages/harness-dsh/test/harness-port.test.ts`

- `HarnessPort delegates runtime operations through a stable BMW interface`
- `HarnessPort detects WVL commands and client bundle without making them mandatory`
- `HarnessPort owns health, cancellation and runtime event subscriptions`

#### `packages/media-native/test/media-controller.test.ts`

- `browser-native video capture filenames remain Project-local WebM artifacts`
- `video chunk decoding ignores commas inside codec parameters`

#### `packages/platform/test/bmw-catalog.test.ts`

- `BMW exposes research/media actions and the Video extension boundary`

#### `packages/platform/test/browser-user-agent.test.ts`

- `page user agent exposes Chromium without Electron or BMW shell tokens`
- `page user agent strips every BMW product brand and preserves standard Chrome`

#### `packages/platform/test/global-settings-store.test.ts`

- `global settings default to system proxy and Google search`
- `global settings persist manual proxy and generate selected search URLs`
- `global appearance accepts one shared dark, light or system theme`
- `legacy DSH Sidebar is an explicit global compatibility fallback`
- `custom search templates require HTTP(S) and a query placeholder`
- `WebContainer module URL is optional and limited to HTTP(S)`
- `proxy settings apply to the persistent BMW browser session`

#### `packages/platform/test/layout-docking.test.ts`

- `floating DSH docks when its upper-right corner reaches the target corner`
- `floating DSH does not dock near only one target edge`
- `dock detection rejects invalid window bounds`

#### `packages/platform/test/layout-store.test.ts`

- `layout setup is required once and defaults to the sidebar`
- `floating DSH settings persist with bounded size and supported opacity`

#### `packages/platform/test/menu-policy.test.ts`

- `builds safe webpage filenames and selects complete or single-file saves`
- `recognizes keyboard menu activation without stealing modified page shortcuts`
- `recognizes only the platform save-page accelerator`

#### `packages/platform/test/permission-policy.test.ts`

- `denies noisy ambient site permissions without prompting`
- `prompts once only for sensitive browser capabilities`
- `allows harmless presentation capabilities silently`

#### `packages/platform/test/product-boundaries.test.ts`

- `BMW repository builds one app with an inherited Video foundation`
- `feature action collisions fail before Electron startup`
- `shared implementations never import apps or Dev capabilities`
- `BMW catalog retains one browser tool and its expected action boundary`

#### `packages/platform/test/product-profile-importer.test.ts`

- `profile import preview exposes selectable data, not secrets or DSH execution state`
- `explicit import copies selected platform data and moves source only into OPFS`
- `profile importer refuses Project directories outside the Base profile`
- `cookie import restores only explicitly selected origins and enables target re-encryption`

#### `packages/platform/test/project-panel-layering.test.ts`

- `an open Project Manager is re-raised after browser tab views change`

#### `packages/platform/test/project-store.test.ts`

- `requires the first real Project name without leaving a default BMW Browser project`
- `does not send existing BMW installations back through first-project setup`
- `creates, switches, updates and archives projects without deleting their files`
- `new projects accept an empty home URL and use a blank-page preference`
- `agent append is limited to memory documents and records provenance time`
- `tab state keeps only bounded HTTP(S) URLs`
- `connector bindings are isolated per project`
- `new projects have no chat bindings and legacy bindings remain inert data`

#### `packages/platform/test/remote-control-boundary.test.ts`

- `default products reject chat connector actions and retain one browser tool`
- `default desktop exposes no Feishu UI, IPC or automatic relay startup`

#### `packages/platform/test/restart-policy.test.ts`

- `allows restart when BMW has no active non-durable work`
- `blocks restart while media, scheduled tasks, or WVL execution is active`

#### `packages/platform/test/scheduled-task-store.test.ts`

- `daily scheduled tasks use their IANA time zone and survive restart`
- `scheduled task runs are project isolated, durable, and recover interruption`
- `scheduler serializes due and manual DSH task execution`

#### `packages/platform/test/session-continuity.test.ts`

- `encrypts and restores session cookies only for explicitly enabled origins`
- `disabling continuity removes the encrypted snapshot without clearing live cookies`
- `background keepalive uses HEAD first for an enabled origin`
- `background keepalive falls back to a bounded GET when a site rejects HEAD`
- `cookie matching includes parent-domain cookies but excludes unrelated sites`

<!-- END GENERATED CAPABILITY AND TEST INVENTORY -->
