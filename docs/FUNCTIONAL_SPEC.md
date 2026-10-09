# BMW 功能说明书

Browser is boundary, media is native, web is runtime.

适用实现：本仓库唯一应用 BMW（id `bmw`）。本说明书是当前功能、Schema、权限和测试的权威索引；文末能力、Studio 操作和测试清单由源码生成；运行时测试分支见 ARCHITECTURE 的生成表。当前实现核对日期为 2026-10-08。

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



普通 `video.compose` 在有宿主验证的 BMW 会话时，成功后原子保存该会话所属的新 Studio 草稿、原始分镜及已有 MP4；返回 `studioDraft` 并通知已打开的工作区，不覆盖已有草稿。已有音频保留为导入素材，不推断 TTS 生成参数。直接 `bulletRevealSeconds` 无法无损表示为 Studio 语音锚点时，保留独立成片并明确返回 `studioWarning`；没有会话的宿主调用仍只合成媒体。失败、取消、所属 Project 变化不登记新草稿。Studio 无草稿时显示明确空状态，加载完成后不继续显示“加载中”。

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

### 预览检查、视频原声双语与有限模板

更新同一草稿的预览保留当前全片时间，并将分镜、画布、时间轴与属性同步；切换草稿立即清空原画布和播放时间、恢复待准备提示。预览准备与释放串行，取消等待实际资源加载、绘制和解码器清理，过时准备不会被标记为就绪；视频时长未知显示“待测量”，不按零秒误报缺画面。制作检查读取真实素材时长并显示当前版本的实测覆盖，检查不会写回草稿。草稿更新后旧报告及关键帧失效。

后台通知先按同一 Studio 的 Project/Session 读取新状态，读取串行且工作区代次变化后丢弃旧响应；GUI 作业必须等到自己的新快照再读取新成片素材。只增加成片/封面记录、revision 和 updatedAt 的更新，在所有编辑内容、所有者及已解码素材的大小/修改时间相同且无待输入/手势时，推进已准备预览的版本而不重新解码，保留播放头、对象选择及撤销/重做。实际内容更新仅在本地干净时同步，保留选中镜头身份与播放时间并自动准备新预览；外部内容替换清空旧编辑历史。待输入、未保存或对象手势期间不覆盖字段、不移动焦点、不静默变更请求版本；新的真实成片仍可在交付历史看到，保存冲突保持可见，需明确重新加载。简单模式在干净预览工作区收到新的当前有效成片时自动显示中央 MP4；高级保持当前对象编辑，成片不自动播放，隐藏草稿预览时暂停声音。作业期间通知合并到结束后处理，不重发任何模型/媒体命令。

交付面板提供文字/字幕审片与“生成当前草稿关键帧”；按当前草稿逐分镜生成本地预览缩略图，点击返回对应时间，生成后恢复原位置。预览和原生 MP4 共用 Canvas 排版。文字全部保留，允许有限缩小字号并提示；最小字号仍放不下时，预览/编码返回 `STUDIO_TEXT_LAYOUT`，不静默截去剩余行。提示涵盖字幕阅读密度、标题卡停留时间、上方/中央字幕遮挡、缺少译文和字号缩小。审片提示不是事实核查或人工可读性认证。

`video.studio` 增加以下受限操作，继续使用原有 Session owner、Project、revision/CAS、browser FIFO、取消与素材端口：

| 操作 | 输入与行为 |
|---|---|
| `recognize-source` | draftId/expectedRevision/sceneId，可选 segmentIndex、speechModel base/small、speechLanguage auto/en/zh；固定本地 ASR 读取所选视频音轨。保留现有字幕，保存原视频与证据 SHA 及识别候选 |
| `read-source-speech` | 返回原视频秒数的原始分段与警告；源文件变化标记 stale，不自动批准候选 |
| `apply-source-captions` | sourceCues 为核听校正的 startSeconds/endSeconds/text；从原视频秒数经 trim/playbackRate/前置片段累计时长映射到分镜，共享零旁白偏移；显式替换当前分镜独立字幕 |
| `detach-source-captions` | 保留独立字幕，解除原视频时间关联 |
| `set-caption-translations` | translations 为 cueIndex/originalText/translationText；核对当前原文与版本，保留原文和时间，跳过已有 user-edited 译文，返回 skippedCueIndices |

字幕编辑器分别编辑原文与译文，共用起止秒数；`captionDisplay` 为 original/translation/bilingual，对预览、MP4、SRT/VTT 一致生效，旧单语字幕保持原来的文本。字幕人工修改以宿主可信 actor 标记，模型不能声明人工审核。字幕来源清单记录 sourceCaptionBinding、显示模式、译文来源、分镜全片起点；原声字幕没有旁白的 .5 秒偏移。同一已识别素材的剪裁、变速、前置片段时长或调序现在按已核对源字幕重新映射，人工原文/译文保留；超出核对范围、删除/替换稳定片段、来源 SHA 变化或含糊的同时字幕/源时间编辑仍阻止消费，需重新应用或显式解除关联。翻译请求交给当前拥有该草稿的 Assistant，继续使用所选官方驱动，不新增模型循环。

原声 GUI 提供 base/small、语言选择、原视频试听、识别时间/原文校正和核听确认；未确认不能通过 GUI 应用。识别与应用不生成旁白，不自动删掉用户既有旁白或启用原声，保留原声仍由现有开关控制。ASR 单个完整原视频音轨最多 180 秒；尚无长片分块/区间识别，自动词级时间仍未开放。源候选为宿主持久证据，独立字幕与模板编辑可撤销；应用源识别明确替换当前分镜字幕，不能以模型 draft 更新伪造识别记录。

`sceneTemplate` 是固定版式数据：summary 用三条要点和无画面素材的标题卡，comparison 用两项观点和无画面素材的标题卡，screenshot 用一段现有画面和一条说明。可选 accentColor/backgroundColor/textColor 为固定 #RRGGBB；emphasisIndex 为 0..2。GUI 提供版式、配色和重点选择；内容数量/素材不符合模板时阻止消费。标题卡模板不显示占位大数字，底部页码仍受 showSceneNumber 开关控制。模板不改变原素材、旁白或字幕，不接受 HTML/脚本或自由轨道。

原生卡片目录保持标题、要点、对比、数字、证据、演示、图解、素材八类。基础 CardSpec v1 使用九个固定模板（含兼容列表），新增 CardSpec v2 的证据阅读、原句重点、原文/译文、人物引述、背景数字、关键词、共同目标和范围关系，图解图片可选升级为 v2 阅读配方。目录、闭合参数 Schema、GUI、原生预览与导出共用 media-native 的 card-templates/card-details 契约；不接受用户代码、任意组件或隐藏 layer。describe-schema 发布八类摘要与 simple.cards/3，describe-template 按所选模板懒返回该类变体与其参数。图像 inspect 返回实际 Artifact/SHA-256，模型仍只调用唯一 browser。

阅读配方固定整页→重点、局部→全貌或有限顺序阅读，最多三处（译文/人物版最多一处），自动分配停留及有界过渡；不覆盖手工 focus/zoom。重点最多三组，每组最多三行源图矩形，支持框线、底色及实际已绘源像素反白。源坐标跟随同一裁切/阅读变换，人物/身份/译文为固定槽；目标属于实际源 Artifact/哈希，换图拒绝沿用旧框，同名文件变化会在预览、就绪检查、编码及提交后校验失败。人物及节点专用图也进入 Project 素材引用、解码和总预算。原句/译文分别最多 160 字符，明确译文和引述来源；一个人物图、姓名 32/身份 64 字符，两种固定位置，不自动抠图。未填专用内容允许编辑，导出拒绝空原句、缺来源、缺人物或不完整图解。横竖屏文字放不下时拒绝导出，不静默截断。

背景数字保留精确非负数/两位小数/八字符单位规则，最多一张静态依据；大字→依据读取原镜头表现时钟，退场后至少一秒阅读。关键词复用 scene.title，最多 20 字符，整句淡入/擦入，不创建逐字对象。共同目标固定二至三个对象和一个目标，标签或图片、关系 24 字符，节点可逐项出现；范围关系数值模式严格校验轴界、区域及至多两个递增阈值，符号模式明确示意/非比例，须填写轴含义及条件。复杂公式、通用图表、真实连续指针轨迹、3D 和任意 HTML 仍不在契约内。

GUI 先显示八类，更多表达按四个有变体的类别折叠；所选变体只显示必要专用槽及一个阅读/重点折叠区。真实预览框选将鼠标范围反算到源坐标、计算真实哈希，重点可命名、增行、删除、调序和修改有限秒数。专用内容沿 owner/revision CAS 与签名撤销保存，错误输入保留，Esc 取消；转换提示关闭的专用表现，Project 原文件保留。时序为估算/手工秒数，新增配方不承诺逐词 ASR 或自动跟随句锚点；已有按句 focus 入口保持独立。一个旁白段落可配既有 visualSegments，多画面不要求重复 TTS。整镜头切割保留阅读/重点/计数/退场原时钟，分配当前来源的目标，无目标的证据子段回到基础证据，旁白及字幕不重写。

文档含 v2 专用卡显式写为 2.2；基础卡/全片新设置/自动旁白回执仍为 2.1，其余旧内容为 2.0，旧版本明确拒绝新版本字段。内容签名含所有专用槽及素材，缓存按实际内容/文件检查；源变化或 CAS 冲突仅清理本次新成片和报告，旧草稿/成片保留。原生验收覆盖横竖屏新增变体、真实红→青反白像素、源变化回滚、鼠标框选/SHA、撤销/重做、译文保存及实际 MP4。OpenAI 官方博客样片使用真实公开截图/录屏、本地旁白及编辑示意图，增加阅读、反白、译文、背景数字、关键词和共同目标；署名仅为 OpenAI，未构造个人引述。字幕为句级估算；隔离测试不代表付费模型或生产 Profile 覆盖。

专项验收：`scripts/studio-next-smoke.ts` 使用临时 profile/Project、实际本地英文 TTS 视频和 Whisper base，验证试听/校正/人工译文保留、Assistant 路由、预览位置与属性同步、模板撤销重做、关键帧、双语 SRT/VTT、横屏/竖屏预览与实际 MP4 像素一致性、溢出失败清理。可通过 `BMW_STUDIO_SOURCE` 复制既有公开视频到临时 Project 验证 ASR；不写入原文件。此自动夹具不证明人工转写准确率，也不证明付费模型翻译质量。

## Project 来源与引用

来源通过既有 video.studio 的 operation:source 管理，sourceRequest.operation 为 list/read/collect/confirm/acquire。它在同一 browser FIFO 中执行；当前对话必须属于活动 Project。来源证据由 Project 内会话共享，草稿和引用修改仍受 ownerSessionId 与 revision 保护。

collect 必须提供 bodySelector，支持 index/excludeSelectors；可独立提供 mediaSelector/mediaIndex/mediaExcludeSelectors、authorSelector、publishedSelector、accessSelector 和 Project tabId。固定 DOM 脚本读取限定可见正文与 DOM 媒体，不回退整页，也不混入全页网络资源。输入框、编辑区、隐藏节点及显式排除范围不进入原文。导航、缺失范围、失败和截断分别记录；取消不保存迟到结果。作者和发表时间保留实际元素原文，缺失为 null；标题/作者/日期/限制提示超出各自上限时，获取结果记 truncated 并列出被截断的字段；事件时间另由确认操作声明，采集时间由宿主记录，不相互代替。

