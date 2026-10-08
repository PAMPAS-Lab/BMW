# BMW 当前实现


Video Studio 增强的现行范围包括：预览位置与分镜同步、待测量/实测覆盖、文字排版与关键帧审片、视频原声 ASR/校正/双语字幕，以及 summary/comparison/screenshot 固定模板。完整音轨 ASR 仍限制 180 秒；没有长视频分块或自动词级时标。具体契约见 FUNCTIONAL_SPEC，专项验收与后续缺口见 VIDEO_STUDIO_NEXT；人工转写精度和付费翻译质量不由离线夹具证明。

Browser is boundary, media is native, web is runtime.

Video Studio 本轮 A/B 已实现默认简单制作、主动高级编辑、右侧唯一请求输入、所属会话任务反馈，以及材料／脚本／草稿预览／实际成片／检查导出路径。分阶段确认是可选的冻结任务说明，仍需模型效果验收；有限多轨、特效和 AI 素材生成保留为后续阶段。历史撤回测试草稿与方法快照清理保持不变。详见 [VIDEO_STUDIO_NEXT.md](VIDEO_STUDIO_NEXT.md)。

本页按 2026-10-05 的活动 BMW 代码核对。当前功能、Schema、权限与生成测试清单以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准；模块和接口以 [ARCHITECTURE.md](ARCHITECTURE.md) 的生成区为准。

| 范围 | 当前状态 | 实际边界 |
|---|---|---|
| 桌面工作区 | 已实现 | 一个 BMW；浏览器和 Video Studio 共用 Project 与自有 Assistant |
| Agent 驱动 | 三驱动已启用 | DSH、Codex App Server、Qoder CN SDK 各自拥有官方 Agent 循环；核心只依赖通用契约 |
| 登录与模型选择 | 已实现 | GUI 切换驱动自动读取认证；缺少凭据时弹出登录方式，可改选驱动；登录后点选支持模型并确认 |
| Project 与会话 | 已实现 | 稳定 BMW Session 固定 Project/driver；原生恢复身份不可替换，旧 ID 经显式迁移保留；核心 Project 无原生映射，页面与媒体由 Project 共享 |
| 浏览器与图像 | 已实现 | 唯一 browser 工具；页面交互、后台取材、图像检查/标注/绘图、FIFO、权限、租约与实际清理 |
| 素材与媒体 | 已实现 | 截图、有限下载、视频采集、页面录制事件、检查、抽帧、裁剪缩放与转换 |
| 来源与引用 | 已实现 | 限定正文采集、原文/哈希、候选确认、有限播放器采集、准确 UTF-16 引用和当前媒体可用性；冲突仍待用户核查 |
| Video Studio | 已实现 | 草稿 owner/revision、脚本、真实旁白、匹配、预览、焦点、板书、独立封面与 MP4/SRT/VTT/来源清单 |
| 中文语音锚点 | 可编辑句/段已交付 | 固定 base/small 原始证据与校正；十段 base 标注已由用户核听采用，保留 12 个锚点的来源；自动精度门未通过 |
| 参数与模板 | 已实现 | 比例、分辨率、帧率、风格、水印、配乐与 TTS 模板；默认 Edge 云希、0% 语速，支持本地 Matcha |
| 计划任务 | 已实现 | 固定 Project/Session/driver，失效绑定报错；跨驱动运行恢复用户选择，排队/运行时禁止重绑 |
| 外部控制 | 未实现 | 无独立远控/移动服务或聊天软件连接器；SDK 会话不要求出现在原生桌面列表 |
| 安装交付 | 未实现 | 无签名安装器、自动更新；以源码与固定依赖启动 |

## 运行与认证

固定版本为 Node.js 24+、Electron `44.5.1`、Mediabunny `1.61.0`、DSH `0.2.0-rc.2`、Codex App Server `0.160.0` / `0.160.1`、Qoder CN SDK `1.0.50` / Worker `1.1.64`。依赖安装版由 lockfile 固定，外部 CLI 还需通过运行时版本准入。

默认入口由 `scripts/product-entry.ts` 调用 `apps/bmw/agent-assembly.ts`。新 Profile 默认 DSH，之后按 Project 保存 driver 选择。启动沿用已有选择，不自动发起登录；GUI 切换时检查认证。

Profile 为 `BMW`，浏览器分区为 `persist:bmw`。三个引擎分别使用 `dsh-home`、`agent-drivers/codex`、`agent-drivers/qoder-cn`；BMW 保存会话索引、显示历史、回执与模型偏好。DSH 初次初始化可复制普通 CLI 凭据，后续凭据写入只落在 BMW 的独立文件；Codex/Qoder 不读取原生桌面的私有凭据。

