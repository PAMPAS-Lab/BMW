# BMW current handoff

核对日期：2026-10-17。本次提交整合已有实现、测试和文档分层，并修复三方核对发现的音频读取、版本发现及旧测试问题。未来创作方案保持设计状态。

## 接手入口

先读 [AGENTS.md](AGENTS.md)、[文档导航](docs/README.md)、[当前状态](docs/PROJECT_STATUS.md)和[功能规格](docs/FUNCTIONAL_SPEC.md)。当前工作树支持 Video Document 2.0–2.9、正式全片分析、720秒／96分镜、有界混音、文字包装与有限科学图解。已完成阶段见 [历史索引](docs/history/README.md)，不要按旧设计的“待实现”重复开发。

当前重点是 [下一步设计](docs/plans/NEXT_STEPS.md)：P1 音频准入与 Veo 时基归因未闭环，P2 叙事／解释质量仍不足。先形成可比较的脚本与节拍样片，再评估受控指导及只读制作影响计划。图文长篇独立设计；UI 优化和专用 AI 素材生成仍暂缓，不安装外部 skill 或增加模型工具。

## 代码与证据

| 范围 | 入口与约束 |
|---|---|
| 官方循环／唯一 browser | apps/bmw/agent-assembly.ts、agent-contract、各 harness；有效目录准入不能由提示词替代 |
| 文档／类型命令 | feature-video 的 video-document.ts、video-edit-contract.ts、studio-discovery.ts；owner、CAS、可信高级权限和有界模型读取 |
| 全片分析 | source-analysis-contract/service/store；独立任务 revision、SHA、8图分页，提取与作者审阅分开 |
| 长篇／包装／图解 | media-native 的 composition-limits.ts、media/composition-audio.ts、layer-text-treatment.ts、layer-packaging.ts、science-spec.ts |
| 采集／音频 | capture-timeline.ts、capture-source-index.ts、media-preservation.ts、audio-evidence-contract.ts；源时间、文件 PTS、呈现时钟与核听状态分开 |
| 改稿与复用 | studio-service.ts、studio-store.ts、studio-timing-diagnostics.ts、studio-card-speech.ts；不要另建时间线或执行器 |

当前完整回归为154 passed、0 failed、11 not-run（149分类项＋5门禁），源码指纹和失败修复过程见[验收归档](docs/history/2026-10-17-alignment/README.md)。旧142项完整报告、量子位阶段及样片播放修订另记；最新范围见[VERIFICATION.md](docs/VERIFICATION.md)。模型直接核听仍未完成，Veo 根因未最终归属；样片播放、PCM 与 ASR 均不能替代听感验收。

本地 .bmw-runtime 证据被 Git 忽略；原研究、V1／V2、量子位原版与修订版均保留。媒体与证据文件没有随文档移动。仓库保存可移植的验证摘要，原始媒体和完整日志不随提交上传。

## 后续验证

本轮build/check、完整非opt-in分类及文档校验通过，覆盖unit／boundary和Electron／DSH／Studio／媒体／旁白。未执行六个专用本地素材夹具、五项外部模型／服务及生产Profile验收。下一次运行时改动按 AGENTS 完成相关 DSH、desktop、Studio、media、video、narration 检查；建立当前完整基线时冻结源码并运行 verify:stability。所有构建命令串行，测试使用一次性 Profile／Home／Workspace，不操作系统凭据提示。