Project sources/catalog.json 保存 Schema v1 的页面 URL、获取记录、正文/媒体范围、原文 Artifact/SHA-256、观看限制、候选、确认和实际媒体记录。最多 200 个来源、1000 次获取、每次 80 个候选和 40 次媒体尝试；正文 50000 个 UTF16 单元/256 KiB，元数据 4 MiB。同 URL 合并来源，重复原文可共用内容 Artifact，获取记录与多个 URL 关系保留。过时 source expectedRevision 冲突，损坏目录/改变的原文保持原样并报错；拒绝 symlink，失败仅清理本次新文件。

候选区分 body 图片、cover/poster 和 video/source；发现和确认不等于下载。acquire 的 method=download 取得确认候选的有限 HTTP(S) 文件；blob、分段流/manifest 不绕过下载限制。method=capture 对已确认 video/source 候选采集 HTMLVideoElement，必须给出 videoSelector，可提供 videoIndex、maxDurationMs（1–1800 秒，默认 900 秒）。固定采集程序在同一 Project 页面验证 URL、候选 currentSrc、限定媒体范围及排除项，录制期间继续核对；不能从其他页面、范围或未确认候选获取。不自动登录或导出 cookies。图片实际解码 PNG/JPEG/WebP；视频用私有固定 media.decode.check 逐个解码可支持音视频轨道至文件末尾，保存样本数、媒体时间范围和文件哈希，最多三十分钟/512 MiB、120000 视频帧/250000 音频样本/两分钟作业。该检查不进入模型动作目录。试看/短于观察时长的文件记 partial-preview，其余有限视频记 decoded-file；完整文件解码不证明平台全长。失败/需要登录独立记录，取消清理新下载并保留既有证据。capture 独立保存 pageUrl/candidateUrl/scope、元素选择、fromStart 请求、原播放器 sourceStartSeconds/sourceEndSeconds/sourceDurationSeconds、stopReason 和 UTC 起止时间；媒体文件的 startSeconds/endSeconds 仍是解码文件时间域。播放器 ended 仅证明当前元素结束；达到上限/requested 或试看均记 partial-preview，不宣称平台全长。当前捕获使用原生 MediaRecorder、有限 Base64 拉取（每包 8 MiB、页面缓冲 16 MiB、32 个待处理块）、512 MiB 文件上限和宿主期限；取消/导航/关闭先停止并清理本次录制、恢复播放位置/暂停/loop/rate，再释放工作状态，保留已有媒体。迟到初始化有取消标记。GUI 确认的视频候选提供「采集此播放器」入口，范围选项可指定元素和采集上限。同内容媒体实际核对哈希后共用 Artifact，每次来源证明保留并保存 proofContentId SHA-256。read 和引用导出复核当前媒体/证明文件哈希，返回 mediaAvailability（每次最多共读取 512 MiB，相同文件/哈希复用核对），区分 verified/missing/changed/invalid/not-acquired/unrecorded/budget-exceeded；旧记录缺少证明哈希保留 unrecorded，不修写历史。当前证据不完整时来源预览禁用，引用清单保留历史获取与实际媒体范围并另报可用性；取消核对不写入来源或草稿。

准备页的「网页来源、正文范围与引用」展开区提供页面与正文范围选择、来源详情、原文、候选确认、事件时间、获取和已保存素材预览，默认折叠以保留笔记、大纲和素材入口。preparation.sourceIds 关联此次视频的来源。原文选区可引用到指定分镜；每分镜最多十二条 citations，包含 sourceId/acquisitionId、UTF16 startCharacter/endCharacter/quote、kind=fact/opinion、claim、conflict=pending/conflicting 和 eventAt。更新与导出均核对引用等于保存原文的准确子串。GUI 可以移除引用，沿用保存、撤销和版本冲突。来源/引用元数据不进入合成或旁白绑定，不使成片签名或未改旁白失效。

export-citations 使用 draftId/expectedRevision 创建 Project JSON 清单，最多 512 KiB，返回原文范围、URL、原文 Artifact/哈希、发表/采集/事件时间、获取状态、已有媒体范围/证明 ID 与当前文件可用性。fact 表示引用用途，factChecking 保留 pending；冲突不自动变为已核查。GUI 提供下载入口，导出不修改草稿历史。外部网站质量、B站复测和点评样片单独实测，不能由受控 fixture 推断。

资讯布局通过可选 `cardLayout: standard|news` 保存于全片参数；旧内容缺省不写入新值。news 仅支持 16:9/9:16，使用全片标题（最多三行）、顶部文字品牌、固定卡内标题/内容区域和原字幕，隐藏旧编号与进度条；标准布局保持原行为。新参数贯通命名模板、configure、Studio 预览、composition、直接成片恢复和 2.1 文档；2.0 拒绝这些新字段。全片标题的实际绘制框可点击定位原全片标题控件，不修改 scene.title。多行视频标题保留，自动封面标题将换行转为空格，显式封面不改。共享排版校验检查全片标题与卡片区域；资讯品牌固定在顶部，原位置值保留供标准布局使用。原生运行检查已导出八类标准/资讯横竖屏 MP4 并解码每卡画面；官方博客八类样片已实际导出并检查动态帧与音轨；解锁后的原生卡片编辑和窗口尺寸检查通过；样片字幕为句级估算，音轨解码/识别不替代人工核听。

全片可选 `narrationPacing: standard|compact` 用于后续生成/导入完整旁白。compact 以真实源音频长度建立显式 voiceTiming，首尾各两帧，镜头按帧网格取整（避免浮点残差额外多一帧）；不剪除文件自身静音。`audioGeneration.autoTiming` 保存宿主自动窗口快照，普通更新不可伪造或改写；只有当前播放窗口仍匹配快照，重新生成时才更新到新的完整音频长度。已修改窗口、任何 voiceSegments（含显式静音）保留剪切和镜头时长，源区间超过新音频时报错；人工字幕和独立对象终点仍约束时长。切换全片节奏不重排现有音频，新的 standard 完整旁白沿原留白。服务单测覆盖生成、导入、自动重算、元数据防伪及人工剪切；原生检查用实际 WAV 测量验证两帧起止、MP4 时长和持久的自动窗口快照。本项不代表真实 TTS 声学拼接或逐字同步验收。

## 视频参数和模板

Settings 的视频制作项支持比例、分辨率、帧率、内置画面风格、水印、配乐和 TTS。模板按名称保存在 Profile 的 videoPreferences，草稿保存参数快照；不同 Project 可使用同名模板。

优先级：明确参数 > 指定模板 > 默认值。Agent 可用 `video.settings` 读取/更新/保存模板，或在 `video.studio`/`video.narrate`/`video.compose` 指定模板名和覆盖字段。输入 Schema 闭合、有界；视频设置及草稿采用预期版本冲突检测，拒绝覆盖并发编辑。

TTS 设置只是生成参数；已有音频按分镜保存宿主生成记录 `audioGeneration`：`{kind:"tts",options:{provider,voice,ratePercent}}` 表示实际生成参数，`{kind:"imported"}` 表示手动绑定音频，`{kind:"legacy",options:{...}}` 仅保存旧音频编辑前的目标参数基线，不声称实际音色。旧草稿缺字段时保留原音频并显示「参数未记录」；后续改变目标音色/语速会标记旧音频过期。生成音频的脚本、provider、voice 或 ratePercent 改变后需重新生成，预览不混入过期旁白，导出拒绝过期音频。手动绑定音频不受 TTS 设置影响。GUI/Agent 草稿更新不能改写同一音频的真实生成记录、脚本文本及实测时长。字幕内容和样式可独立编辑，不使旁白过期。

## Video Studio

Studio 默认使用镜头卡片、脚本与预览的统一工作台；高级编辑为主动开启的全窗口多轨视图，同一 Assistant 转为浮框。两种视图共享草稿、媒体、撤销和归属，没有第二个自然语言输入。用户已要求暂不继续 UI／工作流优化；本轮仅核查一致性。专用 AI 图片／视频素材生成暂缓，素材准备使用现有 Project 文件及浏览器采集能力。

卡片拖动提供明确的前/后插入位置及边缘自动滚动，只在松开时沿原 CAS 保存，可撤销。未保存输入先正常保存；保存期间已松手或取消，不延续拖动。同版本预览和任务刷新保留手势及标记；Project、Session、草稿/revision、模式变化，以及 Esc、区外松手、指针取消、失焦和缩放取消。镜头身份、旁白、字幕、图层及旧成片保留；不新增按钮，原菜单调序继续可用。

可选测试版审阅支持字幕样式与原文/译文/双语显示建议，使用有限结构化 before/after（null 表示未设置）和已有样式契约。建议保存不改画面；用户逐条采纳/忽略/撤销，保留字幕内容、时间、来源和实测旁白。字段或定位时间变化时拒绝覆盖；未设置字段撤销后恢复未设置。前后对照用可读样式标签，不新增常驻按钮或模型工具；实际画面依据与建议质量仍需人工核对。

自动打开高级 Assistant 时，若正常 320px 高度的四角都遮挡所选对象，尝试使用最大可放置的 240–320px 高度，保留输入和发送区并避开播放控制；已选高度随此 Session 的打开浮框保留，选择变化不跳动。用户拖放保留位置与高度；未手动摆放的浮框明确重新打开时重新计算。该高度由原生 Host 内部布局回传，不新增用户/模型参数或编辑草稿数据。

素材准备提供同一全片任务入口“让助手准备素材”，在目标与素材及高级素材资源区复用。允许零分镜草稿；提交前保存当前输入并捕获 Project/Session/草稿，阻止重复提交和同一 Assistant 忙时提交，沿用原归属及 expectedRevision 检查。任务只复用/采集真实 Project 文件并合并 preparation，实际列表随后台更新，不自行更换画面、创建镜头或制作成片；专用 AI 图像/视频生成服务仍未接入，不把任务已提交当作完成。

高级画面与独立图层提供默认折叠的“颜色与模糊”：亮度 0.25–2、对比度/饱和度 0–2、模糊 0–12 输出像素。使用封闭数值 effects，按固定顺序绘制，不接收 CSS、URL 或脚本。主画面仅处理素材，不改变标题、字幕和聚焦标记；独立对象仅处理其自身。可明确清除效果；修剪和分割保留参数；主画面可卡片往返，独立图层按共享兼容性约束保留高级编辑，沿用原保存、CAS、锁定、撤销和共享预览/原生导出。

主旁白提供“静音此镜头全部旁白”，独立于 voiceVolume，保留原音量、实测音频、voiceTiming/voiceSegments 和字幕。旁白片段共享镜头静音状态，界面明确作用范围，时间轴文字标识静音。视频画面属性提供“静音此画面片段原声”，沿用 keepSourceAudio，不改源区间、sourceVolume 或原声字幕绑定。两者复用保存、CAS、撤销和预览/原生导出；静音或零音量旁白不触发背景音自动避让。普通 Agent 更新省略 voiceMuted 时保留当前值，显式 false 可取消静音，带 undefined 的 GUI 历史快照可清除此字段。无旁白时控件禁用，图片不提供原声控制。

