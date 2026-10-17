# BMW 验证说明

核对日期：2026-10-17。当前功能以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准，分类与运行配置见 [ARCHITECTURE.md](ARCHITECTURE.md)。通过结果须绑定当时源码，不能按文档日期推断完整覆盖。

## 当前三方对齐基线

文档、实现、测试和生成清单已对齐。具体修复及失败过程见[本次验收归档](history/2026-10-17-alignment/README.md)，可移植的[逐项摘要与源码指纹](history/2026-10-17-alignment/verification.json)随仓库保存。

| 本次执行 | 结果与范围 |
|---|---|
| npm run build、npm run check | 通过：编译、冻结源策略、Schema／示例、功能与架构清单一致性 |
| docs:video-schema、docs:features、docs:architecture | 已重新生成并检查；生成行为本身不计作测试通过 |
| npm run verify:stability | [完整报告](../.bmw-runtime/classified-tests/2026-10-17-alignment-final/result.json)：154 passed、0 failed、11 not-run；149分类项＋5门禁，包含unit／contract／boundary及相关运行时；桌面汇总不另算独立保障 |
| 修复专项 | 音频首次中段／重叠PCM对照、音轨菜单预览和AAC、来源GUI、96镜头Assistant、版本发现契约通过；这些已被最终完整回归包含，不叠加计数 |
| 文档与提交校验 | 提交前复查链接、锚点、git diff --check和全部非Markdown受测文件SHA；两条旧本机日志缺失仍明确保留在历史归档 |

六个未运行项依赖显式本地素材：media.source-analysis-case、media.frame-sampling-case、media.long-composition-case、video.qbit-playback、video.qbit-stage4-samples、video.qbit-stage3-samples。另五项为external.assistant.dsh/codex/qoder-cn、external.vision和external.edge。runner的统一原因文字不代表六个素材夹具属于外部服务。

Electron使用一次性数据和模拟钥匙串。首次受沙箱启动限制及之后定位到的三项失败均留档；不是重试掩盖失败。正式基线绑定修复后源码；完成后仅回填说明文档，受测代码／配置／Schema的430个SHA保持一致。原始日志、截图和媒体留在本机，GitHub仅保存摘要及指纹，不宣称远程CI已运行。

## 已有证据与适用范围

| 证据 | 已记录的范围 | 当前解释 |
|---|---|---|
| .bmw-runtime/classified-tests/2026-10-15T14-06-49-153Z/result.json | 完整 --all：142 passed／0 failed／5 external not-run | 首次文档整理时，旧报告的410个文件中55个已变化，不覆盖之后新增文件；保留为历史完整快照 |
| .bmw-runtime/qbit-final-report/completion-audit.json | 2026-10-16 四阶段；89项 unit/contract/boundary、桌面五个结果（含重启）及相关运行时 | 来源11条、4268基础帧／4494总帧，夹具 reviewed=0；长篇640×360／12fps；不是全视频语义审阅或新版完整 --all |
| .bmw-runtime/qbit-playback-review/review-evidence.json | 2026-10-17 四条样片副本修订、72张关键帧和实际播放器 ended 记录 | acousticListeningCompleted=false；PIP已改横屏，实际文件34.730667秒，时间线34.666667秒；不沿用旧40秒全竖屏说明 |
| .bmw-runtime/pelican-p1/verification-summary.json | 实际 BMW Codex＋GPT-6.1，3回合／76调用，唯一 browser；资源保全／采集／音频技术证据 | 技术门通过，allRequestedP1Resolved=false；模型未接收音频，Veo最终归因未闭环 |
| Simon V1／V2 及双驱动生产可靠性 | 实际制作、当前指纹关键帧及单独整片 Agent 意见 | 历史版本的内容验收范围；不能推断用户已认可或已核听，详见下方历史入口 |

首次文档整理读取了量子位审计、播放证据和旧完整报告，并比较旧报告中的源码SHA；后续完整离线回归也没有重新解码全部专用样片或重复视觉／音频审核。样片和原来源哈希保持属于各阶段报告的证据声明，不扩写成本轮全量实测。

## 历史记录入口

- [媒体P1、Simon、生产可靠性、共享Schema及失败过程](history/2026-10-17-documentation/VERIFICATION.md)：保留整理前的详细原文。
- [三驱动实施验收](history/agent-drivers/IMPLEMENTATION.md)：固定版本和真实模型历史快照，部分临时路径可能不在当前机器。
- [量子位四阶段与播放修订](history/qbit/IMPLEMENTATION.md)：完成范围、样片版本、S04缺口、声音与叙事限制。
- [更早的一致性／P0记录](history/2026-10-07-consistency/index.md)：原文与相对路径按当时上下文解释。

<a id="simon-研究与叙事重剪"></a>
Simon 的两册研究、98个记录组与V1/V2详见[原记录](history/2026-10-17-documentation/VERIFICATION.md#simon-研究与叙事重剪)。研究完成、技术完成、Agent意见和用户满意度分别记录。

<a id="user-listened-whisper-base-adoption"></a>
十段base标注的用户核听采用见[原记录](history/2026-10-07-consistency/VERIFICATION.md#user-listened-whisper-base-adoption)，不是独立声学金标或自动词／字精度批准。

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
| npm run verify:stability | 一次fresh build后串行全部非opt-in分类，包括各Studio环境分支；专用素材夹具和external单列未运行 |
| npm run docs:features / docs:architecture | 刷新源码生成清单；刷新本身不是测试通过 |

所有含构建的命令顺序执行。资源受限时使用 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。直接调用 test-runner 必须匹配最新 build receipt；源码在验证中变化使 source-integrity 失败。完整通过时才更新 test-baseline.json；失败保留旧完整基线和本次失败日志。

## 证据边界

Electron 使用临时 Profile／Project，DSH 使用临时 Home／Workspace；macOS 测试使用 mock keychain。真实生产 Profile、系统钥匙串授权、实际用户使用体验及设备／网络差异不能由隔离夹具证明。原生鼠标事件、DOM／IPC、共享 Canvas、实际 MP4 和音频验证按各日志范围解释，不扩展为完整用户验收。

离线测试不使用付费模型或 Edge 网络语音，不证明 OAuth／Key 有效性、余额、所有模型额度、翻译／建议质量或完整视频语义。external.assistant.*、external.vision、external.edge 是独立 opt-in；本轮不重新运行。专用 AI 素材生成暂缓，无对应服务接入或验收。

## 维护当前基线

VERIFY-01已按上述范围完成并[归档](history/2026-10-17-alignment/README.md)。下一次实现或测试改动按AGENTS重新验证；不得把旧142项、阶段89项和当前154条记录相加。当前优先级见[下一步设计](plans/NEXT_STEPS.md)。本机运行产物被Git忽略，换机需单独保留；路径存在不代表完整内容已审阅。
