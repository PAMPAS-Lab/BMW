# BMW 功能说明书

Browser is boundary, media is native, web is runtime.

适用实现：本仓库唯一应用 BMW（id `bmw`）。本说明书是当前功能、Schema、权限和测试的权威索引；文末能力/测试清单由源码生成。

## 产品与包边界

| 包 | 责任 |
|---|---|
| apps/bmw | 组合 BMW 产品，默认入口注入三驱动装配和自有 Assistant |
| product-bmw | 浏览器/媒体/视频产品定义，不依赖 DSH |
| agent-contract | 通用 AgentBackend、BMW Project/Session、任务提交、设置及上下文契约 |
| harness-dsh | DSH 进程、官方鉴权/传输、预设、模型配置、插件、私有 Workspace 映射及显式冷历史导出 |
| harness-qoder | 官方 Qoder CN SDK/Worker、有效工具目录准入、原生续聊和事件转换 |
| harness-codex | 官方 Codex App Server、模型目录预检、dynamic browser 回调与原生续聊 |
| agent-ui | BMW 自有 sandbox Assistant 界面，仅暴露可信 Host IPC |
| platform | 桌面 Shell、Project、设置、权限、会话协调、计划任务和应用生命周期 |
| browser-capability | 唯一 browser 工具、Action Catalog、Bridge、浏览器页面操作和图像结果准入 |
| media-native | 原生媒体采集、处理、旁白和合成 |
| feature-video | Project 视频草稿、Studio 手动操作与自然语言操作 |

默认入口装配 DSH `0.2.0-rc.2`、Codex App Server 和 Qoder CN SDK，由各官方运行时拥有 Agent Loop。自有 Assistant、统一设置、显式历史迁移和唯一默认入口已实现。GPT-6 封装时的完整离线快照及三驱动对应型号两轮真实验收通过；后续登录交互完成 32 项局部检查，未重新执行全量或付费模型。各报告的源码与适用范围见 [VERIFICATION.md](VERIFICATION.md)。Codex GPT-6 的独立工具封装与验收见 [实施状态](AGENT_DRIVERS_IMPLEMENTATION.md)。核心只依赖契约，禁止直接依赖具体驱动的 RPC 名、页面存储、DOM 选择器、预设与凭据。DSH 使用官方启动 token/cookie 鉴权，日志脱敏；Workspace 和会话历史通过官方 WebSocket 快照读取，取得快照后取消订阅；修改操作留在驱动内。

驱动装配点为 `apps/bmw/product.ts`。所有驱动必须遵循相同归属契约，不能把 BMW 页面/媒体所有权、权限或任务队列转交给模型。方案见 [AGENT_DRIVER_DESIGN.md](AGENT_DRIVER_DESIGN.md)，实际验收和未完成项见 [AGENT_DRIVERS_IMPLEMENTATION.md](AGENT_DRIVERS_IMPLEMENTATION.md)。

## 自有 Assistant 装配（三官方驱动）

- BMW Session 固定 Project 与 driver，provider Session 是不可替换的原生恢复锚点。空会话先于后端连接出现；切换 driver 选择该驱动的既有活动会话，没有才创建空会话，不复制其他引擎的原生历史。
- Assistant 保存显示消息、事件和输入回执；显示历史不是模型恢复协议。未知投递不自动重发，重启把未完成回执标为 unknown，并显示断连原因。会话索引、偏好和历史全部读取验证后再执行恢复写入；损坏文件保留，启动提供重试/退出。
- Agent 相关 Project/Settings/Conversation/History/Preferences/Schedule 文件统一采用 v2，迁移提交标记为 `agent-data-version.json`。日常启动只接受当前格式；历史 Profile 明确拒绝并提示独立命令，不再执行历史导入、自动字段修补或 legacyImportPending 重试。
- 显式迁移通过 harness-dsh 的独立导出入口，在临时复制的原生 Home 上调用官方 cold session/list、workspace/follow、session/follow/page，冻结 cursor 并完整读取。保留已有 BMW Session ID、原生恢复锚点和显示历史；尚未纳入索引的旧会话按原 ID 导入。已归档且原 Workspace 已移除的 Project 必须由 Session header cwd 证明归属；缺失或跨 Project 身份失败。只导入人类/模型文本，原生 context、私有推理和图片不复制为显示消息，不伪造输入回执。
- History 保存统一 owner `{projectId, driverId, externalSessionId}`，启动验证与索引完全一致后才执行通用崩溃恢复。DSH Workspace 从 Project 文件迁移至 `dsh-home/bmw-project-bindings.json`，新目录或 Workspace 不得静默替换既有映射。迁移命令备份受影响元数据、检查输入/输出与草稿哈希、最后提交标记；写入失败回滚本事务文件，并保留并发修改。操作及恢复见 [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md)。
- apps/bmw 的 createBmwAgentAssembly 装配 DSH、Codex、Qoder CN，默认从实际 BMW userData 派生 `agent-drivers/codex`、`agent-drivers/qoder-cn`，保留 DSH 的 `dsh-home`；物理路径别名及父子目录重叠被拒绝。Codex 公共 CLI 安装可通过正常 PATH、固定应用 CLI 路径或明确的 BMW_CODEX_EXECUTABLE 发现，缺失时设置仍可显示安装状态，不启动模型。每个引擎仍需在输入前通过实际目录门槛。默认入口只使用此装配；旧 DSH Client、Runtime port、DOM context poller 和专用 preload 已移除，全部 Shell/Feature 会话操作进入 BMW Session service。最终真实模型复验与目标工作区验收以实施状态中的实际证据为准。
- 自有 Assistant 设置通过可信闭合 IPC 调用各引擎官方控制 API，不产生模型输入、持久化测试会话或 browser 执行。账号投影与表单 Schema 不含秘密值；密码框在提交、关闭按钮及 Escape 时清空。Codex 浏览器登录、Qoder 官方 CLI 登录、DSH 凭据设置/退出留在适配器内。Qoder CLI 未验证非交互退出，UI 保持该操作禁用。新 Profile 的默认 driver 为 DSH，之后按 Project 保存选择；应用启动不自动发起登录，GUI 首次切换到未读取的 driver 后懒加载登录状态；打开设置只在该 driver 从未尝试读取且 Host 空闲时首次加载，后续查看与切回复用 Profile 内分 driver 内存缓存；缺少凭据时弹出登录方式，登录对话框可切换其他 driver，先取消并等待当前登录实际清理。登录成功后显示可选模型并由用户点选“确认选择”；无需用户发起工具目录验证或模型推理。模型偏好按 driver 保存，认证、支持名单与账号目录匹配并等待原生控制清理完成后才提交；确认后关闭弹窗。状态读取完成后关闭登录框不会反复自动弹出，切回已读取 driver 不重复检查；已读取状态缺少认证或有效模型时禁止发送。同一 Agent 的设置读取在已有设置操作期间合并，不重复启动原生读取；打开设置窗口不与驱动切换再次竞争刷新。认证和模型修改仍保持独占，切换等待取消和实际清理完成；对话状态明确显示设置读取或连接清理，清理隔离时不能合并读取。设置/取消/原生清理持有 Host 排除，清理失败进入隔离，恢复仅重试清理；小窗口保留底部操作，Assistant 跟随 BMW 明暗主题。
- 设置缓存只存经过验证的无秘密显示投影，不持久化或跨 Profile/控制器共享，也不按 Project 重复读取。登录状态参考有效期 5 分钟、模型目录 30 分钟，分开显示最后检查时间与待检查标记；过期仍展示上次结果，不自动轮询、后台启动控制连接或绕过实际任务准入。手动「刷新状态」「刷新模型」均调用现有官方联合读取，成功且实际清理结束后同步更新两个时间。认证/模型修改先使旧投影失效，失败或取消不会恢复旧就绪状态；刷新失败保留旧显示与原时间，首次失败不因反复查看而自动重试。宿主模型偏好或驱动 baseline 变化会丢弃对应缓存。真实任务失败（包括认证/模型准备拒绝和连接失败）保守标记对应 driver 的两部分待检查，不猜测诊断文本、不自动发送/刷新；取消不作为失效事件。外部账号/配置变化不监控磁盘或凭据，仅通过手动刷新或后续官方任务验证发现，重启清空内存缓存。缓存查看不获取 Host 排除；原生读取、登录、模型写入与清理仍保持排除/隔离。
- 每个适配器维护明确的支持名单，并与官方目录取交集；Codex/Qoder 读取账号状态及原生模型目录，DSH 只检查本地 DeepSeek Key 是否配置并读取官方 Provider 目录，不进行 API Key 有效性或余额验证；未知模型及 Qoder 标记禁用项不显示。Codex 支持 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.5`；DSH 支持 `deepseek-official` 下的 `deepseek-flash`、`deepseek-v4-pro`，认证只使用 `DEEPSEEK_API_KEY`，其他 Provider 凭据不构成就绪条件且退出时保留；Qoder CN 支持 `auto`、`qmodel_38max`、`qfmodel`、`qmodel_latest`、`qmodel`、`q37fmodel`、`dmodel`、`dfmodel`、`gmodel`、`gfmodel`、`gm51model`、`kmodel_latest`、`kmodel`、`mmodel`。设置投影中的 `verified` 表示维护名单支持，不表示用户运行过预检或账号拥有推理额度；Qoder 的真实模型验收目前只覆盖 `auto`。
- 设置不要求用户执行专项验证。Codex 设置选择不调用工具预检；Qoder 冷控制会话仍内部检查 SDK init 的有效工具目录并禁止任何模型消息，DSH 使用官方 cold 设置／目录控制。三者设置均不发送模型输入。
- 官方引擎拥有 Agent 循环，Host 只协调输入和资源。输入前有效目录必须只有 `browser`；DSH 每次 request assembly 再检查 scoped catalog，Qoder 禁止继承 plugins/skills/settings，Codex 检查 Responses 及 Lite additional_tools。目录成员不证明账号推理额度或实际请求可用。
- Codex App Server `0.160.0`、`0.160.1` 使用统一的已验证版本白名单，CLI 与官方模型缓存均拒绝未知版本；CLI 错误明确显示实际版本及已支持版本。对 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna` 使用官方启动配置 `model_catalog_json`。从独立 CLI Profile 的官方目录生成内容寻址的只读策略副本，移除强制 code mode/多 Agent 元数据并清空额外实验工具，保留模型 ID、原生 Lite 传输、推理等级、上下文、图像能力和模型指导。不改写官方 cache/config；官方运行时仍可正常刷新其缓存。副本必须是宿主私有的普通文件，缓存版本、模型缺失、路径碰撞/篡改和实际额外工具均失败拒绝。目录预检与实际启动使用同一个副本；目录准入在模型输入前内部执行，用户模型选择不触发预检。GPT-5.5 保持原有路径，未知 GPT-6 型号不自动套用策略。BMW 不增加模型循环、代码执行工具或其他宿主权限。
- Host 私有租约绑定 canonical BMW Session；provider 注册只能解析已明确附着的有效 Host 租约。MCP 执行 scope 通过私有环境传递，显式 catalog-only 模式只提供目录且禁止工具执行，模型传入 `__bmwSession` 始终拒绝。撤销等待真实 kernel/worker 清理。完成事件在实际清理前不结束回执或释放 FIFO；原生清理失败同样隔离资源，恢复仅重试清理。
- 自有 Assistant UI 显示消息、工具进度、运行状态、停止和资源恢复，支持 Browser/Studio 模式与上下文。基础 Markdown 用 DOM text nodes 渲染，模型 HTML 不执行。fork 未验证时在会话中心禁用。新的退出路径等待 Assistant 原生进程、Bridge 和 Feature 实际清理。
- 三个真实引擎已分别通过隔离 BMW 的页面、截图读图、canonical Studio owner 和同一 provider 续聊。DSH/Qoder/Codex 在每轮完成后关闭原生运行进程，以原生存储恢复后续输入；这不证明原生桌面侧边栏同步。测试不用生产桌面 Profile；正常官方 CLI 登录配置与 desktop 私有凭据分离。
- `qoder-bmw` 作为 harness-qoder 的复用 skill 指导随包分发，SDK 装配直接使用固定指导并保持空 skills 目录；skill 不建立连接和权限边界。接入说明见 [QODER_BMW.md](QODER_BMW.md)。