### 有限多轨与独立对象

有限图层使用镜头局部 `layers/audioTracks` 与全片 `layers/audioTracks`，每个容器各最多八项、全片最多 64 个独立对象。视觉对象为文字/矩形/Project 图片或视频，时间、标准化几何、透明度、层次、显隐/锁定、淡入淡出及显式 2–12 个关键帧为封闭字段；同一时刻最多四个视频叠加解码器。图片沿用共享 32 百万像素/256 MiB 预算，视频解码检查实际尺寸、透明数据与源区间。独立音轨按实际源区间/速度/音量流式混合，支持静音、淡入淡出和旁白实际区间内降低至 25% 的配乐增益；预览与 H.264/AAC 导出使用相同混合与图层绘制。越界对象保留原值并阻断预览/导出，不静默截断；普通更新省略既有图层时保留；清除独立对象须在可信高级编辑中执行，简洁更新不能用显式空数组丢弃对象。新素材必须在当前 Project 中通过 ArtifactJobIO；复制镜头给局部对象新身份。没有 shell、HTML 或任意渲染脚本入口。高级资源分素材/脚本/元素/音频；文字、矩形、图片、视频和音频可加入当前镜头或全片容器。音视频按实际可解码轨道的首时间戳和终点确定源区间。对象可从画布命中或独立时间轴选择，属性支持内容/几何/层次/显隐/锁定/音量/静音/旁白避让/淡入淡出和显式关键帧，使用同一草稿 CAS、撤销、保存与预览。时间轴独立片段可拖动移动、两边修剪、按播放头分割；缩放保留对象选择。关键帧裁剪保持边界样本；缓入缓出采用受限 `easingRange: [from, to]` 保留原 smoothstep 的连续区间，重复修剪/分割及播放头插点保持位置、尺寸和关键帧透明度曲线。该字段只用于缓入缓出，两个有限端点必须在 0–1 内并严格递增；不接受曲线代码或表达式。共享绘制器按区间重新归一化，原先无区间字段的动画保持原行为。属性标明“保留原曲线”，明确修改插值会重设该段曲线。保持区不制造额外无用端点，切割十二关键帧的动画仍在既有预算内；新增点超过十二个则拒绝并保留原值。片段淡入淡出的边缘行为沿用既有规则，本项不代表所有效果的无损裁剪。保存冲突保留对象输入和当前模式，明确确认重载后才放弃。独立对象存在时拒绝返回卡片并保留对象及选择；撤销或移除后恢复简洁编辑资格。当前画布选择、移动、缩放与实时像素更新已接入；空白选择打开原有全片参数，按草稿版本应用、可撤销，模式切换保存参数并保留全片选择。主轨、有限整镜头分割和逐项审阅使用下文同一契约。受限对象与动画不构成通用 NLE；超出契约的复杂绑定仍拒绝。

独立图层和音轨的时间轴行提供一个对象菜单（亦支持右键与 Shift+F10）：编辑属性、锁定/解除锁定、隐藏画面或静音/取消静音。使用已有 locked/hidden/muted 字段和原 CAS/撤销/预览/导出，不新增副本或工具。菜单捕获所属草稿、会话与 revision；版本、模式或归属变化关闭菜单，过期点击拒绝。锁定对象的可修改参数、删除、动画及分割呈禁用，仍可解锁、隐藏或静音；锁定沿用既有编辑保护，不作为宿主权限。菜单键盘导航和 Esc 返回触发点；滚动/缩放窗口关闭菜单，避免悬在错误轨道。

高级编辑的画布与时间轴之间提供可聚焦分隔条：默认约占可用编辑区 34%，拖动或上下方向键调整，Home/End 到最小/最大，Esc、指针取消或窗口失焦恢复本次拖动前高度。边界保留至少 220px 上半编辑区；轨道在时间轴内滚动。按 Project/Session/草稿保存当前 View 的比例偏好，往返保留，窄窗仅限幅，不改视频数据、revision 或撤销历史。布局变化同步原生 Assistant 避让区域及响应抽屉。

单画面和各 visualSegment 支持最多 24 个有序、非重叠 `focusIntervals`：`startSeconds/endSeconds` 是原素材秒数（图片为原画面效果秒数，内容分割后保留），最短 100ms；`x/y` 为完整源画面中心 0–1、`zoom` 为 1–4、`emphasize` 控制中心标记。焦点在原 crop 内平滑进出，预览/MP4 使用同一绘制与 trim/rate 映射；时间轴投影重点区间。画面属性提供添加、修改、删除及撤销/重做；聚焦输入在分镜/Session 切换前保存。焦点不重录视频、不使未改旁白过期，但使旧成片复用失效。替换画面移除旧素材的焦点；追加片段保留原画面的焦点。保存失败后的本地焦点仍可删除：删除先移除目标再提交修正后的草稿，不重试已被拒绝的旧草稿；删除目标正在输入的参数随目标一并移除，其他参数输入仍正常提交。删除支持撤销/重做，仍遵守所属 Session 和 revision 冲突检查。

`suggest-focus` 要求所属 Session 的 draftId/expectedRevision/sceneId，支持 segmentIndex；只读取当前 Project 对应录制事件文件，返回实际记录与确定性点击分组建议，不写草稿。建议只使用有实测帧映射且位于录制表面内的点击，缩放上限 1.5。GUI 接受建议后仍可逐项修改；已有手动区间不会被覆盖。普通视频/图片可手动聚焦，缺少录制事件明确提示自动建议不可用。建议不证明操作结果或页面正文都在焦点内，交付样片仍需审片。

画面素材选择统一提供列表／图标视图、按可见区域加载的真实图片／视频缩略图及放大预览；覆盖素材准备、匹配、工作台、封面和画面片段。预览只读取当前 Project 素材，沿用读取／解码预算、媒体控件与切换取消；显示方式切换不修改视频草稿。

交付页可直接查看／另存任意已有成片。`render` 默认复用内容及文件签名一致的已完成 MP4，不启动编码、不增加草稿 revision 或成片记录；`forceRender: true` 明确重新制作。后端签名包含有效合成参数和源素材／输出／验收报告的文件状态；分镜、字幕、音频、尺寸或文件变化使复用失效，封面与准备笔记不影响视频。旧记录缺少签名时仅提供手动查看／另存，不推断为当前成片。签名由完成作业记录，编辑不能伪造；归属和 revision 检查继续执行。

草稿保存在 Project 中，但由不可修改的 `ownerSessionId` 强绑定到唯一 Session。一个 Session 可以拥有多个草稿，共用 Project 素材；列表、读取、修改、生成和删除均在后端校验可信调用身份，另一 Session 不能编辑或继承草稿。Bridge 将已认证 Session 身份传递到执行链，Renderer 的归属由主进程确定。未绑定的历史草稿默认不可见，不自动认领。切换 Session 前保存已输入编辑，切换后显示该 Session 的草稿及独立选中状态；没有草稿时显示空状态。草稿 Assistant 请求提交到其所属 Session。当前 Studio 作业未完成时拒绝切换。

「删除草稿」要求当前版本并确认，移出活跃草稿列表，保留 `video-studio/deleted` 中可恢复记录；不删除 Project 共用素材、封面、字幕或成片文件。删除最后一个草稿恢复空状态。

Studio 使用主工作区，不创建独立退出入口。GUI 与自然语言共享当前 Session 的草稿、选中分镜、阶段、版本、材料和导出结果；DSH 驱动在官方上下文快照中注入当前 Studio 数据，数据不被当作权限提升指令。

默认「卡片编辑」把纵向镜头卡片、同一份 scene.narration 脚本和预览放在工作台。当前卡片复用 canonical script-current 编辑器，不维护另一份脚本；只展开所选卡片，其他卡片保留可读正文、缩略图和旁白状态。当前卡片只常驻「换画面」「声音与字幕」两项详情入口；画面取景和明确标识的 Assistant 委托放在镜头菜单，可关闭详情继续复用原有编辑器。支持按镜头 ID 校验的拖动调序及菜单调序、复制、删除和撤销；Project 原素材不重复复制、不随镜头删除。目标、背景、受众、大纲与素材集中在「目标与素材」详情；空状态示例只预填原有 Assistant 输入，发送后才执行。

主轨操作按镜头 ID、片段类型/索引和捕获的 revision 校验。镜头调序保持卡片顺序一致；主序列改时长顺移后续镜头，局部对象仍属于原镜头，全片对象保持绝对时钟。越界对象、字幕重叠或引用无效会拒绝操作并保留原值。旁白新增可选封闭 `voiceTiming {startSeconds,sourceStartSeconds,durationSeconds,playbackRate}`；`audioDurationSeconds` 仍是原文件实测长度，不作为播放片段长度改写。默认仍从 0.5 秒播放完整旁白并保留 1 秒总留白。明确编辑的播放区间按实际解码音频复核，预览、AAC 混音、配乐避让、估算字幕及人工句锚点共用该时钟。句锚点保留原音频秒数与哈希，修剪排除被引用句时要求明确调整引用，不自动截断。独立字幕时序修改不改写旁白。时间属性输入在外部更新/版本冲突中保留，用户明确重载才放弃。字幕来源 receipt 记录 voiceTiming；不把估算字幕当作自动对齐。

旁白可在播放头处分割为一至八个 `voiceSegments`，与 `voiceTiming` 互斥；每段有稳定 ID、镜头内开始、原音频源开始、播放长度与速度，输出按时间排序且不得重叠，实际源区间复核后才能播放／导出。分割保留原文件、原实测时长、正文和句锚点哈希；连续源／输出的切点合并句投影与配乐避让，避免人为插入淡入或重复句动画。移动／修剪／速度编辑只改选中段，不伪造词级时间。独立人工字幕不随旁白重写，关联句投影到可见区间；完全移除仍被引用的句须先处理引用。换文件或重新配音显式清除旧播放区间；旧调用省略该字段时保留已有片段，GUI 撤销用显式清除恢复原时钟。

主画面分割保留镜头、旁白、原句锚点和独立字幕，不改写源文件；左片段保留既有 ID，右片段生成新 ID。封闭的 effectWindow 保留原始推近、图片聚焦和淡入／淡出的秒数域；视频聚焦继续使用原视频秒数。明确改变片段转场可建立独立透明度时钟，仍保留画面运动时钟。连续、同原声音量的分割片段复用同一次原声解码，避免 AAC 在每个切点重复起跑；连续同源、同速度、同源区间的分割片段投影成一个原声字幕播放组；宿主据旧身份或唯一相同播放时钟重定位可信证据／字幕绑定，人工原文及译文不覆盖。实际移动、修剪、换素材或调速造成播放组变化时原绑定仍可判为过期，不能仅靠文件名猜测重新绑定。效果窗之外的扩展不自动建立新来源时钟；有限整镜头分割见下文。

