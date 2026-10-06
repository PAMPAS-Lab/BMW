# BMW 驱动实施与验收

BMW 使用自有 Assistant、Project、页面、媒体和 Video Studio，DSH、Codex、Qoder CN 各自运行官方 Agent 循环。默认入口只使用统一 Host 与 Assistant，旧 DSH 客户端、DOM 选择和启动时历史兼容入口已移除。核心 Project 不存储原生映射；DSH harness 维护 Workspace，BMW 统一索引和显示历史采用 v2。显式迁移保留旧会话与 Studio 身份，操作见 [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md)。原生桌面对话列表同步未启用；用户在 BMW 内交互。

## 已实现的边界

- 模型输入前必须证明实际工具目录恰好包含一个 `browser`；提示词和调用拒绝回调不能替代目录检查。
- 独立 Profile、官方认证、稳定 BMW Session、不可替换的原生恢复锚点、持久输入回执和 Project/Session 资源归属。
- 输入、设置、切换和工具遵循 Host 排除与 FIFO。原生运行时实际清理后才释放；清理失败保持隔离，未知投递不自动重发。
- BMW 提供对话显示、工具进度、停止、续聊及模型设置。模型只能调用经过验证的 browser Action，无法获得 shell、宿主文件系统或凭据。

GUI 切换驱动后自动读取认证。未登录时显示登录对话框及驱动切换入口；登录期间切换会先取消并等待实际清理。登录后只显示适配器支持名单与官方目录的交集，用户点选“确认选择”即可；设置不产生付费推理或用户发起的专项预检，Qoder 冷控制会话仍内部检查 SDK 初始化目录；实际输入前仍执行唯一 `browser` 准入。名单见 [功能规格](FUNCTIONAL_SPEC.md)。

当前固定运行时：DSH `0.2.0-rc.2`、Codex App Server `0.160.0`、Qoder CN SDK `1.0.50` / Worker `1.1.64`。未知协议版本仍拒绝。Qoder 只继承明确的严格 MCP 配置；DSH 每次请求检查 scoped catalog。

## Codex GPT-6 工具封装

