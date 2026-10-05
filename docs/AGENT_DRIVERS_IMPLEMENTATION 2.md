# BMW 多 Agent 实施状态

DSH / Codex / Qoder CN 方案已实现并完成必要验收，见 [统一设计](AGENT_DRIVER_DESIGN.md)。默认入口使用 BMW 自有 Assistant 和三个官方驱动，旧 DSH 兼容实现仍保留。源码已按原文哈希合入活动 BMW 工作区；活动工作区完整本地回归通过，三个引擎各两轮的最终真实模型验收也通过。用户在 BMW Assistant 中交互；原生桌面会话列表同步未启用。

## 已实现

- BMW 保持一个应用、一套 Project 页面、媒体和 Studio。三个官方运行时拥有各自 Agent Loop；Host 管理会话、输入回执、全局 FIFO、设置排除与资源生命周期。
- BMW Session 固定 Project 和 driver，先创建可见空会话；provider resume ID 是不可替换的独立锚点。输入先持久化，结果未知时不自动重发。切换引擎选择同一 Project 中的独立会话，页面和媒体共享，Studio owner 与 CAS 修订保持独立。
- Agent 输入前验证实际模型目录恰好只有 `browser`。DSH 每次模型请求重查 scoped catalog；Codex 使用官方 dynamic tool 回调连接同一认证 Bridge；Qoder 使用严格 MCP 配置、空 skills/plugins 与真实 init 门槛。未知版本、额外工具或未验证模型组合不释放输入。
- Bridge 绑定来自 Host 私有租约，模型不能改写 Session。撤销先停止准入，再等 browser/media 与原生 Worker 实际清理。清理失败隔离资源，恢复只重试清理。Qoder 取消、关闭失败、跨 Session 拒绝和恢复不重发输入已有直接验证。
- Assistant 提供会话创建、选择、改名、归档、消息、工具进度、停止、Browser/Studio 模式与资源恢复。IPC、Markdown、设置投影和持久化输入均有闭合准入；秘密不会回显到设置状态或消息中。
- 三个引擎使用独立 Profile 和官方正常认证流程。Codex 发现公共 CLI，缺失时显示安装状态；Qoder 使用随包安装的官方 CLI 登录，未验证的退出操作保持禁用；DSH 将旧共享凭据链接变为独立文件，保留共享来源。设置和实际清理持有与 Agent 输入相同的资源排除。
- 旧 DSH 会话与历史通过官方冷接口、固定 cursor 和完整分页迁移，保留 owner、原 ID、lineage 和 archive。两步保存可恢复，导入失败阻止该会话输入，清理恢复不重复发现或发消息。
- 计划任务固定 Project、BMW Session 和 driver。失效绑定不会转到当前会话；旧有绑定保留 DSH，无绑定旧任务暂停等待显式修复。双引擎调度与执行后的原选择恢复已通过实际 Host/Bridge/Studio 验证。
- `qoder-bmw` 作为适配器和复用指导包随源码提供，见 [接入说明](QODER_BMW.md)。固定指导直接进入 SDK system prompt，保持 `skills: []`；权限由 Host/Bridge 承担，不维护应用副本，不导出长期 token 或全局临时 binding。

原生桌面侧边栏同步、fork、steer、Agent 审批与 nativeOpen 只有在实际验证后才能启用。当前没有声明 Qoder/Codex SDK 会话会出现在其原生桌面列表。

## 运行时与模型门槛

| 引擎 | 已验证基线 | 边界 |
|---|---|---|
| DSH | 0.2.0-rc.2 | 官方 scoped catalog、durable events、独立原生进程清理与恢复 |
| Qoder CN | SDK 1.0.50 / CLI Worker 1.1.64 | init 必须只有已连接的 browser，不继承 skills/plugins |
| Codex | App Server 0.160.0 / 当前测试账号 gpt-5.5 | 官方可用模型成员检查及 Responses/Lite 有效工具目录检查 |

