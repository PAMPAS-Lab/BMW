# BMW 验证说明

当前契约以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准；所有自动测试及其运行配置从 scripts/test-catalog.ts 生成在 [ARCHITECTURE.md](ARCHITECTURE.md)。报告中的源码哈希决定结论适用版本，历史通过记录不能替代当前源码回归。

## 本轮共享视频 schema 验证

本轮实施单份 Video Document 2.0、简洁编辑可逆子集、可信高级权限、类型命令、原字节备份与无损迁移。没有继续扩展 UI 工作流或专用 AI 素材生成；原生复测发现的模式切换播放位置和时间轴末端手柄被原生滚动条遮挡问题已修正。旧分支中“独立对象可返回卡片”的断言按批准的共享约束改为阻止返回并保留内容；原始时钟、实际鼠标、CAS、签名撤销及原生媒体精度断言继续保留。

2026-10-08 同版完整离线原生回归已完成，报告为 `.bmw-runtime/classified-tests/2026-10-08-video-schema-accepted/result.json`：130 个离线分类项、四个检查门与桌面汇总全部通过，共 135 个 passed、零 failed；五项 external 未运行。runner 退出零并更新完整 test-baseline.json，运行期间源码与编译输出保持冻结。测试后仅本验证说明更新，随后 npm run check 通过；完整基线保留 runner 实际运行时的哈希，不手工改写为文档更新后的哈希。

两份机器 JSON Schema 经独立 Draft 2020-12 校验器检查，三份文档／命令示例均有效；运行时代码生成的 Schema 和示例纳入 npm run check。video.schema 的九项契约测试与既有 Studio 的 111 项测试共同通过，覆盖完整字段往返、原字节备份、亚微秒迁移、时间权威、身份／未知结构拒绝、简洁闭包、owner／CAS、原子提交、无写入试算及实际高级授权。studio.schema 验证真实鼠标创建对象、UI／IPC 返回限制、陈旧 selection／revision、签名撤销恢复简洁、Agent 拒绝绕过、试算和真实 MP4；完整原生分支继续验证源字幕／语音、切割／缓动／淡入淡出、特效／音轨、Assistant、恢复、Project 和导出。

初始作者文件、HEAD 和 index 保护审计与补丁、机器 Schema 独立校验、报告副本存于本次任务 bmw-video-schema-implementation 输出目录。此次未提交／推送，也未修改生产 Profile 或用户 Project。保护审计另发现八个带编号的源码／文档副本，未由本次补丁产生，来源未确认；已记录哈希并保留，不作为活动入口或权威文档。

## 命令与覆盖

| 命令 | 实际范围 |
|---|---|
| npm run build | 编译所有作者 TypeScript、正反类型消费者，生成源码／输出哈希收据 |
| npm run check | noEmit 编译、源语言／冻结例外检查、视频 Schema／示例、功能与架构生成清单一致性 |
| npm test | 分类 unit、contract、boundary；不是全部 runtime |
| npm run test:contracts | contract 与 type 分类 |
| npm run test:studio-e2e | video-studio-smoke 默认分支；不自动触发其各个专用分支 |
| npm run test:desktop-e2e | 四个 desktop 分组及 Project 实际重启；各组独立报告 |
| npm run test:media-e2e | 后台页面、采集、处理；不含全部视频／语音分支 |
| npm run test:video-e2e | 原生视频 smoke；实际混音、H.264/AAC、轨道／时长与验证回执 |
| npm run test:tts-e2e | 默认 local-matcha 本地旁白；Edge 需显式 opt-in |
| npm run test:affected -- --files … | AST 依赖、行为 watch 与接口保障选择并执行；未知／删除／共享配置保守升级 |
| npm run verify:stability | 一次 fresh build 后串行全部离线分类测试，包括各 Studio 环境分支；external 不运行 |
| npm run docs:features / docs:architecture | 刷新源码生成清单；刷新本身不是测试通过 |

所有含构建的命令顺序执行。资源受限时使用 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。直接调用 test-runner 必须匹配最新 build receipt；源码在验证中变化使 source-integrity 失败。完整通过时才更新 test-baseline.json；失败保留旧完整基线和本次失败日志。

## 证据边界