Shell 运行时徽章从自有 Assistant 状态发布，显示等待、执行和资源断连，不依赖原生桌面页面。

直接覆盖：Conversation/History/Host/Assistant Controller、三个驱动契约与 `agent.data-migration`，`assistant.application`、六项 `assistant.startup.*`，以及显式 opt-in 的三个 `external.assistant.*`。

## 桌面、Project 与会话

- 一个 BMW 主窗口，浏览器与 Video Studio 为共享工作区；右侧 Assistant 使用同一会话。关闭或切换 Studio 不退出应用。
- 页面视口仿真仅改变网页布局和截图尺寸，原生显示区域仍由工作区边界决定；大视口取材、切换标签页及缩放窗口不能覆盖 Assistant 或 Shell。
- Shell 渲染器关闭后台节流，使被原生工作区遮挡时仍更新布局与窗口尺寸；设置、会话及计划任务弹窗在重新打开和短窗口下保留可见操作区。此项不新增模型权限。
- 顶栏以导航、Project、录制和 Assistant 为主；主题、网络、搜索、布局、登录和模型设置进入 Settings。Shell 对话框使用一致字体、主题和控件。
- Profile `BMW`、Chromium 分区 `persist:bmw`。Project 包含 ID、目录、主页、页面状态、文档、媒体与草稿；核心不存储原生 Workspace/Session 映射。
- 每个 Project 可有多个 BMW 会话，各自固定 driver 与原生恢复锚点，共享 Project 页面和媒体。BMW Project 切换恢复所选 driver 的 BMW 会话；Assistant 只能选择当前 Project 的会话，跨 Project 选择拒绝。原生 Workspace 只由需要它的 harness 维护，不参与 Shell 或 Feature 的选择逻辑。忙碌期间禁止 Project/Session 切换。
- Project 管理支持创建、选择、改名、主页、文档编辑和 archive；archive 保留文件且至少保留一个活动 Project。无永久删除 Project 的 UI。
- 文档包括 AGENTS、MEMORY、TASKS 和结构化 memory 文件；单文档 256 KiB 上限。Agent 只能追加指定记忆文档。
- 会话中心提供列出、内容搜索、创建、选择、改名、archive、排序。所有操作验证属于当前 Project；fork 按实际驱动能力启用，当前自有 Assistant 未开放原生 fork。未验证的原生 fork 不通过历史入口开放。
- 旧 Profile 的 DSH Workspace/Session 由显式迁移保留，废弃连接器及侧栏字段仅在迁移时清除，不在应用启动时处理。无聊天软件连接器、聊天转发、其他产品导入或 WebContainer 配置。

保存状态加载遵循失败保护：只有确认文件不存在才初始化。Project、Settings、计划任务、权限、布局和登录保持配置的 JSON 损坏、版本不支持、结构错误或读取失败抛出 `BMW_STATE_LOAD_FAILED`，保留原文件，阻止默认状态写回。启动在加载错误时提供重试/退出；重试重新读取原文件，不自动重置或恢复备份。Agent 相关文件只接受 v2；已有 BMW Project/Session 与已删除任务的完成运行历史保留，旧 Settings 需显式迁移。加密登录快照同样保护读取、解密、版本和结构错误；失败后后台保活、快照及配置写入被拒绝，必须显式修复并重新加载。加密暂不可用时不写快照；恢复可用后先读取验证并恢复既有快照，再采集当前 Cookie。权限和布局兼容无版本号的历史数据。
- 重启或首次激活 Project 恢复全部已保存页面及活动页；恢复完成前不写入半完成标签状态。离线加载失败仍保留原 URL。

直接覆盖：platform 的 Project、driver-boundary、product-boundaries、project-panel-layering、global-settings、layout、permission、scheduled-task 测试；agent-contract 的 context-sync；DSH 的 runtime/preset、harness 映射及独立迁移导出。实际 UI 覆盖：driver/desktop/Studio smoke。生产 OS 钥匙串授权由用户完成，不在隔离测试覆盖范围。

Shell 的全部 41 项 invoke 使用统一主进程准入：只接受当前存活 Shell 的主框架及固定本地页面地址。其他 Renderer、子框架和已导航页面在应用处理函数运行前被拒绝；Shell 页面禁止自行导航和打开新窗口。媒体 Worker、Studio 和 Agent 的专用 IPC 仍按各自 sender/token/Project 规则处理。

## 浏览器、工具和权限

模型只有 `browser` 工具，Action enum 与 Schema 通过认证 Bridge 发布；Core 和 Feature 注册冲突在启动时失败。没有额外 shell、文件、凭据、cookie、IPC 或资源工具。

| 功能组 | 当前行为与边界 |
|---|---|
| 页面与导航 | Project 内标签页创建、列出、切换、关闭、导航、历史、搜索、后台默认及用户接管 |
| 观察与交互 | DOM/可访问性观察、点击、输入、键盘、滚动、悬停、等待、页面只读信息与受限页面执行 |
| 页面诊断 | 受限 console/network/load/media 摘要、失败证据；绝不扩展成宿主执行 |
| 截图与图像 | viewport/selector 截图、Project PNG artifact；不改变背景页滚动位置；viewport/selector 均按页面坐标经 CDP 抽取，Studio 用不透明工作区覆盖页面，保留页面渲染表面以继续取材；对截图阶段设期限并取消 |
| 权限 | 用户控制 Agent Control；按站点处理设备权限；用户侧敏感操作保持权限边界 |
| 登录连续性 | 用户主动选择站点后用 OS safeStorage 加密 cookies，并周期性 HEAD；关闭不清除当前登录 |
| 计划任务 | 固定 Project、BMW Session、driver 与时间/时区，保存 runs、执行/取消/删除；绑定失效报错且不自动换会话，无绑定旧任务暂停并提供手动“绑定当前会话”；排队/运行时禁止重绑，只用 browser |

DOM 观察、媒体发现和诊断读取使用统一阶段保护，每阶段最多 15 秒，取消、主 Frame 导航或 Renderer 丢失即停止接纳结果。媒体发现不滚动页面、不等待动画帧；后台素材采集保持前台标签页不变。诊断包含实际 PNG 截图。媒体下载的网络请求和文件流共享取消信号及 60 秒期限，结束流和关闭输出后清理本次部分文件，不删除同名既有 Artifact。只读迟到结果不能恢复文件写入；有副作用的操作不通过遗弃 Promise 释放 FIFO。

Bridge 验证认证、Session、Project 及目录，按 FIFO 执行；Project 变更期间排除模型操作。期限、取消、停止与关闭清理不能释放仍在运行的敏感工作。Bridge 校验图像输出；DSH 官方 MCP Client、Qoder 官方 SDK 和 Codex dynamic tool 结果分别承接本驱动的图像传输，BMW 只接受受限、验证的 PNG 图像结果。多次基础设施失败中止当前 turn，防止无效重试持续运行。

直接覆盖：browser-capability 的 schema、catalog、session-operations、bridge-shutdown、deadline、screenshot-read 等测试；DSH 的 failure-guard/transport。真实浏览器覆盖：desktop、browser-background 和 media smoke。

`observe` 可使用 selector/index 限定正文范围，并以最多 16 个 excludeSelectors 排除推荐、头像和推广。返回正文范围、UTF-16 字符口径、可见文本节点提取方式和截断状态（最多 50,000 字符/10,000 文本节点）；范围不存在返回 element-not-found 与空正文，不回退整页。输入控件/隐藏/script/style 内容不进入正文。结构化交互元素仍保留可见控件。

`page.media.list` 指定范围时只返回该范围 DOM 候选，支持同样的排除项，不拼入全页 performance/网络媒体。返回 candidateOnly、范围与候选截断；发现 URL 不代表获取或解码成功。未限定范围的既有全页发现保留。

## 原生媒体

页面录制保存 `<video Artifact ID>.events.json`。可信主 frame 隔离域只记录点击、滚动、视口与导航，不采集输入文本、键盘、cookies 或页面正文。`page-event` 是真实派发的可信页面事件，不能据此判断是否真人；Agent 的程序化点击独立标为 `agent-action`。滚动/视口按 100ms 限频、点击立即记录；每段最多 5000 事件、5000 个帧时钟映射，JSON 总量最多 2 MiB。录制最多 30 分钟/512 MiB。暂停不支持，主页面导航继续录制，页面关闭停止并保留明确生命周期结果；`discard: true` 删除本次页面录像，字节/元数据预算失败清理本次产物，已有素材保留。停止等待文件流和事件保存/清理结束后返回。

事件保留 `pageSeconds` 原始页面时间及 `seconds` 输出视频时间，`timing` 区分 `measured-frame` 与 `wall-clock`。源视频帧回调同时冻结像素与采集时间，CanvasSource/WebCodecs 以明确时间戳编码；成功编码包的 PTS 与源帧采集时间映射随录像保存；无映射的事件保留墙钟来源，不用于自动焦点。坐标为视口 CSS 像素，另存 DPR、滚动位置、原生录制表面的 CSS 尺寸（含浏览器 zoomFactor），据此映射完整源视频，仿真视口不能代替录制表面尺寸。URL 去除凭据、查询与片段。页面录像使用 append-only WebM；没有时长头/完整索引，读取时实际扫描媒体时间，不将墙钟当作解码时长。没有系统全局鼠标轨迹采集。

录制 runtime 验收另包含真实受控网页的三步任务：选择模板、选择旁白、提交到服务器并导航到持久化任务结果页。通过认证 Bridge 录制，原生页面输入产生点击记录；在 Studio 使用可编辑建议与补充静止讲解焦点，裁切 .2 秒/1.25 倍速，检查按钮/结果范围、旁白绑定及四个选定时间点的预览与 MP4。该夹具不是公开网站或真实 DSH 模型制作；实际本地旁白用于保留绑定验证，未证明人工句边界精度。

Mediabunny `1.61.0` 与浏览器 WebCodecs 为媒体底座；Canvas/WebAudio/WebGPU/MediaRecorder 用于画面、混音、处理与采集。采集和导出由受限宿主文件 adapter 写入当前 Project artifacts；模型只看到 Artifact ID。