Codex 的 gpt-5.5 结果不能推广到其他模型。当前验证中 gpt-6.1-sol 的 Lite `additional_tools` 包含执行、问答和协作能力，因此在唯一工具门槛下被拒绝；旧 gpt-5.4 离线目录通过不能证明该账号可用。发送前仍须读取实时认证和账号模型成员关系。

Qoder 未登录冷控制返回 `error_during_execution`、零轮次和零费用。只在 init 前精确匹配该公开错误时显示登录入口；其他执行结果或异常模型事件仍失败保护。模型选择只在真实控制进程关闭、事件读取结束后保存偏好。

## 本地验收证据

隔离实现位于 `/private/tmp/bmw-agent-drivers-20261005`，分支 `codex/bmw-agent-drivers`。活动 BMW 的最终完整报告为 `/Users/changliangxu/Documents/ChatGPT/BMW/.bmw-runtime/classified-tests/2026-10-05T10-26-55-013Z/result.json`，**terminal exit=0**：52 个 contract、19 个 unit、5 个 boundary、1 个 type、25 个 integration、6 个 media、4 个 desktop 分类项和 5 个检查门槛全部通过，合计 112 个分类项。包含独立 Project 进程重启；截图、独立帧解码和 native focus/键盘断言保持启用，实际通过。

报告覆盖默认三驱动入口、空会话及跨进程恢复、独立认证/安装状态、损坏数据重试/退出、旧 DSH 迁移、固定调度、Studio owner/CAS、后台页面、真实图像与媒体、MP4/WebM、取消及本地旁白。五个 external opt-in 项在这份离线报告中仍为 not-run；其中三个原生模型验收通过下述独立执行记录补充，没有改写离线报告。外部 Edge 服务未在本轮执行。

完整回归后只修改本文和 handoff 的最终验收状态；运行时代码、资源、锁文件和编译输出均未修改。最终证据审计核对 319 个报告源文件，除已单独登记并通过 check 的 handoff 状态句外均与完整报告一致；313 个编译源文件和 283 个输出哈希一致。完整报告和原始基线保留原样，不把文档更新后的哈希写回旧报告。

正式入口 `assistant.default` 包含三引擎空会话、Project 页面、Studio owner、认证/安装状态、固定计划任务失效拒绝，以及独立 Electron 进程重启恢复。此前缺少 Qoder Worker 的完整报告 `2026-10-05T09-18-46-664Z` 和锁屏期间失败的 `2026-10-05T09-45-14-942Z` 保留为失败证据；补齐官方运行时、解锁后，本次完整回归通过。没有修改或停用失败项的断言。

此前锁屏期间失败的完整报告 `2026-10-05T08-19-48-234Z` terminal exit=1，仍保留；缺固定缓存的 `2026-10-05T08-10-14-854Z` 也不是通过报告。七个固定 TTS/ASR 缓存按源码 SHA256 导入隔离目录后，media 重跑及上述完整重跑通过。没有复制用户 Profile 或认证文件。

干净安装验证目录为 `/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-agent-clean-install-kgZXGZ`：342 个源码和资源文件，`npm ci --ignore-scripts`、build、check terminal exit=0。跳过安装脚本，因此不证明 Electron/vendor 安装脚本。目标工作区依赖已补齐，SDK 1.0.50、CLI 1.1.64、sharp 0.35.4 与候选锁文件一致，npm audit 零项漏洞；该结论仅覆盖锁文件依赖。

目标工作区已运行 Qoder SDK 官方 postinstall，固定 CN 生产镜像和 Worker 1.1.64，保持 SHA256 校验开启；安装输出为 `Checksum verified`。当前 darwin-arm64 Worker 为 33,191,711 字节，SHA256 `c3985cfe6438bdb50919656cf9a8babb0dbd057092d5416b0b40bc159ef42935`。`--ignore-scripts` 本身不安装这项运行时，不能只凭 build/check 声称 SDK 可运行。安装与哈希证据在隔离目录 `.bmw-runtime/qoder-worker-target-install.json`。

