# BMW 当前实现

核对日期：2026-10-08。当前行为与 Schema 见 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md)，模块／接口／测试分支见 [ARCHITECTURE.md](ARCHITECTURE.md)，报告见 [VERIFICATION.md](VERIFICATION.md)。

| 范围 | 当前实现与边界 |
|---|---|
| 桌面与 Agent | 一个 BMW，浏览器／Video Studio／自有 Assistant；DSH、Codex、Qoder CN 各拥有官方循环，唯一 browser 模型工具 |
| Project 与 Session | Project 共享页面和媒体；稳定 Session 固定 Project／driver，Studio 草稿固定唯一 owner；CAS、FIFO、取消清理和 unknown 不重发 |
| 浏览器与媒体 | 页面交互、后台取材、截图、录屏、有限下载、图像检查／标注／绘图、抽帧、裁剪缩放与转换 |
| 视频数据约定 | 单份 Video Document 2.0；可逆简洁子集；类型 CAS 命令／试算、owner 保护、v1 原字节备份；未知/未实现结构拒绝 |
| Video Studio 默认视图 | 卡片内脚本、画面、预览；目标／素材与细节按需展开，统一交付入口 |
| Video Studio 高级视图 | 全窗口资源／画布／属性／多轨、同一 Assistant 浮框／停靠；主轨、独立对象、有限关键帧、整镜头分割、基础颜色／模糊与静音 |
| 语音与字幕 | 真实旁白、原音频播放区间、句级校正／聚焦／板书、原声 ASR 与人工双语字幕；完整音轨 ASR 最多 180 秒，自动词／字精度未批准 |
| 参考与审阅 | SHA 绑定的实际抽样参考 PNG、分析记录与背景采用；可选逐项文本／字幕样式审阅为测试功能，需人工判断 |
| 交付与恢复 | 选择性更新失效旁白、实际 MP4 与内容指纹复用、封面 PNG、SRT/VTT／来源清单、取消后明确续做与签名撤销 |
| 计划任务 | 固定 Project／Session／driver；失效绑定报错，排队／运行时禁止重绑 |
| 当前暂停／未实现 | UI／工作流继续优化暂停；专用 AI 图片／视频生成暂缓；没有通用 NLE、任意 HTML、远控客户端、签名安装器与自动更新 |

Studio 详细映射见 [VIDEO_STUDIO_NEXT.md](VIDEO_STUDIO_NEXT.md)。实现与自动测试通过不等于付费模型、生产钥匙串、完整视频语义或用户体验验收。

## 运行与认证

固定版本为 Node.js 24+、Electron `44.5.1`、Mediabunny `1.61.0`、DSH `0.2.0-rc.2`、Codex App Server `0.160.0` / `0.160.1`、Qoder CN SDK `1.0.50` / Worker `1.1.64`。依赖安装版由 lockfile 固定，外部 CLI 还需通过运行时版本准入。

默认入口由 `scripts/product-entry.ts` 调用 `apps/bmw/agent-assembly.ts`。新 Profile 默认 DSH，之后按 Project 保存 driver 选择。启动沿用已有选择，不自动发起登录；GUI 切换时检查认证。

Profile 为 `BMW`，浏览器分区为 `persist:bmw`。三个引擎分别使用 `dsh-home`、`agent-drivers/codex`、`agent-drivers/qoder-cn`；BMW 保存会话索引、显示历史、回执与模型偏好。DSH 初次初始化可复制普通 CLI 凭据，后续凭据写入只落在 BMW 的独立文件；Codex/Qoder 不读取原生桌面的私有凭据。

DSH 提供 DeepSeek API Key，Codex 提供 ChatGPT 浏览器登录，Qoder CN 调用官方 CLI 登录。Codex 可识别独立 CLI 中的既有 API Key，BMW 当前没有 API Key 输入表单。Qoder 没有已验证的非交互退出控制，退出按钮禁用。DSH 检查的是 Key 是否配置，不验证 Key 有效性或余额。

支持名单与官方目录匹配后才可选择：Codex 为四个已封装 GPT-6 型号与 GPT-5.5；DSH 为两个官方 DeepSeek 路由；Qoder CN 为维护的 14 个启用型号，完整 ID 见功能规格。支持名单不等于账号推理额度，也不代表全部型号逐一完成付费验收。设置不发送模型输入；Qoder 冷控制会话仍内部核对 SDK 初始化目录，实际输入前所有引擎均要求有效工具目录恰好一个 browser。

## 数据与运行限制

正常启动只接受 v2 Agent 数据，历史转换通过 [显式迁移命令](AGENT_DATA_MIGRATION.md)，不自动导入或认领。已授权的本机迁移记录属于历史证据；本轮核查不修改生产 Profile 或 Project 文件。

原生桌面列表同步、fork、steer、Agent 原生审批与 nativeOpen 未启用。损坏状态保留原文件并提供重试／退出，清理失败隔离资源。设备编码能力和 Edge 外部服务影响成功率；实际 alpha 视频抽帧／转换拒绝。ASR macOS 分支有实测，Linux 分支未实测。

## 文档入口

README 提供安装与使用；FUNCTIONAL_SPEC 维护功能契约；ARCHITECTURE 生成接口与测试映射；VERIFICATION 解释运行结果及边界；handoff 提供当前开发状态。原评审、P0 和旧方案已转为 [历史入口](history/2026-10-07-consistency/index.md)，不作为当前待开发清单。迁移归档 ../Agent in Browser 与独立 BMWDev 不属于活动 BMW 的权威来源。