DSH 提供 DeepSeek API Key，Codex 提供 ChatGPT 浏览器登录，Qoder CN 调用官方 CLI 登录。Codex 可识别独立 CLI 中的既有 API Key，BMW 当前没有 API Key 输入表单。Qoder 没有已验证的非交互退出控制，退出按钮禁用。DSH 检查的是 Key 是否配置，不验证 Key 有效性或余额。

支持名单与官方目录匹配后才可选择：Codex 为四个已封装 GPT-6 型号与 GPT-5.5；DSH 为两个官方 DeepSeek 路由；Qoder CN 为维护的 14 个启用型号，完整 ID 见功能规格。支持名单不等于账号推理额度，也不代表全部型号逐一完成付费验收。设置不发送模型输入；Qoder 冷控制会话仍内部核对 SDK 初始化目录，实际输入前所有引擎均要求有效工具目录恰好一个 browser。

## 当前验证证据

| 报告 | 执行范围 | 结论的适用范围 |
|---|---|---|
| `2026-10-05-agent-data` | 109 项离线检查及 5 个检查门通过 | 显式迁移、严格加载、Host/MCP、DSH 冷导出及桌面/重启/Studio/媒体；不包含真实 Profile 迁移或付费推理 |
| `2026-10-05-gpt6-browser` | 112 项离线检查及 5 个检查门通过 | GPT-6 封装时的完整源码快照；不是后续登录改动的全量复跑 |
| `2026-10-05-login-flow` | 32 项选定检查及 4 个检查门通过 | 登录/选择流程快照、相关契约、隔离 Assistant 与边界；合入审计证明候选和活动源码一致 |
| 三引擎与 GPT-6 真模型验收 | 隔离页面、随机截图读图、Studio owner、原生进程结束后的同一 Session 续聊 | 仅对应实际执行的型号；Qoder 为 auto，Codex 四个 GPT-6 与 GPT-5.5，DSH 为当时的官方 Flash |
| Studio base 采用 | 十段音频、12 个可编辑片段、实际 MP4/SRT/VTT/板书与成片复用 | 用户核听后的 ASR 辅助采用；独立声学 P95 未建立，自动词/字同步未批准 |

报告、原始日志、失败记录与人工验收边界见 [VERIFICATION.md](VERIFICATION.md)。文档更新不重新运行付费模型或把历史报告改成新结果；只有成功的完整离线运行更新完整通过基线。

## 当前限制与待修复项

Shell 顶部运行时徽章已接入自有 Assistant 状态，统一显示等待、运行与资源断连。Agent 数据采用 v2；旧 Profile 必须先退出应用并运行显式迁移。本机真实 Profile 已按明确授权完成迁移：10 个 Project、28 个原有 BMW 会话保留并导入 4 个原生 DSH 会话（共 32 个），9 个 Studio 草稿及全部 848 个 Project 文件保持原字节；模型偏好、历史、输入回执和恢复锚点保留。备份和审计见验证文档，重复预检为零改动。操作、备份与恢复步骤见 [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md)。

原生桌面会话同步、fork、steer、Agent 原生审批与 nativeOpen 未启用。未知投递不自动重发；损坏状态保留原文件并提供重试/退出，原生清理失败保留资源隔离。生产钥匙串与真实 Profile 体验由用户验收。

设备编码能力及 Edge 外部服务影响媒体成功率。真实 alpha 视频抽帧/转换、通用 NLE、任意 HTML 视频导入、自由图层/关键帧、自动句/词/字声学同步及可选数字人尚不属于当前交付；ASR 本机 macOS 分支有实测，Linux 分支尚未实测。

## 文档入口与历史材料

| 文档 | 用途 |
|---|---|
| [README.md](../README.md) | 安装、登录和主要工作流 |
| [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) | 当前行为、Schema、权限及生成能力/测试清单 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 12 个模块、10 项接口保障和 3 项具体实现保障；导出与依赖检查 |
| [VERIFICATION.md](VERIFICATION.md) | 分阶段报告、测试方法与证据限制 |
| [handoff.md](../handoff.md)、[agent.md](../agent.md)、[AGENTS.md](../AGENTS.md) | 当前开发交接与规范 |
| [AGENT_DRIVER_DESIGN.md](AGENT_DRIVER_DESIGN.md)、[AGENT_DRIVERS_IMPLEMENTATION.md](AGENT_DRIVERS_IMPLEMENTATION.md)、[QODER_BMW.md](QODER_BMW.md) | 三官方驱动的设计、实际验收和接入 |
| [VIDEO_STUDIO_P0_IMPLEMENTATION.md](VIDEO_STUDIO_P0_IMPLEMENTATION.md) | 当前 P0 摘要及保留的逐阶段实施证据 |
| [VIDEO_STUDIO_REVIEW.md](VIDEO_STUDIO_REVIEW.md) | 2026-10-04 原始需求评审，原文保留；其中旧待开发判断不是当前状态 |

迁移归档 `../Agent in Browser` 和独立 `../BMWDev` 不属于本次活动 BMW 文档的权威来源。