| Action 家族 | 输入、行为与限制 |
|---|---|
| page.media / media.download | 当前页面媒体发现、公共 HTTP(S) 媒体下载；受 URL/大小/类型与 Project 边界约束 |
| media.screenshot / media.record | 当前页面截图与浏览器录制；明确录制状态、停止和保存结果 |
| media.video.capture | 页面真实视频采集；达到时长上限属于截断结果，不宣称完整 |
| media.inspect | 当前 Project Artifact 的媒体轨道、时长、尺寸与编码检查 |
| media.frames.sample | 依据媒体时间抽 PNG；时间/数量有界，保存为 Project Artifact |
| media.image.inspect | 解码当前 Project 静态 PNG/JPEG/WebP，返回真实尺寸；32 MiB / 16 MP，图片头在分配像素前检查 |
| media.image.annotate | 以原图像素坐标标注截图/图片，保留尺寸和原文件，输出新的 Project PNG 并回传模型图像 |
| media.image.draw | 有界原生 Canvas 绘制图解：32..4096 整数尺寸、最多 8 MP、白底默认，可选透明背景 |
| media.convert | 时间区间裁剪、缩放、MP4/WebM 转换，保留可支持轨道并检查编码器 |
| video.narrate | 真实 Edge MP3 或本地 Matcha WAV，提供测得时长和 TTS 元数据 |
| video.compose | 有限结构化分镜合成 MP4，标题/列表/字幕、已有画面和旁白、原创配乐及原声混音 |

处理支持进度、期限、取消和部分输出清理，禁止任意 URL、路径、HTML、脚本或 FFmpeg。设备缺少必要编码能力时失败，不伪造成功。实际 alpha 视频允许检查，抽帧/转换拒绝。

图像动作使用同一个 `browser` 工具和现有 Project/Session/权限/FIFO/取消边界。Assistant 先截图或 `media.image.inspect`，再使用 `media.image.annotate` 的 `artifactId` 与 `shapes`；新建绘图则使用 `media.image.draw` 的 `width`、`height`、`background` 与 `shapes`。不需要目标标签页。坐标为实际图片像素，文字从左上角定位，超界图形或放不下的文字明确失败，不悄悄裁切。

支持 `rect`、`ellipse`、`line`、`arrow`、`path`、`text` 和 `redact`，按数组顺序绘制；框/椭圆使用 `x/y/width/height`，线/箭头使用 `x1/y1/x2/y2`，路径使用 `points:[{x,y}]`。颜色使用十六进制 RGB/RGBA；默认红色 4px 线条、24px 文字。文字支持中文、换行、`maxWidth` 自动折行、`fontSize`、`bold` 和背景。遮盖 `redact` 只能使用不透明 RGB 色及 opacity=1，写入新 PNG 的像素；原图保留。最多 128 个图形，单路径 256 点、全图 4096 点、全图 4096 文字字符；每段文字最多 512 字符/16 个显式行。新 PNG 最多 20 MiB，完成后实际重新解码核对尺寸再接纳。失败、取消（含完成文件后验收取消）只清理本次输出。

绘图由无网络、无 Node 的隔离媒体 Worker 使用固定 Canvas primitives 执行；拒绝 HTML/SVG/脚本、远程图片、任意输入/输出路径和自选覆盖文件名。新图像成为 Project 素材，可用于 Studio 分镜。传输期限为五分钟（包含排队及输出验收），每个媒体 Worker 保留两分钟期限。

Edge 默认 `zh-CN-YunxiNeural` 男声、0% 语速，固定 Microsoft 服务，60 秒期限；可选晓晓女声。在线旁白默认打开，关闭后所有 Edge 入口被阻止。本地 `local-matcha/local-zh-en` 使用固定 Sherpa-ONNX WASM，需模型缓存、合成时禁止网络，180 秒期限；不会静默切换提供方或生成无声文件。

直接覆盖：media-native 的 media-controller/media-processing/video-options/video-production；实际 decode/capture/compose/local-speech 在媒体、视频、旁白 smoke 验证。在线 Edge 和付费视觉模型为独立 opt-in，不属于离线检查的成功声明。

### Studio 语音候选、句级校正与字幕锚点

`video.studio` 新增 `align-speech`、`read-speech`、`correct-speech`，均要求当前 Session 的 draftId、expectedRevision、sceneId。识别只允许固定 base/small，作用于当前有效旁白；成功保存 Project 归一化 WAV、原始 JSON、日志及证据 JSON，草稿只保存受限证据引用及 SHA-256。每次重跑只更新候选，不覆盖已有校正；失败、取消、过时 revision 清理本次登记的新文件，保留原素材及手工记录。读取候选校验证据文件与音频哈希，过期结果只供回溯；整段 ASR 不会被按字数拆成虚构句边界。确定性建议只接受唯一的整句文本匹配及结构可用区间，仍未通过自动精度验收。

校正请求 anchors 最多 100 条，含 id、scriptStart/scriptEnd（UTF16，不能切开 Unicode 字符，每段最多 200 单位）、startSeconds/endSeconds（原始旁白文件秒数）。脚本范围和音频时间均有序且不重叠；终点必须在实际可解码音频和分镜范围内。宿主保存脚本全文/SHA、音频 ID/SHA、实测时长、捕获 revision、创建时间与 `audio-file-seconds`。可信 GUI 调用标 `user-edited`，模型调用标 `agent-edited`，请求不能自称人工审定。普通 update 无法改写这些记录；脚本/音频变化保留旧记录并标过期，重做只影响选中的分镜。

旁白面板内提供原始识别片段/概率/警告、真实音频试听与定位、空白初始句时间、取试听时间、手工调整/删除及保存。未完整填写的编辑阻止离开，不会自动估算补值。`speechCaptions=true` 在没有独立 scene.captions 时消费句锚点；独立编辑字幕优先保留，修改字幕不重做旁白。原始旁白从分镜 .5 秒开始，画面 sourceStartSeconds/playbackRate 不改变其时间；预览和原生导出共用 cue 投影，SRT/VTT 再叠加累计分镜时长。使用锚点前检查脚本/生成参数及实际音频 SHA，编码完成后再检查，过期或变化阻止复用/导出并回滚当前新成片。SRT/VTT 保持标准格式，另存 Project JSON 时间来源清单，标明每场景来源、原始音频绑定、脚本范围与时钟；GUI 提供清单下载。

分镜支持 `showSceneNumber` 布尔选项，默认保留模板编号；关闭时预览与 MP4 同时隐藏大号场景数字及页脚编号，标题卡要点上移利用空间。字幕显式换行保留，支持同一 cue 的中英双语两行排版。旁白面板可移除此段旁白与脚本，解除音频/生成/句锚点绑定但保留 Project 音频文件、原声设置与独立字幕；CAS 和撤销/重做继续生效。

画面和旁白属性提供「按句同步」引用编辑器：`scene.speechLinks` 含最多 3 条 bullets `{anchorId,bulletIndex,text}` 与 24 条 focus `{anchorId,visualIndex,artifactId,x,y,zoom,emphasize}`。板书条目和画面素材保留绑定时身份，修改/移除后保留引用并阻止消费，需重新选择或解除。标题卡板书按句开始逐条揭示，未绑定条目保持立即显示，隐藏条目占据原位置；不扩展自由图层或教学模板。强调使用整句时间，叠加旁白 .5 秒起点后，按累计画面片段时长、sourceStartSeconds 和 playbackRate 映射回源视频秒数。句区间必须完整落在所选片段内，目标必须在当前裁切内；与独立焦点重叠、超预算或源区间不足 100ms 均报错，不移动/覆盖独立焦点。

引用通过既有 update/CAS 保存，支持撤销/重做，不改写宿主锚点与旁白版本。GUI 离开输入框/切换检查器/导出前保存待输入字段；时间轴显示来源与揭示点，旁白轨从实际 .5 秒起点显示。字幕、强调、板书共用纯投影与原生绘制，任何消费者都检查有效脚本/TTS 和实际音频 SHA；SRT/VTT 来源清单同时保存引用、原始锚点、板书时间及焦点投影，独立字幕来源保持独立。`video.compose` 的标题卡可显式使用 `bulletRevealSeconds`，最多 3 个、与 bullets 等长的分镜内秒数，不能与画面素材共用；Studio 草稿不接受该派生字段。

这些用户／Agent 编辑时间不是独立声学人工验收金标。十段 base 标注已按用户核听决定采用为 12 个可编辑句／段锚点；独立声学句边界 P95 仍未建立，自动句／词／字时间批准保持关闭。

### 原生语音证据运行端口

media-native 增加仅供宿主消费的 `processArtifact({action:"media.speech.align",artifactId,model:"base"|"small",language?:"zh"|"en"|"auto"})`。请求只接受 Project Artifact 和固定候选，不接受执行文件、缓存路径、模型 URL、提示词或额外 CLI 参数；Studio 通过唯一 browser 工具的 `video.studio` 受限请求消费该端口，不直接公开底层 CLI。固定 whisper.cpp 1.9.1、本机 `whisper-cli` 版本与执行文件指纹、官方多语模型的 revision/大小/SHA-256 在每次运行核对。模型由 `scripts/install-local-asr.ts` 安装到受控缓存，原生引擎需另外安装；本机 macOS 已实测，Linux 分支尚未实测。

沙箱浏览器用 Mediabunny 完整读取唯一音轨（最多 180 秒、8 声道、96kHz、累计 32Mi 浮点采样值），按声道均值混音并用 OfflineAudioContext 重采样到单声道 16kHz PCM16。实际原格式、解码起止、归一化采样数、时长及 PCM 饱和采样数进入证据；Opus 最后一个完整解码包可能超出容器音轨实测终点，仅允许最多 120ms 的末包填充并按真实终点裁去，discardedTailFrames 记录丢弃的输入帧数，字幕时钟不平移。其他超界/格式变化仍拒绝；间隙保留静音，没有根据脚本伸缩音频。原输入前后哈希和路径/文件身份均核对；原文件替换、模型/引擎变化不能被已打开描述符掩盖。

固定 CPU 识别（旧旁白默认中文，视频原声默认自动检测语言）保存 Project 归一化 WAV、完整原始 JSON、日志及 SHA-256，返回实际耗时、`audio-file-seconds` 区间与 BPE token 概率均值。原始越界、重叠和低概率区间不压缩或补造，显式标记不可直接采用。`automaticTimingApproved:false`、`wordTimingAvailable:false` 保持关闭；概率不是人工准确率或中文词/字时间。整体最多十分钟、原始 JSON 4 MiB、进程输出 1 MiB、400 区间/16000 token；取消等待子进程及管道退出，随后只清理当前 UUID 产物。Studio 已提供原始候选、句/段级编辑、字幕及点击强调/板书共用引用。十段真实音频的 base 标注经用户试听并明确采用，保存 ASR 辅助核听来源；制作区间仅裁去超出实际音频时长的末尾，原始转写/时间/警告保留，合并整段不拆成虚构句时间。相对采用记录的原始 base 区间位移 P95 为 272.125ms，仅反映末尾边界修正，不是独立声学准确率；不据此批准自动时间能力。当前保留可编辑句/段锚点，自动词/字同步不开放。