目标适配器使用既有独立测试认证完成官方只读账号/模型查询：Codex、Qoder 均 ready，分别返回 8、14 个模型目录条目；模型输入和 browser 执行均为零，没有使用原生桌面 Profile。目录查询不证明每个模型实际推理可用或通过唯一工具边界，真实复验仍单独进行。证据为隔离目录 `.bmw-runtime/settings-native-read-target.json`。

## 最终原生模型证据

用户明确授权“确认进行测试，可以使用模型额度”后，从活动 BMW 的最终构建运行三个引擎，各两轮，均 **terminal exit=0**。第一轮真实打开一次性 loopback 页面，读取 PNG 中的随机码和色块，创建 owner 为当前 BMW Session 的 Studio 草稿；第二轮关闭原生运行时后恢复同一 provider Session，仅回复上一轮续聊随机码。三个第二轮均未调用工具，随机码没有写入 Project 记忆文件。Assistant 原生截图和持久化 Studio JSON 已检查。

- Qoder CN：`/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-350iIN/result.json`。
- Codex：`/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-BKvQwH/result.json`。
- DSH：`/private/var/folders/17/gv744dkj58781n5k445yqq240000gn/T/bmw-native-assistant-6gOMWf/result.json`。

最终脚本 `scripts/native-assistant-case.ts` SHA256 为 `11d7619f8538cdd86f797151237d63150a84ff451d1e7fbfd8cd1bc42624a2c5`。使用全新临时 Profile/Project 和独立测试认证，仅发送自身页面的随机码和色块，没有使用用户页面、素材或生产 Profile。此前自动审批因缺少截图和额度授权拒绝的调用没有执行；本次在明确授权后执行。

Qoder CN、DSH 只尝试并完成允许的打开页面、截图和创建草稿动作。Codex 还尝试 `wait` 和 `project.memory.append`，测试边界在转发前拒绝，两项 `tool.completed.success=false`。成功执行动作仍只有允许的 browser 操作；这份证据不声称 Codex 完全没有额外尝试。三个运行时暴露给模型的工具均通过唯一 `browser` 门槛。

最终执行登记和逐项证据审计位于隔离目录 `.bmw-runtime/final-validation-runs.json` 与 `.bmw-runtime/final-validation-audit.json`。更早的隔离模型结果保留为历史，不作为本轮通过证据。

## 受保护集成

初始 authored 快照包含 272 个文件，位于 `/private/tmp/bmw-agent-trigger-20261005/implementation/prechange`。实施期间原仓库新增的八个 Studio 更新已按原快照、隔离改动和最新原文采纳，原始快照保留。

2026-10-05 已合入 **37 个修改文件、70 个新增文件**。应用前核对全部原文 SHA256、新增路径、补丁 SHA256，并重新执行 `git apply --check`；修改前原文保存在 `/private/tmp/bmw-agent-drivers-20261005/.bmw-runtime/integration-backup/2026-10-05T09-03-14-081Z`。Git index、HEAD 与无关基线文件保持原样。安装依赖后 342 个目标源码/资源哈希均符合预期，锁文件与隔离候选一致，目标 build 和 check 通过。应用记录为隔离目录 `.bmw-runtime/integration-apply.json`，当前清单与补丁为 `integration-delta-final.json` / `bmw-agent-drivers-final.patch`；准备时的 `integration-delta.json` 留作历史，不能替代后续文档更新后的哈希。

原迁移归档未修改，生产 Profile 未用于验收。旧 DSH UI 实现继续保留；只有新 UI 所需能力等效后才能移除。

## 验收边界

必要实施、活动仓库集成、本地回归和三引擎真实模型验收已完成。生产 macOS keychain 授权与真实 Profile 体验保留人工验收边界。未验证的原生桌面列表同步、fork、steer 和审批入口继续禁用；目录成员不等于所有模型实际可用。