Electron 使用临时 Profile／Project，DSH 使用临时 Home／Workspace；macOS 测试使用 mock keychain。真实生产 Profile、系统钥匙串授权、实际用户使用体验及设备／网络差异不能由隔离夹具证明。原生鼠标事件、DOM／IPC、共享 Canvas、实际 MP4 和音频验证按各日志范围解释，不扩展为完整用户验收。

离线测试不使用付费模型或 Edge 网络语音，不证明 OAuth／Key 有效性、余额、所有模型额度、翻译／建议质量或完整视频语义。external.assistant.*、external.vision、external.edge 是独立 opt-in；本轮不重新运行。专用 AI 素材生成暂缓，无对应服务接入或验收。

## User-listened Whisper base adoption

十段 base 音频和十二个可编辑锚点的用户核听采用属于既有历史证据，原记录见 [采用记录](history/2026-10-07-consistency/VERIFICATION.md#user-listened-whisper-base-adoption)。它证明当时的手动采用路径，不是独立声学金标或 P95 准确率；自动句／词／字同步精度未获批准。

## 历史报告

共享 schema 前的一致性报告保留在 `.bmw-runtime/classified-tests/2026-10-07-consistency-*`；这些历史结果不证明当前 schema 版本：

| 后缀 | 范围与解释 |
|---|---|
| audit | 首次全量；发现过时 HTML5 拖放测试 |
| final | 修正后全量；原生卡片夹具失败，其余项按原哈希解释 |
| focus | Studio／边界；保留原生输入和旧草稿等待失败 |
| card-isolated / card-fixtures / card-diagnostics | 单独原生尝试与事件诊断；buttons=0、captured=false 暴露缺失左键按住状态 |
| card-native | 原生卡片专项通过；实际 buttons=1、指针捕获、真实失焦／Escape／越界、CAS 与媒体断言均保留 |
| fixtures | Studio／Assistant／启动恢复／边界；素材替身缺少 updateTabState，延迟保存触发原生错误弹窗；分割等待顺序错误及最后原生焦点因锁屏失败。日志与进程栈保留 |
| dom-repair | 当前编译版本的素材延迟页签保存、带绑定／普通整镜头分割均通过；DOM／IPC／原生媒体证据，非前台指针验收 |
| 2026-10-08-consistency-native（独立完整目录） | 同版 --all 全量通过，132 passed／0 failed／5 external not-run；真实焦点与指针、所有 Studio／Assistant 分支、四组桌面及 Project 重启、原生媒体通过；完整基线已更新 |

修正包括等待原生／页面焦点稳定，所有原生拖动移动携带 leftbuttondown，卡片外释放坐标仍在所属 WebContents，独立分割 scene ID 与所属草稿七秒预览等待，以及隔离 ProjectStore 页签保存契约。未捕获测试异常直接打印并失败退出，避免 Electron 原生错误弹窗阻塞验证。素材截图采用现有的有界 renderer evidence 路径。产品失焦取消、归属、CAS、历史与媒体规则没有因此放宽。

2026-10-08-consistency-native 是引入共享 schema 前的完整基线。当前 schema 调整后的早期全量报告保留在 `2026-10-08-video-schema`、`2026-10-08-video-schema-final`、`2026-10-08-video-schema-verified` 和 `2026-10-08-video-schema-complete`；这些尝试包含失败，不能当作本轮通过证据。`.bmw-runtime/video-schema-corrected` 保留真实鼠标、预览绘制时序、缓动裁剪手柄和语音绑定切割的独立复测／诊断。最新完整结论以本文顶部指定的 accepted 报告与其源码哈希为准；没有覆盖早期失败日志或手改测试基线。

2026-10-05 的 Agent 数据／GPT-6／登录报告、已授权真实 Profile 迁移与付费模型快照、2026-10-06 至 10-07 各 Studio 专项、失败尝试及锁屏等环境限制完整保存在 [核查前验证原文](history/2026-10-07-consistency/VERIFICATION.md)。[驱动实施证据](AGENT_DRIVERS_IMPLEMENTATION.md) 保持对应版本解释。旧结果的源哈希和适用范围不因此次整理改变。

当前功能不再重复标为待开发。历史“仍未完成／待解锁／继续推进”仅属于该阶段；后续 UI 优化现已暂停。产品状态见 [PROJECT_STATUS.md](PROJECT_STATUS.md)，Studio 能力与测试对应见 [VIDEO_STUDIO_NEXT.md](VIDEO_STUDIO_NEXT.md)。