### Studio 下一期：可靠审片、视频原声双语与有限模板

更新预览保留当前全片时间，并将分镜、画布、时间轴与属性同步；视频时长未知显示“待测量”，不按零秒误报缺画面。制作检查读取真实素材时长并显示当前版本的实测覆盖，检查不会写回草稿。草稿更新后旧报告及关键帧失效。

交付面板提供文字/字幕审片与“生成当前草稿关键帧”；按当前草稿逐分镜生成本地预览缩略图，点击返回对应时间，生成后恢复原位置。预览和原生 MP4 共用 Canvas 排版。文字全部保留，允许有限缩小字号并提示；最小字号仍放不下时，预览/编码返回 `STUDIO_TEXT_LAYOUT`，不静默截去剩余行。提示涵盖字幕阅读密度、标题卡停留时间、上方/中央字幕遮挡、缺少译文和字号缩小。审片提示不是事实核查或人工可读性认证。

`video.studio` 增加以下受限操作，继续使用原有 Session owner、Project、revision/CAS、browser FIFO、取消与素材端口：

| 操作 | 输入与行为 |
|---|---|
| `recognize-source` | draftId/expectedRevision/sceneId，可选 segmentIndex、speechModel base/small、speechLanguage auto/en/zh；固定本地 ASR 读取所选视频音轨。保留现有字幕，保存原视频与证据 SHA 及识别候选 |
| `read-source-speech` | 返回原视频秒数的原始分段与警告；源文件变化标记 stale，不自动批准候选 |
| `apply-source-captions` | sourceCues 为核听校正的 startSeconds/endSeconds/text；从原视频秒数经 trim/playbackRate/前置片段累计时长映射到分镜，共享零旁白偏移；显式替换当前分镜独立字幕 |
| `detach-source-captions` | 保留独立字幕，解除原视频时间关联 |
| `set-caption-translations` | translations 为 cueIndex/originalText/translationText；核对当前原文与版本，保留原文和时间，跳过已有 user-edited 译文，返回 skippedCueIndices |

字幕编辑器分别编辑原文与译文，共用起止秒数；`captionDisplay` 为 original/translation/bilingual，对预览、MP4、SRT/VTT 一致生效，旧单语字幕保持原来的文本。字幕人工修改以宿主可信 actor 标记，模型不能声明人工审核。字幕来源清单记录 sourceCaptionBinding、显示模式、译文来源、分镜全片起点；原声字幕没有旁白的 .5 秒偏移。剪裁/变速/前置片段时长或源文件 SHA 变化会阻止预览、成片复用、编码与字幕导出，需重新识别/应用或显式解除关联。翻译请求交给当前拥有该草稿的 Assistant，继续使用所选官方驱动，不新增模型循环。

原声 GUI 提供 base/small、语言选择、原视频试听、识别时间/原文校正和核听确认；未确认不能通过 GUI 应用。识别与应用不生成旁白，不自动删掉用户既有旁白或启用原声，保留原声仍由现有开关控制。ASR 单个完整原视频音轨最多 180 秒；尚无长片分块/区间识别，自动词级时间仍未开放。源候选为宿主持久证据，独立字幕与模板编辑可撤销；应用源识别明确替换当前分镜字幕，不能以模型 draft 更新伪造识别记录。

`sceneTemplate` 是固定版式数据：summary 用三条要点和无画面素材的标题卡，comparison 用两项观点和无画面素材的标题卡，screenshot 用一段现有画面和一条说明。可选 accentColor/backgroundColor/textColor 为固定 #RRGGBB；emphasisIndex 为 0..2。GUI 提供版式、配色和重点选择；内容数量/素材不符合模板时阻止消费。标题卡模板不显示占位大数字，底部页码仍受 showSceneNumber 开关控制。模板不改变原素材、旁白或字幕，不接受 HTML/脚本或自由轨道。

专项验收：`scripts/studio-next-smoke.ts` 使用临时 profile/Project、实际本地英文 TTS 视频和 Whisper base，验证试听/校正/人工译文保留、Assistant 路由、预览位置与属性同步、模板撤销重做、关键帧、双语 SRT/VTT、横屏/竖屏预览与实际 MP4 像素一致性、溢出失败清理。可通过 `BMW_STUDIO_SOURCE` 复制既有公开视频到临时 Project 验证 ASR；不写入原文件。此自动夹具不证明人工转写准确率，也不证明付费模型翻译质量。

## Project 来源与引用

来源通过既有 video.studio 的 operation:source 管理，sourceRequest.operation 为 list/read/collect/confirm/acquire。它在同一 browser FIFO 中执行；当前对话必须属于活动 Project。来源证据由 Project 内会话共享，草稿和引用修改仍受 ownerSessionId 与 revision 保护。

collect 必须提供 bodySelector，支持 index/excludeSelectors；可独立提供 mediaSelector/mediaIndex/mediaExcludeSelectors、authorSelector、publishedSelector、accessSelector 和 Project tabId。固定 DOM 脚本读取限定可见正文与 DOM 媒体，不回退整页，也不混入全页网络资源。输入框、编辑区、隐藏节点及显式排除范围不进入原文。导航、缺失范围、失败和截断分别记录；取消不保存迟到结果。作者和发表时间保留实际元素原文，缺失为 null；标题/作者/日期/限制提示超出各自上限时，获取结果记 truncated 并列出被截断的字段；事件时间另由确认操作声明，采集时间由宿主记录，不相互代替。

Project sources/catalog.json 保存 Schema v1 的页面 URL、获取记录、正文/媒体范围、原文 Artifact/SHA-256、观看限制、候选、确认和实际媒体记录。最多 200 个来源、1000 次获取、每次 80 个候选和 40 次媒体尝试；正文 50000 个 UTF16 单元/256 KiB，元数据 4 MiB。同 URL 合并来源，重复原文可共用内容 Artifact，获取记录与多个 URL 关系保留。过时 source expectedRevision 冲突，损坏目录/改变的原文保持原样并报错；拒绝 symlink，失败仅清理本次新文件。

候选区分 body 图片、cover/poster 和 video/source；发现和确认不等于下载。acquire 的 method=download 取得确认候选的有限 HTTP(S) 文件；blob、分段流/manifest 不绕过下载限制。method=capture 对已确认 video/source 候选采集 HTMLVideoElement，必须给出 videoSelector，可提供 videoIndex、maxDurationMs（1–1800 秒，默认 900 秒）。固定采集程序在同一 Project 页面验证 URL、候选 currentSrc、限定媒体范围及排除项，录制期间继续核对；不能从其他页面、范围或未确认候选获取。不自动登录或导出 cookies。图片实际解码 PNG/JPEG/WebP；视频用私有固定 media.decode.check 逐个解码可支持音视频轨道至文件末尾，保存样本数、媒体时间范围和文件哈希，最多三十分钟/512 MiB、120000 视频帧/250000 音频样本/两分钟作业。该检查不进入模型动作目录。试看/短于观察时长的文件记 partial-preview，其余有限视频记 decoded-file；完整文件解码不证明平台全长。失败/需要登录独立记录，取消清理新下载并保留既有证据。capture 独立保存 pageUrl/candidateUrl/scope、元素选择、fromStart 请求、原播放器 sourceStartSeconds/sourceEndSeconds/sourceDurationSeconds、stopReason 和 UTC 起止时间；媒体文件的 startSeconds/endSeconds 仍是解码文件时间域。播放器 ended 仅证明当前元素结束；达到上限/requested 或试看均记 partial-preview，不宣称平台全长。当前捕获使用原生 MediaRecorder、有限 Base64 拉取（每包 8 MiB、页面缓冲 16 MiB、32 个待处理块）、512 MiB 文件上限和宿主期限；取消/导航/关闭先停止并清理本次录制、恢复播放位置/暂停/loop/rate，再释放工作状态，保留已有媒体。迟到初始化有取消标记。GUI 确认的视频候选提供「采集此播放器」入口，范围选项可指定元素和采集上限。同内容媒体实际核对哈希后共用 Artifact，每次来源证明保留并保存 proofContentId SHA-256。read 和引用导出复核当前媒体/证明文件哈希，返回 mediaAvailability（每次最多共读取 512 MiB，相同文件/哈希复用核对），区分 verified/missing/changed/invalid/not-acquired/unrecorded/budget-exceeded；旧记录缺少证明哈希保留 unrecorded，不修写历史。当前证据不完整时来源预览禁用，引用清单保留历史获取与实际媒体范围并另报可用性；取消核对不写入来源或草稿。

准备页的「网页来源、正文范围与引用」展开区提供页面与正文范围选择、来源详情、原文、候选确认、事件时间、获取和已保存素材预览，默认折叠以保留笔记、大纲和素材入口。preparation.sourceIds 关联此次视频的来源。原文选区可引用到指定分镜；每分镜最多十二条 citations，包含 sourceId/acquisitionId、UTF16 startCharacter/endCharacter/quote、kind=fact/opinion、claim、conflict=pending/conflicting 和 eventAt。更新与导出均核对引用等于保存原文的准确子串。GUI 可以移除引用，沿用保存、撤销和版本冲突。来源/引用元数据不进入合成或旁白绑定，不使成片签名或未改旁白失效。

export-citations 使用 draftId/expectedRevision 创建 Project JSON 清单，最多 512 KiB，返回原文范围、URL、原文 Artifact/哈希、发表/采集/事件时间、获取状态、已有媒体范围/证明 ID 与当前文件可用性。fact 表示引用用途，factChecking 保留 pending；冲突不自动变为已核查。GUI 提供下载入口，导出不修改草稿历史。外部网站质量、B站复测和点评样片单独实测，不能由受控 fixture 推断。

## 视频参数和模板

Settings 的视频制作项支持比例、分辨率、帧率、内置画面风格、水印、配乐和 TTS。模板按名称保存在 Profile 的 videoPreferences，草稿保存参数快照；不同 Project 可使用同名模板。

优先级：明确参数 > 指定模板 > 默认值。Agent 可用 `video.settings` 读取/更新/保存模板，或在 `video.studio`/`video.narrate`/`video.compose` 指定模板名和覆盖字段。输入 Schema 闭合、有界；视频设置及草稿采用预期版本冲突检测，拒绝覆盖并发编辑。

TTS 设置只是生成参数；已有音频按分镜保存宿主生成记录 `audioGeneration`：`{kind:"tts",options:{provider,voice,ratePercent}}` 表示实际生成参数，`{kind:"imported"}` 表示手动绑定音频，`{kind:"legacy",options:{...}}` 仅保存旧音频编辑前的目标参数基线，不声称实际音色。旧草稿缺字段时保留原音频并显示「参数未记录」；后续改变目标音色/语速会标记旧音频过期。生成音频的脚本、provider、voice 或 ratePercent 改变后需重新生成，预览不混入过期旁白，导出拒绝过期音频。手动绑定音频不受 TTS 设置影响。GUI/Agent 草稿更新不能改写同一音频的真实生成记录、脚本文本及实测时长。字幕内容和样式可独立编辑，不使旁白过期。

## Video Studio