可选择 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`。四者已通过实际唯一工具预检及两轮真实模型验收；`gpt-5.5` 的原有路径也完成回归。账号模型列表成员不等于账号实际推理可用，每轮仍检查官方认证和模型成员关系。

`codex-model-catalog.ts` 从 BMW 独立 CLI Profile 的官方 `models_cache.json` 读取与固定 CLI 版本一致的模型目录，生成内容寻址的宿主私有策略副本。仅对上述四个 GPT-6 条目移除强制 `tool_mode`、`multi_agent_version`、`multi_agent_reasoning_effort`，并清空 `experimental_supported_tools`。保留原模型 ID、指导、上下文、图像、推理选项和原生 Lite 传输；其他条目原样保留，不伪造别名或模型可用性。

目录通过官方启动配置 `model_catalog_json` 加载。目录预检和实际执行使用同一份副本；配置普通开关继续禁止 shell、代码模式、协作、问答和其他内置工具。预检捕获官方运行时真正组装的 Responses / Lite `additional_tools`，如出现 `exec`、`tool_search` 或任何额外工具，用户输入仍被阻止。设置清理完成后才保存选择。模型调用通过官方 dynamic tool 回调进入原有认证 Bridge，BMW 不增加模型循环或模型代理。

副本不包含缓存的账号身份、etag 等根元数据，不改写官方 cache/config；官方运行时可正常刷新自己的缓存。错误版本、模型缺失、重复身份、符号链接、已发布文件内容变化和额外工具都失败拒绝。新增未知 GPT-6 型号不自动套用本策略。

依据：[官方启动模型目录配置](https://learn.chatgpt.com/docs/config-file/config-reference)、[官方模型目录与工具能力说明](https://learn.chatgpt.com/docs/enterprise/roll-out-a-gateway)。此处直接使用官方 Codex 服务，未引入网关或第三方模型代理。

## GPT-6 封装时的真实模型证据

用户此前明确授权使用模型额度。每个型号使用全新临时 BMW Profile/Project 与既有独立测试认证，第一轮打开一次性 loopback 页面，只从真实 PNG 读取随机码和颜色，创建当前 BMW Session 拥有的 Studio 草稿；第二轮在原生进程关闭后恢复同一 provider Session，准确回复续聊随机码且没有工具调用。

| 模型 | 结果 | 证据目录（均含 result.json 和 Assistant 截图） |
|---|---|---|
| GPT-6.1 Sol | 两轮通过，terminal exit=0 | `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-wid2e8` |
| GPT-6 Astra | 两轮通过，terminal exit=0 | `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-tqRBAB` |
| GPT-6 Sol | 两轮通过，terminal exit=0 | `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-LGjOBz` |
| GPT-6 Luna | 两轮通过，terminal exit=0 | `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-R0R5M1` |
| GPT-5.5 回归 | 两轮通过，terminal exit=0 | `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-fV3e2o` |

前三个 GPT-6 在隔离候选构建运行；Luna 和 GPT-5.5 在活动 BMW 的构建运行。受保护合入逐文件证明候选与活动仓库的运行时代码相同，证据记录源码目录、脚本 SHA256 和构建回执 SHA256。脚本 SHA256 为 `1daf9a17e8ecba6db31df044a41e3a07bbb55a1528660d53896e24fe1bda09cf`。

四个 GPT-6 仅尝试并成功执行 `tabs.open`、`media.screenshot`、`video.studio`。GPT-5.5 另尝试 `project.memory.append`，测试在转发前拒绝；续聊未使用记忆工具。测试没有发送用户页面或素材，也未使用生产 Profile / 原生桌面凭据。

GPT-6 初次封装时的模型目录预检与设置选择记录位于隔离候选 `.bmw-runtime/gpt6-tools/admission.json`、`settings-selection.json`。两项不转发推理；设置检查使用活动仓库的实现。

更早的三引擎各两轮真实验收记录仍保留，证明当时源码的对应链路：Qoder 的 `bmw-native-assistant-350iIN`、DSH 的 `bmw-native-assistant-6gOMWf` 和 Codex GPT-5.5 的 `bmw-native-assistant-BKvQwH`，均在上述临时目录父路径内。

## 本地验证与受保护集成

GPT-6 工具封装的完整离线回归报告：`/Users/changliangxu/Documents/ChatGPT/BMW/.bmw-runtime/classified-tests/2026-10-05-gpt6-browser/result.json`。该报告记录实际完成状态、源码/编译输出哈希与日志，覆盖 build/check、unit/contract/boundary、DSH、默认入口、桌面、Studio、媒体、视频和本地旁白。付费模型证据由上表单独提供，离线检查不证明生产认证或所有模型额度。之前的完整通过基线 `2026-10-05T10-26-55-013Z` 保留。

GPT-6 封装前的全部 342 个 authored 文件和 Git 状态保存在隔离候选 `.bmw-runtime/gpt6-tools/baseline.json` / `before`。源码增量及文档增量分别使用新的哈希清单、原文备份与 `git apply --check`，保留 HEAD、index 和无关源码；记录为 `gpt6-tools/apply.json` 与 `gpt6-docs/apply.json`。此前三驱动集成的原始快照与记录保留。迁移归档和 BMWDev 未修改。

随后登录交互改动的局部报告为 [2026-10-05-login-flow/result.json](../.bmw-runtime/classified-tests/2026-10-05-login-flow/result.json)：32 项选定检查与 4 个检查门通过，覆盖三适配器设置契约、相关边界和隔离 Assistant 窗口；未重新运行无关媒体或付费模型。[合入审计](../.bmw-runtime/classified-tests/2026-10-05-login-flow/integration-audit.json)逐文件证明候选与活动代码一致，并保留原工作区、HEAD 与 index。完整 GPT-6 报告是较早的源码快照，不能称为登录改动后的全量复跑。设置控制检查和 UI 验收不代表名单中的每个模型均完成过真实推理。

生产 macOS 钥匙串和真实 Profile 体验仍由用户操作；模型选择需要其独立 CLI 认证和官方账号目录，GPT-6 实际输入前还需匹配版本的官方缓存。原生桌面列表同步、fork、steer、审批与 nativeOpen 未启用。