时间轴单击主片段只选择并暂停，不移动播放头；原生标尺输入和键盘定位沿用同一播放与版本保护。主画面和旁白片段的 ID 可成为 Assistant 精确对象范围，第一次输入后独立固定；GUI 撤销移除片段后清理失效选择，但不改变已固定请求，发送时仍拒绝被删／错误类型／其他镜头的目标。

高级编辑需主动开启，宿主将 Studio 扩展到完整应用内容区，隐藏浏览器 Shell 与固定聊天侧栏；应用内沉浸不改变操作系统全屏状态。上半部资源左侧、画布中央、所选分镜画面／旁白／字幕属性右侧，底部展示同一草稿的主轨与独立图层/音轨。主镜头可拖动调序、右边缘改时长，画面片段可调序/修剪；旁白可移动/修剪并精确设置源区间、播放长度和速度；字幕可移动/修剪/按播放头分割，保留双语内容。独立对象可移动、修剪与分割。主画面可在播放头处分割为最多八个内容片段；有限整镜头内容分割已实现；超出可信来源范围的复杂关联重绑定拒绝。切换前保存输入、校验版本、暂停播放；失败保留当前视图与输入。进入高级时回到草稿画布，准备当前预览后启用定位，避免沿用成片视图或待准备的 1 秒范围。往返保留草稿、选中分镜、播放位置、撤销／重做、原 Assistant WebContents 与未发送文字；返回恢复侧栏宽度。高级编辑进入时，先完成保存和工作区重排／实测边界，再自动将原聊天展示为最大 320×320 的小浮框；可收起为状态胶囊。修改分阶段确认等任务偏好不会关闭已打开浮框或重新打开用户已收起的聊天。浮框位于实测属性列左侧，限制在时间轴和实际播放条上方；Renderer 可上报闭合数值范围内的 floatBottom，为自由浮动额外预留播放条，主动停靠仍使用完整属性区。自动选位的浮框在明确收起后重开时可重新避让当前对象；已打开的浮框和用户手动位置不因选择／播放改变而跳动。浮框保留范围、输入、最近消息和任务状态，完整会话可展开；驱动切换仍可通过设置操作。用户主动停靠时才替代属性区，收起恢复属性；Renderer 通过合并计时器、resize 和尺寸观察上报实际属性列边界，Native View 依此停靠；上报不依赖 requestAnimationFrame。原生 Studio/Assistant 层级直接重排已挂载 View，避免不必要的拆卸；隔离桌面验收须等待实际渲染后比较同一时刻 DOM 与原生边界。较大窗口默认自由浮动；小于 1000px 的窗口暂时停靠。小窗关闭不覆盖用户的浮动偏好，恢复大窗后按原偏好和位置展开。宿主模态层及 Studio 详情暂时隐藏聊天，关闭后恢复。

高级资源/属性响应布局使用同一 canonical DOM：宽度 ≥1100px 保留两侧栏，700–1099px 把资源折为可打开抽屉，<700px 将资源和属性折为一个非模态抽屉。打开/切换/关闭先保存输入；资源与属性详情互斥，宽窗恢复时把原节点移回，未保存字段不复制或丢弃。抽屉仅占上半编辑区，时间轴继续可操作。高级模式的原生主窗口最小尺寸为 420×640，退出后恢复 960×640；若返回时低于普通宽度则扩至原最小宽度。小窗聊天按实测上半区宽度停靠，详情期间暂时隐藏原聊天。

原生浮框首次展开根据资源/属性边界及选中对象的实际矩形选择遮挡最少的角落；空间不足不保证零遮挡。首次自由位置确定后保留，后续选择/播放不自动跳位。标题栏拖动合并连续指针请求并顺序移动同一 Native View；Esc、取消或失去手势恢复起点，收起/停靠先结束并排空拖动。拖动、收起和停靠都捕获 Project/Session，宿主拒绝过时归属；请求不改变草稿或发送模型输入。几何契约允许紧凑停靠属性宽度最多为整个窗口，资源宽度最多一半，避让矩形闭合且不得越过标准化窗口边界。

离开 Studio、切换会话或替换当前 View 时，宿主记录实际暂停的 View 并发送隐藏通知。返回已缓存的同 Project／Session 工作区也必须在归属校验通过后发送恢复通知；不能仅依赖 owner 是否变化。原 Renderer 恢复顺序读取和合并通知，获取新增 Project 素材，不改写草稿或重新发送请求；重复打开已经活动的 View 不重复重置预览。销毁时清除暂停记录。

聊天在开始输入时固定「整支视频／镜头／画面、旁白或字幕」目标；后续界面选择不会改目标，可主动更改。未发送文字和目标按 Project/Session 保留。提交由原 Assistant 主框架经闭合 IPC 验证归属及目标存在，先保存 GUI，读取目标最新 revision 并冻结上下文进入 Host FIFO；DSH 官方上下文入口与其他驱动使用同一活动请求快照。拒绝外部发送者、跨 Project/Session、已删镜头、保存冲突和非法字段；拒绝保留输入、不产生请求。独立视觉图层和音轨使用闭合的 layer {id,kind}，镜头内对象附 sceneId，全片对象不附 sceneId；不能混用旧 objectKind。Host 保存前后检查精确容器、对象类型与存在，并把名称/时间等有限数据冻结到请求上下文。对象属性的“让助手调整此对象…”只预填，不执行；已有未发送文字时保留原文和目标，不追加另一条委托。当前选择已删除的对象不能成为新的 live 范围，已固定请求仍会在发送时拒绝。主画面对象范围可带 visualSegmentId，必须同时为 object／visual、带所属 sceneId，不能混合旁白 ID 或独立图层；身份格式沿用已有画面片段的闭合字符集。宿主校验当前草稿的精确片段存在，冻结名称、镜头内开始及长度。时间轴选择携带实际稳定 ID，调序后重新按身份解析当前位置；删除后清除 GUI 选择，固定请求仍在发送时拒绝。尚无持久 ID 的旧单画面沿用镜头画面范围，不在选择时改写草稿或制造临时身份。该范围是用户请求上下文，不扩展或替代 browser 的授权。既有 browser 工具数、官方循环、取消清理与未知投递不重发规则保持不变。可选“分阶段确认”是冻结的任务说明，实际模型遵从仍需效果验收。

Studio 任务卡读取宿主统一 Assistant 会话状态与实际 browser 工具事件，严格过滤 Project/Session，区分排队、执行、等待、取消清理、失败和未知结果。停止委托宿主原有取消链并等待清理，不自动重发未知任务。对话成功结束不被当作成片生成；卡片另外显示真实草稿/素材/导出记录。保存与原生媒体作业进度分别显示，不估算 Agent 百分比。DSH、Codex、Qoder 共用该投影，无额外模型工具或 Agent 循环。

成片生成时简单视图可展示实际 MP4并切回草稿；旧文件和当前草稿独立保留，复用状态来自后端指纹。顶部单一交付入口随状态显示「生成视频／制作更新／导出视频」，先打开检查与导出面板，列明待制作旁白镜头。用户确认后仅执行 narrate-pending 中失效或缺失的旁白，再用当前 revision 执行完整 render；生成过程锁定编辑，取消／失败保留已经提交的旁白和旧成片，不继续后续编码。当前有效成片直接复用，不重配音、不重复增加导出记录。视频编码仍可能重做全片。强制重做、封面／字幕／历史及默认关闭的可选测试审阅位于二级入口。真实素材、时长、语音、预算及编码技术门槛继续约束导出。

主轨由已有顺序分镜、视觉片段、旁白播放窗口和字幕区间投影；独立轨道由持久化 layers/audioTracks 投影。手动编辑写回同一规范字段，不另存一份时间轴模型。点击分镜或片段定位累计时间；播放/跳转跨分镜时同步列表、属性、时间轴与原有 Agent 选中上下文。字幕仍标注估算或编辑来源；过期旁白标注需重生成。切换属性、封面、设置或交付前保存聚焦输入并检查版本，保留撤销/重做。

封面模式中央只展示独立 PNG，左侧编辑全片封面，暂停视频播放并隐藏视频时间轴；零分镜也可使用。交付集中 MP4、封面 PNG、SRT/VTT、制作检查、字幕下载和历史成片/验收报告。任务状态与保存状态分开显示，媒体作业运行时才显示取消入口；未更新预览显示提示。布局支持窄窗口和明暗主题，仅开放已有保存、共享预览与真实导出实现的有限图层/显式关键帧控制。

默认工作路径：可选填写目标／受众／背景 → 准备真实素材 → 在卡片内编辑脚本和画面 → 预览 → 检查与导出。材料、全局脚本、旁白、匹配和详细属性是按需展开的编辑入口，不要求用户逐阶段通关。高级模式把同一内容呈现为多轨工作区，导出规则一致。审阅是交付区默认折叠的测试功能，不成为导出门槛。

`video.studio` 的操作全集从有效 Action Schema 生成在文末。请求使用 Artifact ID、Draft ID、Scene ID 和 expectedRevision；update 的草稿为受限对象，无任意 HTML/脚本。attach 验证真实媒体类型和归属。视觉修改保留未改脚本的旁白绑定；脚本变更要求重生成。空草稿可保存、准备素材、配置和制作封面，不能导出视频；最多 24 分镜、180 秒全片，素材集合与正文有明确上限。

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

## 共享视频文档与编辑器兼容性

Video Studio 保存 format=bmw.video / schemaVersion=2.0 的单份规范文档。content 分为 settings、brief、story.scenes、timeline.regions/tracks/clips 与 cover；records 保留 Host 的媒体/语音来源与实测绑定、审阅/参考和导出日志。story 不保存镜头位置或时长，region 是全片顺序和时间权威；字幕 clip 使用 start/end，其余显式 clip 使用 start/duration。放置时间是 1000000 ticks/s，迁移残差最多 ±0.5 微秒，源媒体秒数与原始时钟完整保留，分数帧率和任意空隙/嵌套序列尚未开放。预览、导出和旧 read/update 使用受校验的无损 v1 投影，不持久化第二份草稿。

simple.cards/3 是高级模型的可逆子集，继续接受原 simple.cards/1 的内容；仅进入高级模式、主画面/旁白裁剪、固定效果等不永久锁定。任一独立叠加图层、独立音轨或自由关键帧要求高级编辑；隐藏/静音/锁定仍存在。compatibility 根据当前内容/版本返回对象、路径、原因。简洁写入同时校验当前和最终合并后的候选，不能用遗漏字段/空数组丢弃高级内容；返回卡片由 Host 校验当前 owner、selection/revision、dirty 和兼容性，UI 提示原因。撤销/移除这些对象后可恢复卡片资格；已保存的高级草稿在卡片视图只读，可从原入口进入高级。无自动有损降级。

唯一 browser 的 video.studio 提供 describe-schema、read-document、compatibility、validate-edit、apply-edit、migrate-document。类型命令包括 scene.set/reorder，clip.move/trim/split/effects/mute，layer.add/set/remove，固定 ID、类型和全片时钟；最多 32 条，一次 CAS 保存。试算不写入，结构/原生支持、可逆性与实际渲染就绪分别判断；真实素材准入、翻译保护、源时钟/日志保留沿现有 Host 校验。Agent 不能自行声明高级权限，提交前重新核验可信当前高级界面与 Project。试算不证明媒体/排版或渲染成功，生成的新 ID 必须在 apply 后重读。