单画面和各 visualSegment 支持最多 24 个有序、非重叠 `focusIntervals`：`startSeconds/endSeconds` 是原素材秒数（图片为片段内秒数），最短 100ms；`x/y` 为完整源画面中心 0–1、`zoom` 为 1–4、`emphasize` 控制中心标记。焦点在原 crop 内平滑进出，预览/MP4 使用同一绘制与 trim/rate 映射；时间轴投影重点区间。画面属性提供添加、修改、删除及撤销/重做；聚焦输入在分镜/Session 切换前保存。焦点不重录视频、不使未改旁白过期，但使旧成片复用失效。替换画面移除旧素材的焦点；追加片段保留原画面的焦点。保存失败后的本地焦点仍可删除：删除先移除目标再提交修正后的草稿，不重试已被拒绝的旧草稿；删除目标正在输入的参数随目标一并移除，其他参数输入仍正常提交。删除支持撤销/重做，仍遵守所属 Session 和 revision 冲突检查。

`suggest-focus` 要求所属 Session 的 draftId/expectedRevision/sceneId，支持 segmentIndex；只读取当前 Project 对应录制事件文件，返回实际记录与确定性点击分组建议，不写草稿。建议只使用有实测帧映射且位于录制表面内的点击，缩放上限 1.5。GUI 接受建议后仍可逐项修改；已有手动区间不会被覆盖。普通视频/图片可手动聚焦，缺少录制事件明确提示自动建议不可用。建议不证明操作结果或页面正文都在焦点内，交付样片仍需审片。

画面素材选择统一提供列表／图标视图、按可见区域加载的真实图片／视频缩略图及放大预览；覆盖素材准备、匹配、工作台、封面和画面片段。预览只读取当前 Project 素材，沿用读取／解码预算、媒体控件与切换取消；显示方式切换不修改视频草稿。

交付页可直接查看／另存任意已有成片。`render` 默认复用内容及文件签名一致的已完成 MP4，不启动编码、不增加草稿 revision 或成片记录；`forceRender: true` 明确重新制作。后端签名包含有效合成参数和源素材／输出／验收报告的文件状态；分镜、字幕、音频、尺寸或文件变化使复用失效，封面与准备笔记不影响视频。旧记录缺少签名时仅提供手动查看／另存，不推断为当前成片。签名由完成作业记录，编辑不能伪造；归属和 revision 检查继续执行。

草稿保存在 Project 中，但由不可修改的 `ownerSessionId` 强绑定到唯一 Session。一个 Session 可以拥有多个草稿，共用 Project 素材；列表、读取、修改、生成和删除均在后端校验可信调用身份，另一 Session 不能编辑或继承草稿。Bridge 将已认证 Session 身份传递到执行链，Renderer 的归属由主进程确定。未绑定的历史草稿默认不可见，不自动认领。切换 Session 前保存已输入编辑，切换后显示该 Session 的草稿及独立选中状态；没有草稿时显示空状态。草稿 Assistant 请求提交到其所属 Session。当前 Studio 作业未完成时拒绝切换。

「删除草稿」要求当前版本并确认，移出活跃草稿列表，保留 `video-studio/deleted` 中可恢复记录；不删除 Project 共用素材、封面、字幕或成片文件。删除最后一个草稿恢复空状态。

Studio 使用主工作区，不创建独立退出入口。GUI 与自然语言共享当前 Session 的草稿、选中分镜、阶段、版本、材料和导出结果；DSH 驱动在官方上下文快照中注入当前 Studio 数据，数据不被当作权限提升指令。

编辑阶段采用画布工作台：左侧分镜与本视频素材、中央适应空间的横/竖屏预览及常驻播放控制、右侧画面/旁白/字幕属性面板、底部按真实时长排列的全片时间轴。属性独立滚动；全片参数、配音默认值和命名模板集中在「视频设置」窗口。五阶段流程和原有脚本工作区保留，画面匹配阶段使用独立属性栏。封面编辑由右上「视频封面」打开，交付由顶栏「交付与导出」打开，属性标签只保留画面、旁白、字幕。顶栏交付按钮默认普通样式，仅交付面板打开时高亮，切换回编辑或封面时恢复。

时间轴仅投影已有顺序分镜、视觉片段、实测旁白长度和字幕区间，不新增持久化轨道。点击分镜或片段定位累计时间；播放/跳转跨分镜时同步列表、属性、时间轴与原有 Agent 选中上下文。字幕仍标注估算或编辑来源；过期旁白标注需重生成。切换属性、封面、设置或交付前保存聚焦输入并检查版本，保留撤销/重做。

封面模式中央只展示独立 PNG，右侧编辑全片封面，暂停视频播放并隐藏视频时间轴；零分镜也可使用。交付集中 MP4、封面 PNG、SRT/VTT、制作检查、字幕下载和历史成片/验收报告。任务状态与保存状态分开显示，媒体作业运行时才显示取消入口；未更新预览显示提示。布局支持窄窗口和明暗主题，不提供尚未实现的自由图层/关键帧控制。

工作流：

1. 素材收集：零分镜可建立草稿；收集笔记、全局提纲、文本、图像、视频和音频。
2. 脚本创作：全局脚本显示所有分镜；选中分镜对应独立正文/画面要求。添加、删除和排序分镜同步到全局关系。
3. 制作音频：针对分镜生成、试听和绑定真实旁白，测得时长后设置目标长度。正文变更使旁白 stale；制作时拒绝 stale 音频。
4. 匹配画面：全 Project 可预览素材缩略图；最多两个并行解码，缓存有界，原生窗口不发出可见性回调时通过渲染/滚动/尺寸变化的布局检查补充加载。选中分镜后按当前分镜、未用素材和其他分镜素材分组，支持拖拽绑定与更换画面。旁白和文本不混入画面候选。素材不足可通过同会话请求采集或明确选择末帧定格。
5. 预览和编辑：点击分镜跳到其时间位置；以音频时钟同步、按视频帧率定时刷新，不依赖原生窗口的 compositor 回调；暂停、跳转和切换草稿取消过时播放；预览可调整脚本、素材、取景、源起点、速率、音量、原声和字幕，渲染保存 Project 成片与版本。

`video.studio` 的操作：list/create/read/update/configure/save-template/assets/inspect/read-material/attach/narrate/narrate-pending/check/export-captions/export-cover/render/open/context。请求使用 Artifact ID、Draft ID、Scene ID 和 expectedRevision；update 的草稿为受限对象，无任意 HTML/脚本。attach 验证真实媒体类型和归属。视觉修改保留未改脚本的旁白绑定；脚本变更要求重生成。空草稿可保存、配置和制作封面，不能导出视频；最多 24 分镜，素材集合与正文都有明确上限。

全片制作面板显示分镜数、总时长与待制作旁白数，问题可点击定位分镜。`narrate-pending` 使用草稿保存的 TTS 参数顺序制作非空脚本中缺失/过期的旁白，跳过仍有效的生成音频、导入音频和无旁白分镜。每段完成即以 revision 保存并通知 UI；取消、服务失败或并发编辑阻止后续写入，已完成段保留，读取最新 revision 后可续作。禁止在线旁白时批量入口同样拒绝 Edge。音频绑定/再生成后的分镜时长至少覆盖实测音频 + 1 秒和独立编辑字幕的终点，不静默裁剪字幕；60 秒分镜/180 秒全片上限仍有效。

`check` 需要 draftId/expectedRevision，只读检查当前 Project 的素材和实际音视频时长，返回 revision、ready、总时长、累计时间轴、画面可用时长/缺口、待制作旁白 Scene ID、带 code/severity/Scene ID 的问题与 checkedAssets。一次检查中共享图片与音视频只探测一次，全部分镜问题汇总；检查期间 revision 变化或取消即拒绝结果。音视频检查可解码轨道、真实 alpha 包和尺寸；图片通过受限原生 Worker 实际解码静态 PNG/JPEG/WebP（verification=decode）。图片头在解码前限制单图 32 MiB/16,777,216 像素，全片唯一素材最多 256 MiB，图片总像素最多 33,554,432；检查、预览和导出共享预算。损坏、动画、SVG 或超预算图片阻止导出。材料库缩略图和图片弹窗也复用同一静态图片头检查，在 createImageBitmap 分配前拒绝超大或动画图片；缩略图最多两路并行、缓存 64 项。check 另返回当前宽高/fps 的 H.264/AAC 编码可用性；不支持时给出 encoding-unavailable。原文件不写回实测 metadata；导出复用同一检查且再次探测，不依赖过时 GUI 报告。源起点必须早于视频末尾，选择 hold 也不能放行无有效源区间；有效片段末尾定格作为 warning 展示，仍允许导出。

单分镜可含 `visualSegments`，1–8 个图片或视频片段，每段 0.1–60 秒，总和必须等于分镜时长；与分镜级图片/视频绑定互斥。各片段有独立源起点、速率、取景、原声音量与 cut/fade。fade 为经过背景的淡出/淡入，不重叠播放两个视频、不增加时长。GUI 追加等分时间、编辑时长由另一片段补足、移除按比例重新分配；`attach.segmentIndex` 可追加或替换，替换保留时间分配。测得旁白改变分镜长度时同比调整片段；旁白和字幕保持分镜连续时间。预览/导出共享选片、绘制、混音逻辑，串行读取一个视频片段；原声只覆盖对应片段和有效源区间。

`export-cover` 使用 draftId/expectedRevision 和可选 cover 参数，保存独立的 Project PNG；无需已有分镜、旁白或成片。GUI 的「视频封面」进入编辑与预览页的封面面板，支持当前 Project 静态 PNG/JPEG/WebP、视频指定秒数的真实帧和纯文字背景；标题最多 80 字、副标题最多 160 字，文字位于上方或下方，画面可完整保留或居中裁切填满，背景/文字/强调色为不透明 #RRGGBB。尺寸沿用草稿，宽 320–1920、高 180–1920；单 PNG 最多 20 MiB。静态输入最多 32 MiB/32 MP，视频遵守现有字节/像素预算和 1800 秒时长限制，指定时间须在实际视频轨道范围内，返回实际取帧时间，不伪称精确对齐。

封面参数随草稿 cover 保存，宿主独占 coverExports（最多 30 条，保存参数、尺寸、来源版本及取帧时间）；普通 update 保留省略的参数且不能篡改记录。原生固定 Canvas worker 使用 Project 固定文件句柄、限定 IPC 和禁用网络的沙箱，PNG 完成后重新解码验证尺寸。失败、取消或并发编辑只清理本次输出；封面不修改原图/原视频、分镜、旁白、字幕或视频导出历史。UI 可预览、下载 PNG，切换草稿后仍可查看最近封面；参数或输出尺寸变化提示重新生成。旧草稿无需迁移。

`export-captions` 使用 draftId/expectedRevision 和 captionFormat=srt/vtt，在 Project 素材库创建主进程分配 UUID 的字幕文件。分镜局部字幕转换为全片累计毫秒时间；明确关闭的字幕保持关闭，独立编辑字幕不改脚本和旁白。自动字幕使用有效音频的实测时长，仍属于估算，返回 edited/estimated/mixed，GUI 提示来源。取消/并发修改清理本次输出且不写草稿。单输出最多 512 KiB；下载链接与 Project 文本预览可用。

