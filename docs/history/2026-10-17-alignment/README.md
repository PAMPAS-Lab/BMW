# 2026-10-17 文档、代码、测试对齐验收

状态：VERIFY-01 已完成对应离线范围。当前规范与剩余工作分别见 [功能规格](../../FUNCTIONAL_SPEC.md)和[下一步设计](../../plans/NEXT_STEPS.md)。

## 结果与证据

最终完整回归：154 passed、0 failed、11 not-run。154 是149个分类项加5个门禁记录，desktop-suite为桌面分组汇总，不额外算作独立功能用例。覆盖unit、contract、boundary、type、DSH／会话集成、Studio各分支、desktop、media、video、speech及本地旁白。

[可移植验证摘要](verification.json)记录逐项状态、依赖版本、430个非Markdown源码／配置／Schema文件SHA、受测文档SHA及原报告SHA。完整原报告为本机 [result.json](../../../.bmw-runtime/classified-tests/2026-10-17-alignment-final/result.json)；日志、截图、音频和视频被Git忽略，不能声称GitHub包含它们。摘要不是远程CI重新运行的结果。

六个not-run是需显式本地素材的source-analysis、frame-sampling、long-composition及三个qbit案例；另五个是DSH/Codex/Qoder真实模型、vision和Edge语音。runner旧原因文字统一为External opt-in required，实际类型以上述分组为准。未执行生产Profile、付费推理、真人或模型核听，不推断720秒1080p30性能。

## 本次发现与修复

| 问题 | 实现／文档对齐 | 回归保障 |
|---|---|---|
| 峰值扫描后首次中段播放或向前重叠读取丢失源音频 | AudioWindowReader按已消费区间的结束位置决定重新解码；连续窗口仍复用状态 | 新增真实AAC／WAV首次中段与重叠窗口逐样本对照；修复前复现失败，修复后通过；原音轨菜单的预览／AAC静音断言保持 |
| Studio上下文仅公布2.6，文字仍停2.5，实际能力已2.9 | Schema、类型、describe-schema/list和模型上下文共用video-document-version清单；旧文档仍按能力保留最低版本 | video.schema比较上下文、发现及发布Schema，保留旧版本拒绝与往返测试 |
| 旧桌面夹具认为24镜头应禁用新增 | 夹具提升至96镜头／576秒，继续断言长中文、完整脚本、滚动、单份编辑器和预览清理 | assistant.application实际原生窗口通过；独立24镜头布局场景仍保留 |
| 来源面板测试在高级视图尚忙时点击读取 | 等待模式切换结束和真实控件可操作，不加固定延时或绕过忙碌保护 | sources完整采集、引用、预览、缺失素材及恢复断言通过 |
| 当前规格仍写编号时钟最多24 | 更正presentationWindow的musicIndex／sceneNumber／sceneCount为96，旧2.0–2.5仍限24 | 既有2.6扩展时钟与旧版本拒绝用例；Schema／features／architecture重新生成并检查 |

## 失败记录与复查方法

首次沙箱运行的Electron进程启动即退出143，未当成功；解除测试进程的运行限制后，完整报告为151 passed／3 failed／11 not-run，三项为sources、assistant.application、studio.track-menu。修复后先通过专项，再冻结源码完整重跑。两份失败报告路径、SHA和失败ID保存在摘要，原日志未覆盖。

最终运行期间源码哈希保持一致；结束后仅更新验证结果、当前状态、交接和计划归档等Markdown，并新增本摘要。提交前再次执行check、文档链接／锚点及diff检查，并比较全部非Markdown受测文件SHA。后续改动应重新运行适用检查，不能把本快照当作永久认证。