旧 v1 只读加载不改文件；首个成功编辑或显式 migrate-document 才升级，迁移前把原字节按 SHA-256 保存到 Project video-studio/schema-backups。迁移不改内容版本或媒体/成片；所有字段反向投影不同、超限或无法表达时拒绝写入。固定 owner、同版校验、原子文件替换、私有备份和签名历史保持。

[Video Document 2.0](VIDEO_DOCUMENT_V2.md) 说明实际字段、能力预算及迁移，[Agent 视频接口](AGENT_VIDEO_EDITING.md) 给出调用约定。机器 Schema 与示例由运行时类型编码器生成并纳入 npm run check；video.schema 覆盖迁移/闭包/字段完整性/权限，studio.schema 覆盖真实鼠标对象创建、UI/IPC 返回限制、陈旧版本、签名撤销、试算和原生 MP4。专用 AI 素材生成继续暂缓。

## 模块接口与测试分类

模块定义与依赖方向见 [ARCHITECTURE.md](ARCHITECTURE.md)。十个产品包、应用组装和验证工具拥有明确职责，跨模块仅能依赖 package exports 指定的公开文件。Feature 生命周期、Browser 宿主与原生媒体端口有具名 TypeScript 接口；未知跨进程输入与媒体回复仍须运行时校验。公开接口有正反类型消费者、运行时契约测试和对应回归保障。

Browser 与 AgentDriver 的直接保障不依赖具体 DSH 实现；通用 driver 夹具从 Platform 注入的连接配置出发，经 MCP 适配器和 Bridge 实际操作 Project 页面，并验证权限、绑定及切换后恢复。DSH 的安装版兼容性与持久化绑定验证单列为具体实现/产品装配保障，按 Agent 契约、DSH 实现和产品组装范围选择；Browser 模型接口（Schema、目录、Bridge、MCP）单独改动不会自动启动 DSH。完整离线基线仍执行 DSH。

测试分为 unit、contract、boundary、type、integration、desktop、media、external。`test:plan` 给出选择依据，`test:affected` 根据文件依赖、行为 watch 和接口矩阵执行受影响保障；任何源代码改动保留全局边界。共享验证辅助库的改动自动沿导入/重导出闭包选择所有运行时消费入口；生产模块仍使用接口/行为范围。未知/删除路径、共享配置及验证代码中无法证明的动态导入升级为完整离线集。生产代码不得依赖测试目录或验证工具；Renderer 禁止裸名称或 node: 前缀的 Node 内建模块。生产计算式导入默认拒绝，仅 DSH 插件允许解析声明的固定安装包字面量，不允许新增任意计算式导入。测试未分类、接口保障缺失或生成文档过期直接失败。新构建的源码/输出哈希收据防止使用过期 JS，只有完整离线集通过才更新验证基线。