准备阶段的「让 Assistant 起草脚本」与匹配阶段的「让 Assistant 匹配已有素材」通过草稿所属的 BMW Session 及其固定 driver 提交固定、受验证的 intent；旧兼容入口沿用 DSH Session 绑定。提交前后检查 Project/revision；不添加工具或循环。辅助提示要求只补空脚本、保留已有分镜 ID/顺序/旁白/字幕及来源，匹配基于已查看的素材，不足则说明缺口。`read-material` 仅读取当前 Project 的受限文本素材，最多 256 KiB UTF-8 并报告截断；材料是数据，不执行 HTML/脚本。实际模型生成质量与外部调用单独验收。

每次原生成片重新读取最终 MP4，核对可解码的 AVC/AAC、宽高、48 kHz 双声道和实际时长；通过后保存 Project JSON 验收报告。记录产物 ID、实际/预期时长、轨道和尺寸，以及渲染帧数、fps、音频峰值、旁白实测时长。exports 记录 verificationArtifactId，GUI 可下载成片及报告；失败清理本次 MP4。编码能力具有设备差异。

原声可保留/静音/调整音量；源区间和播放率同步混音。脚本、旁白文本、字幕内容互有关联但样式独立。当前字幕时间是编辑或估算结果，不宣称自动逐词对齐。

直接覆盖：feature-video 的 draft、assets、context、preview、studio 等测试及 `scripts/video-studio-smoke.ts`。真实最终混音、音轨/时长/播放由 video-production smoke 覆盖；Studio UI 的确定性旁白替身只验证操作路由，不代表外部 TTS 质量。

## 当前范围与维护

通用 NLE、任意 Hyperframes HTML 导入、外部聊天控制、独立远控/移动端、签名安装器和自动升级未实现。核心不会从其他仓库加载运行时代码。自动测试使用临时 Profile、DSH Home 和 Workspace，不能证明真实钥匙串授权、外部服务可用性或全部模型视觉能力。

修改功能/权限/Schema 必须更新本文；新增、移动、删除测试运行 `npm run docs:features`。文末列表由源码生成并由 `npm run check:features` 验证。验证命令和证据边界见 [VERIFICATION.md](VERIFICATION.md)。

## 模块接口与测试分类

模块定义与依赖方向见 [ARCHITECTURE.md](ARCHITECTURE.md)。七个产品包、应用组装和验证工具拥有明确职责，跨模块仅能依赖 package exports 指定的公开文件。Feature 生命周期、Browser 宿主与原生媒体端口有具名 TypeScript 接口；未知跨进程输入与媒体回复仍须运行时校验。公开接口有正反类型消费者、运行时契约测试和对应回归保障。

Browser 与 AgentDriver 的直接保障不依赖具体 DSH 实现；通用 driver 夹具从 Platform 注入的连接配置出发，经 MCP 适配器和 Bridge 实际操作 Project 页面，并验证权限、绑定及切换后恢复。DSH 的安装版兼容性与持久化绑定验证单列为具体实现/产品装配保障，按 Agent 契约、DSH 实现和产品组装范围选择；Browser 模型接口（Schema、目录、Bridge、MCP）单独改动不会自动启动 DSH。完整离线基线仍执行 DSH。

测试分为 unit、contract、boundary、type、integration、desktop、media、external。`test:plan` 给出选择依据，`test:affected` 根据文件依赖、行为 watch 和接口矩阵执行受影响保障；任何源代码改动保留全局边界。共享验证辅助库的改动自动沿导入/重导出闭包选择所有运行时消费入口；生产模块仍使用接口/行为范围。未知/删除路径、共享配置及验证代码中无法证明的动态导入升级为完整离线集。生产代码不得依赖测试目录或验证工具；Renderer 禁止裸名称或 node: 前缀的 Node 内建模块。生产计算式导入默认拒绝，仅 DSH 插件允许解析声明的固定安装包字面量，不允许新增任意计算式导入。测试未分类、接口保障缺失或生成文档过期直接失败。新构建的源码/输出哈希收据防止使用过期 JS，只有完整离线集通过才更新验证基线。

<!-- BEGIN GENERATED CAPABILITY AND TEST INVENTORY -->

> 本区块由 `npm run docs:features` 生成。请修改上方人工维护的功能条目，再刷新本区块；不要手工编辑本区块。

### 当前 Browser Action 清单

- BMW 核心 Browser Actions（37）：`status`、`tabs.list`、`tabs.open`、`tabs.show`、`tabs.close`、`navigate`、`back`、`forward`、`reload`、`observe`、`click`、`type`、`wait`、`key`、`hover`、`page.diagnostics`、`page.media.list`、`page.viewport.set`、`media.screenshot`、`media.download`、`media.video.capture`、`media.inspect`、`media.frames.sample`、`media.convert`、`media.image.inspect`、`media.image.annotate`、`media.image.draw`、`media.record.start`、`media.record.stop`、`project.context`、`project.memory.append`、`project.tasks.append`、`schedule.list`、`schedule.create`、`schedule.update`、`schedule.remove`、`schedule.run`
- feature-video Feature Browser Actions（4）：`video.compose`、`video.narrate`、`video.studio`、`video.settings`

### 当前自动化测试清单

#### `packages/agent-contract/test/assistant-ui.test.ts`

- `Assistant IPC admits only named bounded commands with explicit Session/run identities`

#### `packages/agent-contract/test/context-sync.test.ts`

- `BMW context validates Project and Session identity without native Workspace fields`

#### `packages/agent-contract/test/conversation.test.ts`

- `BMW conversations admit a visible blank Session without a provider identity`
- `driver capability declarations fail closed instead of enabling missing features`
- `driver events reject extra execution tools and malformed interaction decisions`
- `event envelopes require explicit Session/run identity and a positive replay sequence`

#### `packages/agent-contract/test/driver-settings.test.ts`

- `Settings commands are closed and snapshots reject credential-bearing form defaults`

#### `packages/browser-capability/test/bridge-shutdown.test.ts`

- `Bridge shutdown cancels the active renderer wait before draining FIFO`

#### `packages/browser-capability/test/browser-deadline.test.ts`

- `browser requests are finite while media jobs retain their long budget`

#### `packages/browser-capability/test/browser-host.test.ts`

- `Feature dispatch admits the host port and forwards actor, Project and cancellation without replacing them`

#### `packages/browser-capability/test/browser-schema.test.ts`

- `accepts every declared browser action`
- `rejects unsupported and malformed requests`
- `returns only string tab ids`
- `body ranges bound selectors and exclusions and reject malformed scope rather than broadening it`

#### `packages/browser-capability/test/collect-page-source.test.ts`

- `Source collection retains scoped originals, unknown dates and candidate-only roles with no global resource admission`
- `Missing source range never invokes media fallback; truncation, visible trial evidence and missing explicit media range remain explicit`
- `Navigation across collection phases yields navigated evidence; cancellation leaves no late candidate admission or listeners`
- `Clipped metadata remains explicitly truncated rather than silently admitted as complete author/date evidence`

#### `packages/browser-capability/test/mcp-tool-catalog.test.ts`

- `BMW MCP discovers exactly browser from the authenticated product catalog`
- `MCP catalog admission rejects extra tools and malformed action boundaries`

#### `packages/browser-capability/test/media-artifact.test.ts`

- `media download writes a bounded Project artifact through the browser fetch adapter`
- `media download rejects non-web URLs and responses beyond its byte limit`
- `artifact filenames remove path syntax and infer media extensions`
- `media download rejects and removes DASH initialization fragments`
- `media download cancellation aborts fetch and drains streaming writes before removing partial output`
- `failed media download never removes an existing artifact with the same filename`

#### `packages/browser-capability/test/renderer-read.test.ts`

- `Renderer read cancellation releases FIFO and ignores late DOM and diagnostic results`
- `Renderer reads bound deadlines and reject navigation, renderer loss and pre-cancellation`

#### `packages/browser-capability/test/screenshot-read.test.ts`

- `screenshot cancellation releases FIFO and ignores a late renderer result`
- `screenshot deadline identifies phase and renderer loss removes observers`
- `screenshot rejects main navigation and never starts already cancelled reads`

#### `packages/browser-capability/test/session-leases.test.ts`

- `managed provider registration resolves only an attached live Host lease and keeps the canonical BMW owner`
- `Session lease revocation aborts its work but awaits actual cleanup before returning`
- `Qoder/Codex MCP receives host scope from its private environment and rejects model scope substitution`

#### `packages/browser-capability/test/session-operations.test.ts`

- `Session operations serialize, recheck admission and recover after failure`
- `Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images`
- `Browser bridge admits bounded Project frame sets and propagates active MCP cancellation`
- `Studio context bridge authenticates Session ownership and rechecks revocation after GUI flush`

#### `packages/browser-capability/test/tab-policy.test.ts`

- `Agent tab reuse prefers an exact URL without navigating`
- `Agent tab reuse navigates the most recent same-origin Agent tab but not a user tab`
- `Agent tab cap closes only least-recent background Agent tabs`

#### `packages/feature-video/test/studio-materials.test.ts`

- `Studio material groups reflect live scene bindings and reuse across Project drafts`
- `Studio material drops admit only current Project assets matching the target slot`

#### `packages/feature-video/test/studio-sources.test.ts`

- `Studio source evidence is Project-shared, while citation edits keep Session ownership/CAS and actual original UTF16 ranges`
- `Native full-file decode admission rejects empty/dropped track evidence and remains a private host action`

#### `packages/feature-video/test/video-boundary.test.ts`

- `video actions remain feature-owned in one browser tool and require trusted narration consent`

#### `packages/feature-video/test/video-settings.test.ts`

- `video template settings persist without changing other settings and are reusable by name`
- `Studio snapshots defaults and templates while visual-only configure retains custom size and CAS`
- `TTS resolves Edge male defaults named snapshots and explicit overrides while preserving opt-out`
- `Studio narration uses configurable TTS rather than fixed local speech and enforces the Edge gate`

#### `packages/feature-video/test/video-studio.test.ts`

- `Studio drafts persist per Project and reject conflicting GUI or Agent revisions`
- `Studio coverage follows actual voice, source trim and speed and requires explicit end hold`
- `Studio render remeasures artifacts instead of trusting edited duration metadata`
- `Studio rejects script paths and malformed captions while admitting Project images`
- `Studio visual edits retain measured narration while rewritten scripts require new speech`
- `Studio selection validates owning draft and scene and publishes the latest revision as context data`
- `Studio GUI undo can explicitly clear an attached voice without erasing omitted model bindings`
- `Preparation persists without scenes, retains legacy bindings and rejects empty export`
- `Preparation admits Project text and rejects missing and symlink additions without a revision write`
- `Caption edits preserve voice while regeneration replaces only the selected script audio`
- `Generated narration records actual parameters and blocks stale voice or rate while visual edits remain ready`
- `Legacy audio keeps unknown parameters and detects subsequent changes; imported audio ignores TTS preferences`
- `Production checklist locates timeline gaps, stale speech and invalid starts even with explicit hold`
- `Measured readiness collects shared and missing asset issues without writes and uses the same export gate`
- `Readiness rejects alpha, oversized, undecodable tracks, symlinks and revisions changed during inspection`
- `Pending narration saves each scene, skips current imports and resumes safely after provider failure`
- `Batch cancellation and concurrent edits reject late results without committing or starting later speech`
- `Narration preserves independent caption endpoints and refuses scene or whole-film duration overflow`
- `Batch uses the draft voice snapshot, respects online opt-out and retains completed scenes on cancellation`
- `Studio exports Project subtitles and literal bounded text while segment changes retain measured narration`
- `Measured image budget deduplicates shared pictures and unsupported encoders block export without writes`
- `Cover export admits closed options, legacy drafts and independent zero-scene output`
- `Cover source admission rejects other Project IDs, audio and symlinks before native work`
- `Cancelled or conflicting cover jobs remove only their new PNG and preserve GUI changes`
- `Workbench timeline preserves cumulative fractional scene and segment boundaries with caption provenance`
- `Workbench timeline labels estimated captions and admits empty cover-only drafts`
- `Studio Session ownership hides legacy and foreign drafts and rejects every foreign draft operation`
- `Studio deletion checks Session and revision and keeps shared materials exports and recoverable records`
- `Studio bridge forwards authenticated Session ownership instead of accepting a caller-selected owner`
- `Studio pending narration keeps the admitted owner when caller identity changes during an awaited job`
- `Completed MP4 reuse survives cover/notes edits but invalidates changed composition, files and forged journals`
- `Focus suggestions admit only Project recordings at the owning revision and never overwrite manual focus or speech`
- `Sentence spans reject overlap/forgery/Unicode splits and ASR paragraphs are not divided into invented sentence times`
- `Host sentence correction binds actual hashes and trusted actor; ordinary draft updates cannot replace it`
- `Speech evidence success/rerun preserves correction; cancelled or conflicting recognition rolls back only new outputs`
- `Anchored captions share voice offset and cumulative film time; independent edits remain and file/script changes fail closed`
- `Anchored render rechecks the audio after encode and rolls back only newly created MP4/report on late replacement`
- `Speech links preserve target identity, map trimmed/rated segmented focus, and reject orphan, crop, overlap and boundary changes`
- `Title-card reveal links preserve static rows and independent captions; changed bullets and forged raw times cannot be adopted`
- `Focus-only anchor consumption verifies actual audio hashes and exports truthful receipts; editable links support CAS undo without rewriting host anchors`
- `Studio preserves optional scene numbering and bilingual line breaks through composition and revisions`
- `Unknown footage is pending measurement rather than a false source-range or footage-gap error`
- `Source caption clocks clip trim edges, apply rate and preceding segment offset with zero narration lead`
- `Original-source ASR keeps independent captions; reviewed apply maps actual clock and preserves source evidence`
- `Original-source recognition rolls back only new artifacts on cancellation, CAS conflict and source hash change`
- `Bilingual translation preserves original times and user corrections, and fails atomically on stale original or CAS`

#### `packages/harness-codex/test/codex-backend.test.ts`

- `GPT-6 uses the exact admitted startup catalog when resuming its native Session before dispatch`
- `GPT-6 never starts a native runtime without its admitted startup catalog`
- `Codex admits input after catalog verification, resumes the same provider and normalizes browser/image/message receipts`
- `Codex rechecks live authentication and model membership before creating or resuming a native Session`
- `Codex catalog failure never starts the provider or releases a user message`
- `Codex rejects a foreign tool scope and waits for transport cleanup`
- `Codex cancellation racing the input receipt sends one interrupt after the turn becomes known`

#### `packages/harness-codex/test/codex-installation.test.ts`

- `Codex public CLI discovery resolves executable files and an explicit missing installation never falls back`
- `A missing Codex installation keeps BMW settings available and rejects input before opening a connection`

#### `packages/harness-codex/test/codex-policy.test.ts`

- `Codex protocol admits verified patch versions and reports detected and supported versions`
- `Codex effective catalog reads Responses and Responses Lite additional_tools, including hidden extra namespaces`
- `Codex browser thread excludes environments, shell, MCP helpers and question tools before user input`
- `GPT-6 startup catalog changes only tool metadata and preserves native model capabilities and transport`
- `GPT-6 host catalog is immutable, content addressed and private without modifying the official model cache`

#### `packages/harness-codex/test/codex-settings.test.ts`

- `Codex settings project official paginated models and account status without model input or account metadata`
- `Codex never commits a verified model while its native settings process fails to close`
- `Codex selects maintained supported models without user preflight and rejects unsupported catalog entries`
- `Codex browser login completes only for its login ID and admits an official origin`
- `Cancelling Codex login cancels the native operation and never selects a model`

#### `packages/harness-dsh/test/browser-failure-guard.test.ts`

- `repeated infrastructure failures stop only their official Session until next turn`
- `selector errors, success and user cancellation do not trip infrastructure guard`

#### `packages/harness-dsh/test/dsh-backend.test.ts`

- `DSH preparation failures retain cleanup ownership and permit retry only after actual native drain`
- `DSH rejects malformed native membership before creating a Session or submitting input`
- `DSH stop retains the native process until an actual exit event, including legacy lifecycle callers`
- `DSH child errors cannot masquerade as physical cleanup and a later exit permits recovery`

#### `packages/harness-dsh/test/dsh-events.test.ts`

- `DSH pre-input admission uses the exact scoped model catalog and immutable Project identity`
- `DSH durable events retain tool IDs and text without leaking image bytes or thinking`

#### `packages/harness-dsh/test/dsh-migration.test.ts`

- `legacy display imports human/model text without context, summaries, private reasoning or pixels`
- `cold DSH migration reads all backward pages at one cursor and preserves archived/parent identities`
- `missing native bindings and pagination without progress fail instead of choosing another Session`

#### `packages/harness-dsh/test/dsh-preset.test.ts`

- `installs and safely updates only the BMW DSH preset`
- `does not overwrite a preset directory not owned by BMW`
- `isolates product state and privately seeds credentials without shared writable links`
- `keeps BMW as theme source without overwriting unrelated DSH settings`

#### `packages/harness-dsh/test/dsh-runtime.test.ts`

- `DSH calls use the harness RPC envelope and validate the response`
- `DSH project activation creates a project-scoped BMW session`
- `DSH project activation reuses its persistent project session`
- `BMW Session Center lists only active sessions in its Project and searches content`
- `BMW creates new DSH sessions with the browser-only preset`
- `DSH prompt submission preserves exact input and returns every Assistant output in order`

#### `packages/harness-dsh/test/dsh-settings.test.ts`

- `Owned DSH initialization privately copies provider credentials and never rewrites their source`
- `A dangling legacy DSH credential link fails closed before official writes can follow it`
- `DSH settings use official redacted control APIs and preserve exact model routes`

#### `packages/harness-dsh/test/dsh-transport.test.ts`

- `DSH launch authentication accepts only the owned origin and token`
- `DSH requests preserve named arguments and correlate prompt admission`
- `DSH WebSocket snapshots authenticate, cancel streams and reject mismatched frames`
- `BMW keeps exactly browser while delegating MCP execution and cleanup to DSH`
- `DSH command discovery normalizes the official array response and sends authentication`
- `BMW scoped registry checks execution identity without changing model arguments or native execution context`

#### `packages/harness-dsh/test/project-bindings.test.ts`

- `DSH owns immutable native Workspace mappings while BMW Projects retain only their own identity`

#### `packages/harness-dsh/test/video-case-log.test.ts`

- `video case export preserves prompts and observable reasoning while redacting credentials and inline media`
- `video case export reads complete paginated history and rejects duplicate or missing event sequences`

#### `packages/harness-dsh/test/workspace-context.test.ts`

- `DSH Studio assembly preserves the prompt, sole tool and existing context while replacing stale selection`

#### `packages/harness-qoder/test/qoder-backend.test.ts`

- `Qoder releases UUID-stamped user input only after the effective catalog and binds provider resume identity`
- `Qoder preflight failure closes its worker without consuming input or falling back to a new Session`
- `Qoder cancellation retains failed native cleanup ownership and recovery never resubmits input`

#### `packages/harness-qoder/test/qoder-events.test.ts`

- `Qoder effective initialization rejects builtins, foreign MCP, inherited plugins and unsupported runtime`
- `Qoder content blocks sharing a model message ID retain distinct tool/text identities and stream one reply`
- `Qoder unexpected tools, unfinished calls and mismatched streaming prefixes fail closed`
- `Qoder split MCP image result stays in the native context and cannot complete a foreign call twice`

#### `packages/harness-qoder/test/qoder-settings.test.ts`

- `Qoder settings discover the official models with no persistent session or released user input`
- `Qoder selection checks the official model catalog and does not persist a disabled model`
- `Unexpected Qoder model work in a settings control session fails before preference writes`
- `Qoder preference commit waits for actual cleanup and a failed close retains recovery ownership`
- `Qoder cold zero-turn login failure exposes login controls; execution results are still rejected`

#### `packages/media-native/test/media-controller.test.ts`

- `browser-native video capture filenames remain Project-local WebM artifacts`
- `video chunk decoding ignores commas inside codec parameters`
- `capture IPC admits only the current media main frame`
- `Selected-video cancellation drains late initialization and removes only its new file`

#### `packages/media-native/test/media-port.test.ts`

- `Native media reply admission rejects host paths, fabricated durations and malformed tracks`

#### `packages/media-native/test/media-processing.test.ts`

- `media actions require artifact IDs and reject unbounded or ambiguous processing requests`
- `media worker admission rejects missing frames, forged timestamps and unexpected output codecs`
- `media job I/O pins the Project input and rejects links, out-of-range reads and writes`
- `media jobs roll back partial artifacts and commit only validated PNG outputs`
- `media export refuses missing audio, discarded tracks and duplicate track mappings`
- `media processing rejects transparent video instead of silently changing its colors or alpha`
- `Image admission rejects non-raster, huge or animated headers before decode and bounds cumulative pixels`
- `Image drawing admits bounded primitives and rejects executable, outside, transparent-redaction and aggregate inputs`
- `Drawing output IO has no input, bounds PNG writes and rolls back failed dimensions without changing existing images`

#### `packages/media-native/test/speech.test.ts`

- `Speech requests admit fixed models and Project artifacts, never executable, cache, prompt or CLI options`
- `ASR parser preserves out-of-audio/overlapping boundaries and token probability without claiming word accuracy`
- `Speech evidence rejects fabricated approval, foreign hashes, frame clocks and silently cleared warnings`
- `Speech mapping uses actual source trim/rate, narration offset and cumulative film time without clamping hidden anchors`
- `Speech normalization replies require actual bounded sample provenance`
- `Normalized WAV outputs reject fake headers/sample counts and preserve original Project input`
- `Speech subprocess cancellation waits for termination before rejecting and cannot leave a late output`
- `Speech subprocess rejects bounded log overflow and version/runtime failures after child settlement`
- `Speech fingerprints reject replaced artifacts even when an already-open descriptor still has the original bytes`
- `Speech subprocess keeps UTF-8 log characters intact across raw pipe chunks`
- `Speech language is an explicit fixed choice and English or automatic ASR retains source language`
- `Opus final packet padding is bounded and recorded without moving the original audio clock`