固定中文 ASR 资源准备、原始证据和可编辑锚点的当前行为见上文“原生中文语音证据运行端口”；用户核听采用记录和仍关闭的自动精度门见 [VERIFICATION.md](VERIFICATION.md#user-listened-whisper-base-adoption)。

画布独立视觉对象的选择边框和拖动/缩放手柄是 GUI 覆盖层，不写入视频像素。点击和手势按实际 object-fit 留白后的画幅映射；镜头局部/全片对象保持原身份、时间和来源。变换对原有各关键帧应用相同位移/尺寸比例并以所有帧边界限制；不暗中生成动画、不改变 easing。一次拖动对应一次版本校验保存与撤销，指针取消/失焦恢复反馈；锁定、保存中和待处理属性输入阻止变换。拖动期间复用已准备的素材、音频与共享导出绘制器，合并指针事件为单个进行中绘制和最新几何，不为每个事件重新解码素材或建立音频上下文。临时覆盖仅允许同一已准备草稿/镜头/对象的几何变化，不能改来源、时间、文字或关键帧时钟；松手前不写草稿。Esc、指针取消、失焦和切换模式恢复原画面；切换/销毁在释放素材前排空临时绘制，避免迟到帧污染新预览。高级低频操作进入“更多”，复用并移动原 DOM 控件，返回卡片恢复原父节点；重复分镜条隐藏，由时间轴保留镜头导航。

点击画布无独立对象的区域选中全片设置，清除对象选择，发布整片范围并暂停预览。全片参数复用同一 `VideoOptionsForm`、模板及应用控件，临时移动到属性区；原设置对话框打开时移回，关闭后恢复，始终只有一份控件和参数。声音、品牌水印与模板按需展开。待应用参数不会在普通 render 或外部更新中重置；视图/会话切换前通过 configure/CAS 保存，一步撤销，失败保留输入和原视图，明确确认重载后才丢弃。无高级对象的草稿可往返并恢复全片选择；含独立对象时保存待编辑参数，但返回卡片被兼容性约束拒绝，保留高级选择。

预览完成不得覆盖主轨、独立对象或其他待保存字段的外部更新/冲突提示。实际预览准备完成只更新预览状态；存在待编辑输入时保留当前保存提示，避免把未提交或版本已变化的输入称为“草稿已保存”。主轨保存仍使用捕获的 Project/draft/revision 和原 CAS，不自动重放到新版本。

### 独立对象分割后的原淡入淡出

图层和独立音轨新增可选封闭 fadeWindow {originId,startSeconds,durationSeconds}，原时间范围 0–180 秒、长度至少 0.1 秒、当前片段须完全落在原范围内。分割/修剪保留原淡入淡出秒数，在原效果时钟上取样；短片段不重启/压缩效果。已有无窗口对象沿用原行为。视觉透明度和流式音频增益共用 layerFadeGain，关键帧仍独立保留原限制曲线。生成的曲线子域端点只在原合法端点内消除浮点舍入，用户输入验证不放宽。

同源、同原效果身份/时间、相邻播放/源区间且速度、音量、静音、旁白避让和淡入淡出一致的音频切片复用一次连续解码，避免 AAC 片段处重复引入解码起始差异；独立修改任一策略会分开处理。对象身份与持久切片保留，不压平轨道。原素材不改写。

所选对象的折叠淡入淡出属性标注「保留原曲线」，原秒数只读；明确「按当前片段重设淡入淡出」才移除窗口并将秒数限制到当前片段。操作保留媒体、几何和关键帧，用原 CAS 保存/撤销。淡入淡出/清除动画预设明确重设效果，单纯编辑文本/位置/音量不重设。超出原窗口的时长编辑拒绝并保留输入。此项不代表整镜头分割、全部效果、参考生成素材或逐项审阅已经完成。

### 原声字幕随主画面重新映射

SourceCaptionBinding 增加可选封闭 sourceCues、sourceRange 与 visualSegmentId；sourceCues 最多 100 条、源时间 0–180 秒、原文/译文各最多 200 字，区间排序不重叠，sourceRange 必須同时提供并包含所有核对区间。新的 apply-source-captions 保存用户核对的完整原声 cue 及实际原文件范围，并对已存在稳定 ID 的连续源组保存准确片段身份。旧数据不自动获取全源审核资格：首次映射只能保留当时可见的源范围，越界须重新应用。字幕/原素材/证据文件不重写。

主画面移动、修剪、源起点/速度和前置片段变化，经同一源组重新投影字幕，无旁白 .5 秒偏移。保留当前人工正文、译文及来源标记，镜头边界截断不猜测词级时标；根 cue 中未播放的核对部分仍保存，再次扩展可恢复。单独字幕正文/时间编辑同步回源 cue；宿主翻译操作同样保留根记录。直接提交不能伪造 sourceCues/sourceRange、人工来源、SHA 或稳定目标，宿主只使用原可信记录。稳定片段被删除或换成另一 ID 时不自动采用同名文件；普通编辑删除稳定 ID 后不能采用同名无 ID 画面；恢复原无 ID 的旧状态必须通过宿主已确认的完整历史快照。未分段画面没有画面片段 ID，镜头 ID 不被借用为字幕目标。

画面时间与字幕正文同时变化且既非原字幕也非确定的新投影时，返回 STUDIO_SOURCE_REBIND_CONFLICT 并不写新版本。超出核对范围返回 STUDIO_SOURCE_CUES_REQUIRED；有独立时间区间的旧字幕不会被默认为全源字幕。源 SHA 校验、Project/Session 归属、CAS、FIFO、取消、原语音锚点和单 browser 边界保持。生成的投影时间在真实镜头/片段范围内消除浮点终点越界；外部输入验证不放宽。所选主画面属性提供简短说明，错误保留当前输入。

这项完成当前原声字幕的复杂源时间重映射，为整镜头分割提供基础；整镜头内容/旁白句锚点拆分、剩余有限效果、参考/生成素材、逐项实验审阅与完整制作/压力验收仍属于原设计待办。

时间轴主轨编辑在保存后继续持有操作，直到选择恢复及真实预览准备完成，才重新开放分割与播放头；连续操作不会读取上一次的左侧选择。当前原生事务专项和完整前台鼠标回归分别记录，后者仍需解锁桌面后原样补验。


### 宿主已确认的历史恢复

list 为同 Project/Session 的每个当前草稿内容返回 snapshotProof。当前进程的服务使用私有随机密钥，对规范化编辑内容及 Project/Session 作 HMAC；版本/更新时间和导出记录不属于可恢复内容。restore 封闭请求必须提供 draftId、当前 expectedRevision、完整原草稿及 64 位十六进制证明。内容、审核来源、素材、owner 或其他字段不同均拒绝；另一服务实例、新进程或外来 Project/Session 不可采用。签名不验证素材当下的真实性，不替代消费前的 SHA、锚点、编码及媒体检查。

现有撤销/重做在捕获已保存、内容相同的快照时记录此证明，恢复被删除镜头时可保持宿主已确认的句锚点、原声识别/根 cue、人工译文和音频测量。restore 保留最新视频/封面导出记录，使用原 CAS 和新版本写入，并继续 owner/FIFO/取消边界。没有证明的未保存历史仍走普通更新；无效证明不会回退为普通更新或重放，输入/错误保留。无新增用户按钮、模型循环、工具、路径、磁盘历史或生产数据迁移；证明随宿主服务生命周期失效。该基础用于整镜头分割，新分割及完整工作流仍按原设计推进。

Studio stop 先关闭新的 IPC/打开准入，再关闭所有 View 并等待已打开或正在打开的素材句柄完成关闭；停止后不重新打开 Studio，排队中的旧素材读取不得新建句柄。

### 原始镜头时钟与明确静音

共享合成支持有限 presentationWindow：originId 为 1–80 个字母／数字／连字符，startSeconds 为 0–60 秒，durationSeconds 为原镜头 1–60 秒，musicIndex、sceneNumber、sceneCount 为 1–24 的整数；子段必须完全在原镜头范围内，sceneNumber 不超过 sceneCount。标题入场、要点出现时间、画面编号／进度和自动配乐使用原镜头时钟，字幕、媒体与独立对象仍使用各自局部时钟。bulletRevealSeconds 在原镜头范围内验证。原始时钟未提供时保持旧合成行为。Studio 普通 update 从同一镜头保留宿主已有 presentationWindow，不接受用户／Agent 原始请求创建或重设宿主来源；超过原时钟的延长明确拒绝，签名历史恢复继续沿用原版本／归属校验。

voiceSegments 可以明确为空数组，含义是此段不播放旁白；缺少该字段仍沿用旧完整旁白行为。空数组保留原音频与脚本绑定，声音／自动字幕投影为空，独立人工字幕保留，主轨不会选择不存在的第一个旁白段。旁白时长计算对空集合保持有限值。原生导出回执报告实测原音频总长（至多 180 秒），宿主验证实际播放窗口是否在源文件与镜头范围内；不能再用原音频总长代替播放长度。无旁白镜头仅接受零音频时长，缺失／伪造／越界回执拒绝。

这些共享媒体基础现已用于下面的有限整镜头分割；句锚点／句聚焦／板书与已核对原声字幕的整镜头分配现已接入下节的可信原始播放投影。

### 有限整镜头分割

既有 video.studio 新增封闭 split-scene 操作，只接收 operation、draftId、expectedRevision、sceneId、splitSeconds；切点是镜头局部 1–59 秒，两侧各至少 1 秒，最多二十四镜头。不能附带原始草稿／历史证明／外部路径。宿主按同一 owner、CAS、FIFO 和取消准入一次写入，失败不改变原 JSON；成功 revision 加一并发出一次通知，保留现有视频／封面输出日志。

画面按交集直接分配到两侧，不创建临时第九片段；左／完整右片段保留身份，跨切点右片段获新身份。视频源起点按原速度前移，原 focus、zoom 和 effectWindow 的来源时钟保持。完整旁白脚本／原音频／实测总长／生成绑定不改写，有限 voiceSegments 分配原播放区间；没有旁白的子段明确为静音。独立字幕在切点裁剪时间，原文、人工译文与来源保持完整，不猜测字词对应位置。局部图层／音轨分配同一源时间、锁定状态、淡入淡出来源和严格裁剪的关键帧曲线；全片图层／音轨逐字段不变。所有原镜头在首次分割时固定 presentationWindow，后续标题／编号／进度／音乐不重启。原声视频的相邻同来源 effectWindow 区间跨镜头共同解码；同名文件或有间隙、速度／音量变化不能合并。

时间轴沿用同一个分割入口，选择整镜头时标为「分割整镜头」，选择具体画面／旁白／字幕／独立对象时对应原有操作。保存、右续段选择、原播放头恢复和真实预览准备持有同一编辑事务；成功后才进入 Undo 历史，CAS 失败不造历史／脏草稿。签名 Undo/Redo 保留原始时钟和身份；撤销删除所选续段时清除过期 GUI 选择。卡片续段说明保留完整脚本并复用原旁白区间。宿主重新生成／导入不同旁白时可重建该镜头的原始时钟，普通 update 不能伪造重设。

句锚点／句聚焦／要点与已核对原声字幕现可按下面的可信来源时钟进行整镜头分割，原证据与来源保持；不能把分割视为新的听审或源字幕确认。已有局部／全片越界对象、切点产生不足 0.1 秒的画面／旁白／图层、已测量视频末帧停留区域、总对象超六十四或关键帧超十二都原子拒绝，不裁掉未处理内容。任意复杂编辑后的绑定恢复仍需明确处理；已有基础效果、参考抽样、逐项审阅和制作恢复分别遵守下文契约，不自动扩展权限。

### 整镜头的可信语音与原声字幕分配

Studio 私有 speechPlaybackOrigin 仅由宿主分割／明确句校正派生，包含原镜头 presentationWindow 范围内零至八个完整 voiceSegments 和至多 2000 字符的当前播放 clock；clock 包含源音频身份、实测时长和有限播放窗口，连续且同速度的源／播放片段合并，时间按微秒规范化，片段 ID 与对象键顺序不改变时钟。原句锚点、脚本／音频 SHA、校正来源、时间域和 capturedRevision 原样保留。普通 update 从同一音频保留宿主原时钟，不能提交新的／改写原时钟；合法省略原音频字段在验证来源前恢复原绑定，明确移除或绑定不同音频解除该时钟。该私有字段在共享媒体合成前剥离，不扩展模型执行边界。

分割保留整句原文。自动锚点字幕按子段的实际旁白区间裁剪显示且保持动态投影；静音子段为空。句聚焦以原始完整句区间投影到每个画面来源时钟，不在切点压缩／重启曲线；画面引用只分配到原画面实际出现的子段并重映射下标，素材身份、裁切与独立焦点冲突检查继续执行。无素材标题卡的板书揭示直接保留原时钟值，即使子段静音或揭示已发生，不相减再相加制造浮点边界变化。播放窗口发生实际变化时，消耗原引用拒绝；通过现有 correct-speech 明确校正可按当前有限播放重建来源投影，未改播放时钟的校正不重启原曲线。没有自动听审／词级时间／新的 ASR 认可。

原声字幕由宿主将已核对 sourceCues／sourceRange 和原文件 SHA 分配到仍包含原稳定画面组的子段，保留隐藏已核对 cue、全文、人工译文和校正来源，不扩展核对区间。丢失原画面组的子段解除该原声元数据，只保留独立字幕；识别候选随原素材实际成员重映射，不采用同名无来源片段。组外独立字幕按切点裁剪；跨越组边界的含糊独立字幕、过期身份／时钟、超核对范围、交叠／超预算仍原子拒绝。整镜头服务在分配前重查实际语音／原声文件 SHA，异步读取期间取消或并发更新不写入；保存前继续同一 owner／CAS／FIFO。签名 Undo／Redo 与卡片／高级模式使用同一规范草稿，保留这些可信记录。

这一实现仅覆盖当前可信来源契约内的整镜头绑定分配。任意复杂重绑定、效果扩展与完整用户体验验收不由本实现保证；参考抽样与有限逐项审阅见下文，AI 生成暂缓。

## 制作取消、清理与明确续做

统一「生成视频／制作更新／导出视频」仍沿用一次确认与既有原生旁白、编码。取消按钮在命令执行时可用；请求取消后变为不可重复点击的「正在停止…」，作业状态明确「正在停止并清理…」，实际命令／资源尚未排空时仍不开放编辑或下一命令。取消回执的迟到文字只作用于同一命令代次，不能覆盖已经结束或后来新命令的状态。停止不抹除已逐镜提交的旁白，也不抹除历史成片。

制作停止／失败后从所属草稿重新读取已提交状态，说明尚待制作的旁白段数和「再次确认制作」的恢复方式；不自动重发、不自动续做。用户再次确认后跳过仍有效的旁白，再完成检查和完整 MP4。取消显示「制作已停止」，失败显示「制作未完成」；用户提示去除 Electron IPC 外壳，保留实际失败原因。并发改稿按现有 revision 拒绝旧结果，人工字幕与译文保持独立。

隔离 Studio 原生专项 `BMW_STUDIO_PRODUCTION_RECOVERY_CASE=1` 已验证第三段 provider 失败、第二段处理中取消／并发改稿、实际编码完成而尚未入库时取消／并发改稿五种路径。取消期间另一 IPC 命令拒绝，清理完成前制作按钮保持禁用；初始有效旁白及第一段新旁白保留，原 MP4 字节／日志不变。后两项实际新编码及验证文件在未提交时回滚。明确重试只生成剩余／重新变过脚本的旁白，获得新增的可解码 H264／AAC MP4，不覆盖旧结果。声音来源是已测量合成 WAV 夹具，控制门限用于确定原生提交边界；不证明真实 TTS 网络／付费效果、编码进行中所有取消点、生产 Profile 或完整前台鼠标验收。

## 可选逐项审阅（测试功能）

“检查与导出”里的审阅区默认折叠。让 Assistant 提出建议沿用当前所属对话与官方运行时，不增加模型循环或工具；本地文字检查和关键帧仍可独立使用。新建议通过唯一 browser 的 video.studio propose-review 提交，需当前 draftId/expectedRevision 和闭合 reviewProposal：sceneId、field（title/narration/visualBrief/captionStyle/captionDisplay）、精确 before、after、reason、镜头内 seconds。宿主核对镜头、原值、时间、归属与 CAS，生成 ID、作者来源、原 revision 与日期；建议只是作者提供的依据，不代表事实核查。每草稿最多四十条记录，字段/文本/时间有界；未知字段与通用补丁拒绝。

reviewItems 是宿主所有的持久审阅日志，不计入视频内容比较。普通 update、签名 restore 保留当前日志，不能伪造、覆盖或清除建议；日志更新保留已准备预览和当前版本关键帧。read/list 返回记录，所属视图自动刷新建议；用户可以展开修改前后内容，定位到对应镜头和全片时间。Agent 的专用审阅操作只能提出建议；adopt-review/dismiss-review/undo-review 需要 GUI user 身份、当前 revision 与 reviewId。采纳只改一个字段，撤销只恢复该字段；原值/新值与当前字段不同、镜头删除、旧版本、已处理状态均拒绝，保留当前内容。忽略可处理陈旧的待处理建议，视频不变。采纳与状态在同一原子草稿写入提交，期间其他修改、人工双语字幕、原音频和当前导出日志保留。旁白脚本变更使旧音频待更新，不自动生成旁白或 MP4；撤销恢复原脚本后按现有实测绑定判断有效性。

文本建议的 before/after 使用字符串；captionStyle 使用完整六字段样式或 null，captionDisplay 使用 original/translation/bilingual 或 null，null 表示未设置。采纳与撤销核对原字段和定位时间，保留字幕内容、时间、来源及原旁白。只显示译文要求已有译文。未设置字段撤销恢复未设置。此项不接受任意补丁或 CSS，不保证 Agent 建议质量；实际画面依据仍需人工核对。

## 参考素材分析与制作背景

参考分析进入原有图片/视频素材预览的上下文入口，不增加常驻阶段按钮或第二个聊天输入。先“生成参考帧”，再“让 Assistant 分析参考 ↗”；结果在原素材列表显示就绪标记，重新打开可看实际 PNG、源时间、分析与将加入的文字。点帧可在原素材预览定位实际源时间。内容分析需要当前官方 Agent 运行时，宿主只准备图片证据和路由原会话，不自行执行模型循环。

唯一 browser 的 video.studio 增加封闭 prepare-reference/read-reference/set-reference-analysis/apply-reference-notes。draftId/expectedRevision、Project/Session、当前素材种类/身份均校验；prepare-reference 可为视频指定一至八个不同有限源秒数，默认在实际视频轨范围抽三点；图片仅静态一帧。media.inspect 的视频轨 now 返回 startSeconds/endSeconds，按真实轨道起止采样，不把音频尾部导致的总媒体时长当成视频终点；其他检查和音轨字段保留。图片先实际检查解码后产生 640×360 原生适配 PNG，视频通过已有原生取帧产生不超过 640×360 的 PNG。记录保存源 ID/SHA/字节数/尺寸、总媒体时长/实际视频区间、请求与实际帧时间、帧 ID/SHA/尺寸、原版本/日期。源预算 256 MiB、单源 16 Mp，静态图片同时服从原图片 32 MiB 预算；视频不超过 1800 秒，最多八份记录，每份一至八帧。

referenceRecords 是宿主所有日志，排除于视频内容比较；普通 update 与签名 restore 保留最新记录，不能伪造或清空。读取/保存分析/明确加入背景前核对当前源和所有帧 SHA，读取帧后再次核对源。Bridge 把这些返回作为真实模型 PNG 图像，沿用实际 Project 路径、PNG、数量/总字节预算与取消检查，并对将返回的实际字节再次核对记录 SHA。frames 路径是宿主结果，不向模型开放任意本地文件读写。

分析是作者提供的 summary 与实际采样 frameIndex 的 description/adaptation，文本、数量及字段封闭；不能伪装未采样画面或整段视频/音轨已审阅。analysisOrigin 区分 user/agent，Agent 不覆盖用户校正。用户“加入制作背景”要求当前 beforeNotes 与 CAS，仅追加可预览的参考块；不自动改脚本、重配音或导出。原保存/签名撤销重做保留参考日志、期间的媒体、手工字幕和导出记录。

原生输出仅在来源再次核对和当前归属/CAS 成功后提交。取消/冲突/验证失败只删除本次新建、身份相符的帧，不删旧资源；等待真实清理完成才重新准入。取消反馈说明已保存成果保留；源/帧变化显示重新生成参考帧的说明。原会话委托失败，即使弹窗已经关闭，也向仍属原视频的状态区报告恢复方式，不自动重发。宿主诊断仍保留原错误，不把 Electron 包装或错误码直接展示为恢复文案。

当前为有限抽样参考分析；尚无自动全视频分段/节奏/音轨分析、语义真值保证或实际 AI 图片/视频生成工作流。达到八份记录上限时禁止新取帧，用户现可通过下面的折叠记录管理释放额度；旧参考图片与原媒体仍保留。完整视频语义分析、复杂引用恢复与完整用户体验仍未获该抽样验证证明；后续 UI 优化已暂停。

## 卡片内画面与脚本配对

默认卡片编辑把所选镜头的原 canonical script-current 编辑器与画面缩略图、画面意图放在同一张卡片；其他镜头显示完整脚本文字。卡片按自身可用宽度排列：350px 以上左右配对，较窄时上下排列，避免全窗断点和侧栏变化造成截断。长画面意图超过 120 字时用按需展开保留全文；没有省略保存内容。当前镜头提供“编辑卡片”“换画面”“声音与字幕”三项常驻编辑入口，镜头菜单、素材/声音详情和高级编辑共用原草稿、编辑器与 revision/history，不新增脚本副本或聊天框。

实际编译组件、生产 HTML/CSS 与原生参考 PNG 已在 headless Chromium 通过 24 镜头长中文、1200/900/700/620/420 五种窗口宽度、完整文字、无横向溢出和 canonical DOM 身份检查。解锁后完整新增原生 case 已通过五种宽度、固定预览、详情返回、保存冲突保留输入、高级/卡片往返、1.25 秒播放头、手工字幕/独立对象/音频与签名撤销重做（早期测试记录）；当前独立对象返卡片由共享 schema 拒绝，原生回归检查原因提示和撤销恢复；旧 MP4 指纹和独立旧草稿保持。组件检查与实际 DOM/IPC/Canvas 原生检查分别记录；它们不能替代前台鼠标与用户验收。

## 参考记录的额度恢复

现有参考素材弹窗增加默认折叠的“管理参考记录 · n/8”，显示当前草稿全部记录的素材、日期、帧数与分析状态；同一素材的记录可切换查看，仍经原 SHA 核对后才能使用。用户可明确移除单份记录并释放一个取帧名额；移除仅变更宿主 referenceRecords 日志，保留全部 Project 源文件/参考 PNG、已加入制作背景的文字、脚本/字幕/图层和导出。操作中禁用管理按钮；移除当前记录后清空其画廊与分析，不能继续用已移除记录委托 Assistant，其他记录可明确重新读取。没有新增常驻工作台按钮或聊天入口。

remove-reference 是封闭请求，必须包含 draftId/expectedRevision/referenceId，只允许可信 GUI user actor，Agent 调用拒绝。沿用 owner/CAS/取消/FIFO；只操作元数据，不读取已过期或丢失的源/帧，因此这些记录仍可恢复额度。未知 ID、错误归属、版本冲突或取消不写入、不发送变更通知。读取失败后当前记录提供明确“重新读取”，仍核对最新源/帧，不自动恢复就绪或重发任务。普通 update/签名内容 Undo 不恢复已移除的宿主日志；界面明确说明内容撤销不恢复参考记录，可重新取帧，原图片仍可作为 Project 素材使用。

真实宿主单元契约覆盖八份记录满额、用户专属移除、错误归属/CAS/取消、失效源/帧仍可移除、媒体与背景/脚本/导出保全、内容历史不复活旧记录及重新取帧预算。实际组件与服务回调的交互证据另见 VERIFICATION；不等同于 Electron 原生/前台、付费模型或生成服务验收。完整视频语义分析尚未实现，分析质量需人工核对，专用 AI 图片／视频生成暂缓。

## 两种编辑视图共用精简操作栏

卡片与高级模式共用原有顶栏控件：视频名称、保存状态、撤销/重做、目标与素材、视图切换与单一交付入口。作品切换、新建/删除、视频设置、重载、手动保存和返回浏览器移入同一“更多”菜单，不复制字段或事件；点击菜单外或 Escape 收起。尚未创建／选中草稿时目标与素材禁用；零分镜草稿仍可准备素材。错误后的明确重载仍可从菜单进入。

含局部/全片图层或独立音轨、多个画面片段或焦点区间的卡片显示一条“含高级编辑”上下文入口，选择同一镜头后沿已有保存/CAS/模式切换进入高级编辑；不扁平化、不新建草稿。卡片按 Project/Session/草稿在当前页面记忆滚动位置，最多保留十六份；长画面意图的展开状态在同一草稿渲染和模式往返中保留。卡片容器关闭浏览器自动滚动锚定，仅在卡片视图记录位置，避免高级布局重排污染原位置。上述 UI 不增加模型工具、网络调用或媒体模型。

## 空草稿到卡片初稿与竖屏交付

简单模式在空草稿的素材/背景区显示原有“让 Assistant 生成卡片初稿”委托入口，沿原所属 Session 与 script intent，不增加聊天框或模型循环；背景可空。大纲保持原字段，在默认折叠区按需阅读与修改。已有分镜时同一委托变为完善脚本，保留原提示词的用户内容保护。

同一草稿从零分镜收到后台初稿，且页面没有待保存输入时，简单视图进入镜头卡片与草稿预览，并关闭原准备资料详情。待保存输入存在时继续保留文字和当前页面，明确重新加载后才接收外部版本并打开卡片。Project/Session/版本准入、结果通知和 unknown 不重发沿原规则；视图切换不写草稿内容。

卡片预览按当前区域高度适配横/竖画幅，播放和定位控件始终留在预览区，不随卡片滚动，也不要求滚动竖屏画面后才能播放。交付计划只显示待更新旁白数量和制作影响，完整镜头名单保留在默认折叠区；有效旧成片复用时不显示待更新名单。可选测试审阅默认折叠，不成为导出门槛。

预览准备期间，时间轴分割与播放/定位控件一同禁用；真实准备完成后按当前编辑状态恢复，避免使用未完成预览的播放头进行分割。

<!-- BEGIN GENERATED CAPABILITY AND TEST INVENTORY -->

> 本区块由 `npm run docs:features` 生成。请修改上方人工维护的功能条目，再刷新本区块；不要手工编辑本区块。

### 当前 Browser Action 清单

- BMW 核心 Browser Actions（37）：`status`、`tabs.list`、`tabs.open`、`tabs.show`、`tabs.close`、`navigate`、`back`、`forward`、`reload`、`observe`、`click`、`type`、`wait`、`key`、`hover`、`page.diagnostics`、`page.media.list`、`page.viewport.set`、`media.screenshot`、`media.download`、`media.video.capture`、`media.inspect`、`media.frames.sample`、`media.convert`、`media.image.inspect`、`media.image.annotate`、`media.image.draw`、`media.record.start`、`media.record.stop`、`project.context`、`project.memory.append`、`project.tasks.append`、`schedule.list`、`schedule.create`、`schedule.update`、`schedule.remove`、`schedule.run`
- feature-video Feature Browser Actions（4）：`video.compose`、`video.narrate`、`video.studio`、`video.settings`

- video.studio 操作（48）：`describe-template`、`describe-schema`、`read-document`、`compatibility`、`validate-edit`、`apply-edit`、`migrate-document`、`remove-reference`、`prepare-reference`、`read-reference`、`set-reference-analysis`、`apply-reference-notes`、`propose-review`、`adopt-review`、`dismiss-review`、`undo-review`、`split-scene`、`restore`、`recognize-source`、`read-source-speech`、`apply-source-captions`、`detach-source-captions`、`set-caption-translations`、`align-speech`、`read-speech`、`correct-speech`、`source`、`export-citations`、`list`、`create`、`read`、`delete`、`update`、`narrate`、`narrate-pending`、`check`、`export-captions`、`export-cover`、`read-material`、`suggest-focus`、`render`、`assets`、`inspect`、`attach`、`open`、`context`、`configure`、`save-template`。字段、用户专属操作与归属检查见上方契约。

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

#### `packages/agent-ui/test/studio-composer-scope.test.ts`

- `Composer pins a visual piece at first input, preserves owner drafts and clears piece identity for broader scopes`

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
- `Session-owned direct composition registers an editable draft and existing export without changing other drafts`
- `Direct composition never registers cancelled, failed or foreign work; unsupported timing stays explicitly standalone`

#### `packages/feature-video/test/video-document.test.ts`

- `detailed source reading and background phases require 2.2 and survive CAS splits and signed restore without restarting`
- `persisted card splits retain original metric and reveal clocks across reorder and codec restoration`
- `global layout and pacing persist in 2.1 and survive ordinary updates without rewriting old drafts`
- `automatic narration receipts keep the new document version independently of optional presentation settings`
- `model catalog shares eight categories and lazily returns only the selected closed template`
- `explicit template conversion preserves text and source files, rejects count loss and reports visual detachment`
- `card documents persist their only content authority in 2.1 while old 2.0 stays unchanged`
- `Canonical v2 preserves preparation, script, subtitles, source clocks, output settings and journals exactly`
- `Shared codec accounts for segmented fallback, empty voice, independent effects and original fade/keyframe clocks`
- `Integer placement with bounded residual preserves legacy JS clocks without rounding trusted source time`
- `Timeline owns chronology; invalid versions, unknown fields, duplicate IDs, gaps and unmapped objects fail closed`
- `Simple profile is a reversible subset; hidden/muted advanced objects block until removed, with no persisted mode lock`
- `Simple typed edits remain closed and roundtrip across both editors`
- `Canonical persistence and v1 migration preserve originals, owner, exports and revision; invalid reads do not rewrite`
- `Agent operations enforce trusted scope, current revision, atomic dry runs and actual advanced authorization`
- `Typed independent edits convert global time to owning scene and preserve original fade clocks on trim/split`

#### `packages/feature-video/test/video-settings.test.ts`

- `video template settings persist without changing other settings and are reusable by name`
- `Studio snapshots defaults and templates while visual-only configure retains custom size and CAS`
- `TTS resolves Edge male defaults named snapshots and explicit overrides while preserving opt-out`
- `Studio narration uses configurable TTS rather than fixed local speech and enforces the Edge gate`

#### `packages/feature-video/test/video-studio.test.ts`

- `card image inspection exposes actual pinned identity; changed source before or after encode blocks and rolls back only new exports`
- `compact playback uses measured source time and preserves manual captions, cuts and explicit silence`
- `host generation and audio import apply compact pacing, protect auto receipts and retain manual playback on replacement`
- `Studio drafts persist per Project and reject conflicting GUI or Agent revisions`
- `Only owned journal revisions retain prepared content; captions, clocks, preparation and output edits require reconciliation`
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
- `Studio simple-first view policy stays separate from video data and freezes confirmation context`
- `Studio chat and renderer geometry reject foreign fields and invalid native layout bounds`
- `Studio pinned prompt scopes validate whole-film, scene and object data before admission`
- `Independent Assistant targets bind exact local/global containers and reject deleted or mixed identities`
- `Studio preserves advanced layer containers during omitted model updates and keeps out-of-range edits recoverable`
- `Studio rejects layer references outside its Project before saving and checks actual overlay source durations`
- `Independent GUI edits preserve local/global identity, source clocks and lock admission`
- `Animated timeline cuts retain linear and restricted easing samples`
- `Canvas transforms preserve animation shape, identity and timing while bounding every frame`
- `Main voice timing preserves measured source and maps preview, captions and manual audio anchors`
- `Main sequence reorder and ripple edits keep local ownership and absolute global tracks`
- `Main subtitle move, trim and split materialize one canonical ordered bilingual cue list`
- `Invalid voice source windows remain readiness issues without invented timeline captions`
- `Studio live chat requests pin an immutable owner and validate actual panel/selection bounds`
- `Repeated easing trims, splits and inserted keyframes preserve the full source curve and persisted ranges`
- `Narration splitting preserves source identity, continuous sentence captions and focus before independent piece edits`
- `Narration piece schemas and clocks reject ambiguity, coercion, source overflow and excess pieces`
- `Stored narration pieces survive omitted model fields, preserve independent captions and enforce captured revision`
- `Exact narration piece Assistant targets reject deleted, foreign-container and mixed scopes`
- `Main visual cuts preserve image/video framing, zoom and fade envelopes at arbitrary and repeated cut points`
- `Visual splits preserve sentence focus links and trusted source subtitles, including later segment reindex and undo`
- `An explicit local transition keeps the original motion clock, and later cuts preserve both clocks`
- `Exact visual piece scope survives reordering and rejects deleted, foreign and mixed targets`
- `Independent cuts preserve full fade and keyframe samples in scene and film clocks`
- `Reviewed source subtitles rebind trim, speed, offset, reorder and undo with original cues and manual translations`
- `Legacy source subtitle bindings admit only reviewed visible range and reject forged roots or unreviewed extension`
- `Source subtitle identity never adopts a deleted stable clip and host translation edits survive later reprojection`
- `Host-approved history restores deleted scene speech/source records and preserves the current export journal`
- `Snapshot approval cannot authorize modified content, foreign owners, another host, cancellation or stale revisions`
- `Unsegmented source bindings never adopt scene IDs and anonymous replacement needs approved history`
- `Explicit silent narration pieces retain source binding and manual captions without implicit replay`
- `Raw Studio updates cannot mint or reset a host presentation origin`
- `Whole-scene split partitions eight visuals directly, freezes original chapters and preserves complete bilingual text`
- `Whole-scene split preserves silent prefixes, exact voice source intervals and original audio receipts through repeated cuts`
- `Whole-scene local layer split retains locked easing, fades and audio source clocks while global tracks stay exact`
- `Whole-scene admission rejects spoofed payloads, unmeasured/bound speech and tiny fragments without changing saved bytes`
- `Whole-scene host operation shares owner/CAS/cancellation and sends one notification only after the atomic write`
- `Whole-scene rejects tiny visual cuts, invalid local objects, held-source cuts and global object overflow atomically`
- `Bound whole-scene split retains original sentence/focus clocks, silent pieces and exact reviewed anchors across repeated cuts`
- `Bound title-card cuts retain original bullet reveal times even in silent prefix and following suffix`
- `Bound source captions partition trusted roots, hidden reviewed cues, edited translation and independent out-of-group cues`
- `Whole-scene source binding rejects ambiguous crossing captions or stale identities before writing`
- `Bound split consumption rechecks actual source/voice hashes and preserves cancellation and CAS after asynchronous reads`
- `Explicit host sentence correction rebases changed playback origin; raw edits cannot mint/reset it and new audio clears it`
- `Experimental review persists bounded proposals as host-owned journals without editing film or accepting raw journal forgery`
- `Review adoption and selective undo retain unrelated edits, generated voice, bilingual captions and export journals`
- `Review blocks stale field/scene/CAS, unauthorized Agent adoption and cancellation atomically with no notifications`
- `Review undo refuses later field edits and deletion; forty-record budget and closed request validation fail without partial writes`
- `Review Assistant uses the same owned full-film request and only proposes concrete individual suggestions`
- `Reference preparation saves source and frame fingerprints as immutable journals without editing canonical scenes or letting update/restore forge records`
- `Native reference receipt mismatch and changed source roll back only newly claimed frames and retain old files/draft`
- `Reference analysis targets actual sampled frames, protects user corrections and requires explicit exact notes adoption while keeping scripts and captions`
- `Reference cancellation and concurrent GUI CAS after native completion wait for rollback without orphan frames or overwriting user changes`
- `Reference Bridge admits real bound PNG bytes and rejects post-service tampering, while closed requests, foreign owners and budgets stay bounded`
- `Reference Assistant pins its prepared identity in the original request and refuses pretending sampled frames are full-video review`
- `User reference management releases the eight-record budget without reading changed media or deleting PNGs, preserves notes/content/history and prevents Agent removal`
- `Reference removal accepts only an owned record identity and revision, never paths, bulk lists or analysis payloads`
- `Scene narration mute retains gain, measured audio, timing and captions through omission, explicit unmute and CAS`
- `Main footage mute resolves stable segment identity without changing source clock, gain or captions`
- `Visual effect edits preserve source/narration clocks, captions and stable targets through trim, split and clearing`
- `Whole-scene splitting moves main footage effects onto derived visual segments without applying them to captions`
- `Material preparation allows zero-scene film scope and preserves real-artifact and stage boundaries`
- `Subtitle review validates finite structured values and readable labels without accepting styles or field coercion`
- `Subtitle review adoption and selective undo retain exact voice, captions, source clock and unrelated edits; unset fields restore unset`

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
- `Inspected video track range is finite and lies inside measured media, allowing an AAC tail without extending video`

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

- `detailed cards pin actual source bytes, reject changed sources, bound geometry and keep dedicated assets in decode budget`
- `reading recipes keep whole/detail dwell and bounded scale; range semantics reject invented proportion and invalid ordering`
- `news layout rejects unsupported shapes and misleading coercion and checks its real text budget`
- `eight card categories admit their actual assets and reject unsupported content without dropping it`
- `closed card presets retain exact numeric representation and seek on original scene clocks`
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
- `independent layers validate identities, Project references, ranges and video decoder overlap`
- `explicit layer keyframes interpolate geometry and fading without changing base values`
- `streamed source audio supports bounded fade gain without samples outside the selected interval`
- `Restricted easing admits only closed increasing domains and stays stable near curve endpoints`
- `Visual effect clocks are finite closed bounded data with unique piece identities`
- `Closed independent fade windows admit short preserved pieces and reject invalid original clocks`
- `Original presentation windows validate root bounds and preserve counters after repeated cuts`
- `Native narration receipts distinguish source duration from short and silent playback pieces`
- `Visual effects are closed finite numbers shared by scene footage, segments and independent objects`

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
- `queued Studio requests freeze their explicit context and expose it only to the active owner`

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
- `Studio chat docks in the measured property area and free movement remains above the timeline`
- `Studio initial float avoids selected pixels and reserves resources; manual position stays authoritative`
- `Studio free float reserves actual transport while docking still uses the complete property area`
- `Studio automatic float fits a wide selected object and pins its chosen height across later selection and manual movement`

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
- `Studio effects, mute and object-state implementation changes retain their native GUI/export guarantors`
- `Every Studio smoke environment branch is admitted by a classified runtime entry`

<!-- END GENERATED CAPABILITY AND TEST INVENTORY -->


## 简洁卡片的标题与要点编辑

简洁模式的草稿预览中，点击实际绘制的标题或要点选中并显示“编辑文字”，双击或 Enter 在画面内输入。卡片的“编辑卡片”展开同一镜头的标题和已有要点，两处同步；点空白处、失焦或 Ctrl/Cmd+Enter 保存，Esc 取消未提交输入。文字支持换行，标题按固定模板最多两行绘制；标题最多 44 字，要点最多 64 字，并沿用现有文字布局校验。要点行提供“删除”，末尾提供“＋ 添加要点”；新增使用空白本地输入框，填写后点“添加”、点空白处或 Ctrl/Cmd+Enter 保存，取消或 Esc 不写草稿，空白新增不保存。每镜头最多 3 条要点，达到上限时禁用添加并解释；固定数量版式要求先通过“更换”改用要点列表，数量不匹配时阻止增删。删除同步移除该条的揭示时间/语音板书引用，后续引用索引顺移；其余绑定、旁白、字幕与素材保留。增删复用所属版本 CAS、单次撤销/重做，外部冲突不覆盖。位置沿用固定版式。面板显示当前版式与“更换”：要点列表、三点总结、两项对比、画面解读共用原生预览与导出渲染。选择器用当前镜头的真实内容生成独立临时预览，适用性由现有文字/素材校验决定，不适用的选项禁用并解释原因。预览与取消不写草稿；确认仅更换当前镜头 sceneTemplate，保留文字、素材、旁白和字幕，使用所属 Project/Session/draft/revision 的 CAS 保存及单次 history 撤销。关闭、切换或失效时取消预览并等待原生资源释放；不自动删要点或生成内容。新增模板种类留待真实场景验证。

命中区域由预览与导出共用的绘制器报告，以实际画幅和 object-fit 留白计算，缩放后重新定位。覆盖层不写入视频像素，不允许编辑标签、字幕或品牌水印。标题与已有要点使用原 scene.title/bullets，不复制草稿、不改旁白、字幕、素材和时钟。每次修改经过 Project/Session/草稿/revision 校验和原 update/CAS 保存，复用签名撤销/重做；外部版本冲突保留输入，明确重载后才丢弃。高级不兼容、保存中或跨所属上下文时禁止编辑。