#### `packages/media-native/test/video-options.test.ts`

- `video ratios map to bounded even landscape portrait and square resolutions`
- `explicit video overrides beat template snapshots and defaults with nested watermark merge`
- `video templates and styles reject duplicate names arbitrary controls and oversized watermarks`

#### `packages/media-native/test/video-production.test.ts`

- `seekable composition validates Project IDs, bounds and real narration assets`
- `narration fixes provider and voices and rejects SSML control or arbitrary endpoints`
- `composition output handle rejects input reads and cleans partial output on cancellation`
- `Selected source sound trims, retimes, scales mono and stops at its endpoint and scene boundary`
- `Caption and source audio contracts stay closed and captions estimate within scene-local time`
- `Visual segments admit bounded clips, preserve scene time and expose deterministic fade boundaries`
- `SRT and VTT use global cumulative milliseconds, respect disabled captions and label estimated timing`
- `Bounded Project text export cancels and removes its own output without replacing existing artifacts`
- `Source focus retimes through trims and segments and keeps framing inside the original crop`
- `Recording evidence has a closed clock/coordinate domain, filters pre-roll and groups real and Agent clicks honestly`
- `Title-card reveal has bounded scene-local times, exact bullet identity and no footage; legacy bullets stay immediate`
- `Bilingual SRT and VTT select original, translation or both without changing timing`
- `Fixed templates validate bounded colors/content and reject text overflow before encoding`

#### `packages/platform/test/agent-history-store.test.ts`

- `display history survives restart, keeps bounded ordered streaming and cannot replace submission receipts`
- `history never admits foreign, out-of-order or terminal-late events and preserves corrupt saved files`

#### `packages/platform/test/agent-host.test.ts`

- `Agent input and BMW Session appear before connection; failed catalog preflight never releases the prompt`
- `provider terminal notification does not finish the receipt or release FIFO before browser drain`
- `cancel waits for the active browser tool to drain and cancels queued input without sending it`
- `cancelling another queued Session returns while the active Session keeps its browser resource`
- `failed drain quarantines resources; recovery cleans up without replaying uncertain input`
- `transport failure after acceptance keeps the delivery uncertain without inventing success or replay`
- `late or duplicate tool callbacks fail the run rather than moving admission forward`
- `a queued Session cannot execute in a different Project after selection changes`
- `approval response requires the current Project, active run and an offered choice`
- `provisional completion followed by provider failure never persists a finished receipt`
- `failed native cleanup holds admission even after browser drain and recovery never replays input`
- `late callbacks cannot resurrect an uncertain submission after its native transport settled`

#### `packages/platform/test/agent-settings-controller.test.ts`

- `Settings cancellation retains Host exclusion until actual cleanup and never exposes provider secret errors`
- `Settings cleanup failure quarantines admission; recovery retries only cleanup`
- `Model preferences survive Project selection writes and stay separate for every driver`
- `Repeated settings refresh shares the native read through cleanup; mutations and other drivers stay excluded`
- `Profile settings cache reuses each driver across Projects, marks ages independently and never admits native work on view`
- `Settings mutations replace cache after cleanup; partial failure and cancelled reads never publish fresh readiness`

#### `packages/platform/test/assistant-controller.test.ts`

- `Assistant controls persist per-Project driver selection, reject foreign Sessions and exclude transitions during a turn`

#### `packages/platform/test/bmw-catalog.test.ts`

- `BMW exposes research/media actions and the Video extension boundary`

#### `packages/platform/test/browser-user-agent.test.ts`

- `page user agent exposes Chromium without Electron or BMW shell tokens`
- `page user agent strips every BMW product brand and preserves standard Chrome`

#### `packages/platform/test/continuity-state.test.ts`

- `Unreadable login configuration or ciphertext blocks background saves and leaves original bytes intact`
- `Login-state read failures preserve both files and explicit repair/reload resumes initialization`
- `Encryption becoming available never replaces a snapshot that could not be decrypted`
- `Valid legacy login configuration and encrypted cookies restore without rewriting files; missing files initialize safely`
- `Encryption becoming available restores valid saved cookies before a background capture can replace them`
- `Periodic login maintenance handles late decryption failure without an unhandled rejection or write`

#### `packages/platform/test/conversation-store.test.ts`

- `blank BMW Sessions are durable and visible before either external Agent starts`
- `provider identities cannot silently rebind or cross Project ownership`
- `restart marks incomplete executions disconnected without replaying or losing their resume anchor`
- `foreign, running and archived Sessions cannot be selected or reordered across their boundaries`
- `unreadable saved indexes and a second stale writer never overwrite existing state`

#### `packages/platform/test/driver-boundary.test.ts`

- `Project storage rejects native provider mappings without rewriting Project documents or saved bytes`
- `Global settings require the current format and reject retired sidebar fields without an automatic conversion`

#### `packages/platform/test/feature-contract.test.ts`

- `Feature lifecycle admits named hooks and propagates activation failures before wiring`
- `Product composition freezes one BMW feature set and rejects duplicate identities and extra tools`

#### `packages/platform/test/global-settings-store.test.ts`

- `global settings default to system proxy and Google search`
- `global settings persist manual proxy and generate selected search URLs`
- `global appearance accepts one shared dark, light or system theme`
- `Current settings reload preserves appearance without a native Agent sidebar setting`
- `custom search templates require HTTP(S) and a query placeholder`
- `proxy settings apply to the persistent BMW browser session`
- `online narration defaults enabled and retains explicit boolean opt-out`

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

#### `packages/platform/test/permission-store.test.ts`

- `Agent grants/revocation and origin-specific allow/deny decisions survive reload without sharing mutable state`
- `Permission persistence failure leaves the prior file and in-memory grant unchanged`

#### `packages/platform/test/product-boundaries.test.ts`

- `BMW repository builds one app with a native Video foundation`
- `feature action collisions fail before Electron startup`
- `shared implementations never import apps; only the app selects an Agent driver`
- `BMW catalog retains one browser tool and its expected action boundary`

#### `packages/platform/test/project-panel-layering.test.ts`

- `an open Project Manager is re-raised after browser tab views change`

#### `packages/platform/test/project-source-store.test.ts`

- `Source text content deduplicates across URLs while acquisitions, missing dates and candidate confirmation remain independent`
- `Concurrent source commits and cancellation after writing remove only current text outputs`
- `Source corrupt state, mutated original text and symlinked artifacts fail closed without overwriting evidence`
- `Closed source requests reject missing ranges, credentials, injected file receipts and fictional fact-check status`
- `Current source media and proof hashes report missing/changed/linked/legacy evidence without rewriting acquisition history`
- `Capture requests require a video selector and measured source evidence cannot cross the confirmed range or claim platform completeness`

#### `packages/platform/test/project-store.test.ts`

- `requires the first real Project name without leaving a default BMW Browser project`
- `does not send existing BMW installations back through first-project setup`
- `creates, switches, updates and archives projects without deleting their files`
- `new projects accept an empty home URL and use a blank-page preference`
- `agent append is limited to memory documents and records provenance time`
- `tab state keeps only bounded HTTP(S) URLs`
- `Project persistence contains only BMW ownership and keeps independent documents across reload`

#### `packages/platform/test/remote-control-boundary.test.ts`

- `default products reject chat connector actions and retain one browser tool`
- `default desktop exposes no chat connector UI, IPC or automatic relay startup`

#### `packages/platform/test/restart-policy.test.ts`

- `allows restart when BMW has no active non-durable work`
- `blocks restart while media or scheduled tasks are active`

#### `packages/platform/test/scheduled-task-store.test.ts`

- `daily scheduled tasks use their IANA time zone and survive restart`
- `scheduled task runs are project isolated, durable, and recover interruption`
- `scheduler serializes due and manual Agent task execution`
- `Schedules require explicit driver ownership and unbound tasks can only be enabled after a BMW binding`

#### `packages/platform/test/session-continuity.test.ts`

- `encrypts and restores session cookies only for explicitly enabled origins`
- `disabling continuity removes the encrypted snapshot without clearing live cookies`
- `background keepalive uses HEAD first for an enabled origin`
- `background keepalive falls back to a bounded GET when a site rejects HEAD`
- `cookie matching includes parent-domain cookies but excludes unrelated sites`

#### `packages/platform/test/shell-ipc.test.ts`

- `Shell IPC admits only its trusted live main frame before invoking any privileged handler`

#### `packages/platform/test/state-load.test.ts`

- `Existing malformed and unsupported state never becomes a first-run replacement`
- `State read failures preserve the file and reject writes for all startup stores`
- `Missing state initializes once and BMW Project identity, documents and explicit task ownership survive reload`
- `A failed layout reload blocks updates until explicit repair without overwriting its original bytes`

#### `scripts/agent-assembly.test.ts`

- `BMW composes all three official backends through the neutral Host contract without starting them`
- `BMW default composition derives profiles from its overridden userData and rejects physical aliases`

#### `scripts/agent-data-migration.test.ts`

- `Explicit migration preserves display history, stable owners and native anchors including removed archived Workspaces`
- `Migration rejects missing native anchors and foreign Studio ownership before any state writes`
- `Failed multi-file migration restores original bytes and leaves the old Profile requiring explicit migration`
- `Migration detects stale plans and rollback preserves a concurrent edit rather than overwriting it`
- `Current Profile creation and mutation locks never silently accept or initialize an old Profile`
- `Explicit migration preserves native-only selection, infers schedule driver from BMW ownership and detaches credential links`
- `Migration refuses to overwrite an existing different harness Workspace mapping`

#### `scripts/test/module-boundary.test.ts`

- `Every authored module uses declared public interfaces, acyclic runtime dependencies and classified guarantors`
- `Dependency guard rejects private imports, driver leakage and privileged renderer imports even when the target exists`
- `Unclassified tests and missing interface guarantors cannot silently lose coverage`
- `Architecture rejects production-to-test indirection, bare Node renderer imports and unbounded production loaders`
- `Normal harness startup cannot import the explicit migration entry`

#### `scripts/test/test-selection.test.ts`

- `Renderer read change selects its direct/consumer guarantees and background runtime without unrelated codecs or speech`
- `Public contract changes include consumers; deleted/unknown/config changes fail toward full offline coverage`
- `AST dependency analysis recognizes multiline aliases, exports and dynamic imports while ignoring comment/string decoys`
- `Git selection preserves both rename paths, staged/uncommitted deletions and untracked files`
- `Browser interfaces use the neutral model-side driver fixture while DSH integration follows implementation and assembly scope`
- `Runtime validation helper changes select every dependent entry without pulling concrete DSH into Browser contracts`
- `Image decoding and visual segment contracts select their actual Studio and native runtime checks`
- `Drawing implementation and public image actions select native pixel checks and model-side MCP coverage`
- `Studio cover changes remain affected-only while retaining native/runtime and safety checks`

<!-- END GENERATED CAPABILITY AND TEST INVENTORY -->

固定中文 ASR 资源准备、原始证据和可编辑锚点的当前行为见上文“原生中文语音证据运行端口”；用户核听采用记录和仍关闭的自动精度门见 [VERIFICATION.md](VERIFICATION.md#user-listened-whisper-base-adoption)。
