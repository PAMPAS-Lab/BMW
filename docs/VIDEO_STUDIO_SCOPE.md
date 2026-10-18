# Video Studio 当前范围

核对日期：2026-10-18。功能字段与拒绝规则以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准，测试分支以 [ARCHITECTURE.md](ARCHITECTURE.md) 生成表为准。

当前范围包含共享视频文档、两种编辑视图、真实素材与旁白，以及关键状态/手机审片、句级卡片引用、Project 素材索引、区间 ASR、原声转解说和录屏整理。专用 AI 图片／视频素材生成暂缓。
## 已实现与对应保障

| 能力 | 代码入口 | 分类测试 ID |
|---|---|---|
| 新闻选题、可信确认与制作引导 | [news-service.ts](../packages/feature-video/src/news-service.ts)、[news-store.ts](../packages/feature-video/src/news-store.ts)、[studio-news.ts](../packages/feature-video/src/renderer/studio-news.ts) | video.news、studio.news、browser.sources |
| Video Document 2.0–2.10、无损迁移、简洁可逆子集与类型命令 | [video-document.ts](../packages/feature-video/src/video-document.ts)、[video-edit.ts](../packages/feature-video/src/video-edit.ts)、[studio-compatibility.ts](../packages/feature-video/src/studio-compatibility.ts) | video.schema、studio.schema、video.production |
| 三类工作表／有限配方、来源关系、句目标与只读改稿影响 | [production-contract.ts](../packages/feature-video/src/production-contract.ts)、[production-types.ts](../packages/feature-video/src/production-types.ts)、[production-impact.ts](../packages/feature-video/src/production-impact.ts) | video.production、studio.production |
| 独立类型审阅与人工试听／复述声明 | [production-assessment.ts](../packages/feature-video/src/production-assessment.ts)、[studio-production-editor.ts](../packages/feature-video/src/renderer/studio-production-editor.ts) | video.production-assessment、studio.production |
| AK事件／独立测量、代码／聊天／分组与方阵预合成 | [research-diagrams.ts](../packages/media-native/src/research-diagrams.ts)、[precomposition.ts](../packages/media-native/src/precomposition.ts) | media.research-diagrams、media.precomposition、media.research-video |
| 卡片内脚本／画面与固定预览、拖动调序 | [renderer/studio-cards.ts](../packages/feature-video/src/renderer/studio-cards.ts)、[studio.ts](../packages/feature-video/src/renderer/studio.ts) | studio.card-pair、studio |
| 空草稿、后台初稿、成片与竖屏交付 | [renderer/studio-workflow.ts](../packages/feature-video/src/renderer/studio-workflow.ts)、[studio.ts](../packages/feature-video/src/renderer/studio.ts) | studio.workflow-entry |
| 零分镜素材准备与真实网页采集 | [studio-assistant.ts](../packages/feature-video/src/studio-assistant.ts)、[studio-runtime.ts](../packages/feature-video/src/studio-runtime.ts) | studio.materials-entry、driver |
| 全窗口高级布局、同一 Assistant 浮框／停靠与固定输入范围 | [platform/studio-layout.ts](../packages/platform/src/studio-layout.ts)、[studio-runtime.ts](../packages/feature-video/src/studio-runtime.ts)、[agent-ui](../packages/agent-ui/src/renderer/assistant.ts) | assistant.application、platform.docking、agent.studio-composer |
| 主轨、独立对象、画布移动缩放与有限关键帧 | [studio-main-edits.ts](../packages/feature-video/src/studio-main-edits.ts)、[studio-layer-edits.ts](../packages/feature-video/src/studio-layer-edits.ts)、[renderer](../packages/feature-video/src/renderer) | video.studio、studio、video |
| 有限整镜头分割、原始时钟及可信句／原声字幕绑定 | [studio-scene-split.ts](../packages/feature-video/src/studio-scene-split.ts)、[studio-speech-origin.ts](../packages/feature-video/src/studio-speech-origin.ts) | studio.whole-scene-split、studio.bound-scene-split、media.scene-clock |
| 原声字幕重新映射与人工双语保护 | [studio-source-speech-contract.ts](../packages/feature-video/src/studio-source-speech-contract.ts)、[studio-source-speech.ts](../packages/feature-video/src/studio-source-speech.ts) | studio.source-caption-rebind、studio.next |
| 原淡入淡出／缓动区间连续性 | [studio-layer-edits.ts](../packages/feature-video/src/studio-layer-edits.ts)、[media-native/composition-layers.ts](../packages/media-native/src/composition-layers.ts) | studio.layer-fade-continuity、media.production |
| 主旁白／原声静音与配乐避让 | [studio-main-edits.ts](../packages/feature-video/src/studio-main-edits.ts)、[media-native/composition-audio.ts](../packages/media-native/src/media/composition-audio.ts) | studio.main-mute |
| 有限亮度／对比度／饱和度／模糊 | [media-native/visual-effects.ts](../packages/media-native/src/visual-effects.ts)、[shared painters](../packages/media-native/src/media/composition-paint.ts) | studio.visual-effects |
| 图层／音轨锁定、隐藏、静音及对象菜单 | [renderer/studio-layer-editor.ts](../packages/feature-video/src/renderer/studio-layer-editor.ts) | studio.track-menu |
| 参考帧抽样、SHA 核对、背景采用及记录管理 | [studio-reference.ts](../packages/feature-video/src/studio-reference.ts)、[renderer/studio-reference-editor.ts](../packages/feature-video/src/renderer/studio-reference-editor.ts) | studio.reference-analysis、video.studio |
| 可选逐项文本／字幕样式／显示模式审阅 | [studio-review.ts](../packages/feature-video/src/studio-review.ts)、[studio-service.ts](../packages/feature-video/src/studio-service.ts) | studio.review-adoption、video.studio |
| 签名历史恢复、选择性配音、制作取消与明确续做 | [studio-snapshot-proof.ts](../packages/feature-video/src/studio-snapshot-proof.ts)、[studio-service.ts](../packages/feature-video/src/studio-service.ts)、[studio.ts](../packages/feature-video/src/renderer/studio.ts) | studio.approved-history、studio.production-recovery |
| 局部字幕／卡片／句关联命令与有界模型读取 | [video-edit.ts](../packages/feature-video/src/video-edit.ts)、[studio-agent-result.ts](../packages/feature-video/src/studio-agent-result.ts)、[studio-read-contract.ts](../packages/feature-video/src/studio-read-contract.ts) | video.schema、video.studio、sources |
| 完整字幕底框、共享安全布局与实际像素遮挡观察 | [composition-text.ts](../packages/media-native/src/media/composition-text.ts)、[composition-quality.ts](../packages/media-native/src/composition-quality.ts) | media.production、video |
| 当前成片指纹绑定的审片覆盖与分作者意见 | [export-review-journal.ts](../packages/feature-video/src/export-review-journal.ts)、[studio-export-review-state.ts](../packages/feature-video/src/studio-export-review-state.ts) | video.studio、studio.export-review |
| 官方事件／实际保存进度与显式恢复输入准备 | [assistant-activity.ts](../packages/platform/src/assistant-activity.ts)、[studio-production-progress.ts](../packages/feature-video/src/studio-production-progress.ts)、[studio-runtime.ts](../packages/feature-video/src/studio-runtime.ts) | platform.assistant-controller、studio.production-recovery |
| 2.5 时间方法记录、实际音频核对与只读句级节奏诊断 | [studio-speech.ts](../packages/feature-video/src/studio-speech.ts)、[studio-timing.ts](../packages/feature-video/src/studio-timing.ts)、[studio-timing-diagnostics.ts](../packages/feature-video/src/studio-timing-diagnostics.ts) | video.schema、video.studio、studio.export-review |
| 工作区恢复和素材读取 | [studio-runtime.ts](../packages/feature-video/src/studio-runtime.ts)、[studio.ts](../packages/feature-video/src/renderer/studio.ts) | studio.workspace-resume |
| Studio 操作／source 子操作的闭合帮助与参数错误恢复 | [studio-discovery.ts](../packages/feature-video/src/studio-discovery.ts)、[studio-tool-guide.ts](../packages/feature-video/src/studio-tool-guide.ts) | video.studio、browser.schema、browser.catalog |
| 播放器采集、结束范围、逐帧源时间到成品 PTS 与尺寸适配 | [video-element-capture.ts](../packages/media-native/src/video-element-capture.ts)、[capture-timeline.ts](../packages/media-native/src/capture-timeline.ts)、[capture-source-index.ts](../packages/media-native/src/capture-source-index.ts)、[capture-mux.ts](../packages/media-native/src/capture-mux.ts) | media.video-capture、media.capture-source-index、media.processing-runtime |
| HTTP／有限 HLS VOD 原始分发资源保全与编码包复制证明 | [media-preservation.ts](../packages/media-native/src/media-preservation.ts)、[media-controller.ts](../packages/media-native/src/media-controller.ts) | media.preservation、media.processing-runtime |
| 正式全片分析任务与独立覆盖账本 | [source-analysis-contract.ts](../packages/feature-video/src/source-analysis-contract.ts)、[source-analysis-service.ts](../packages/feature-video/src/source-analysis-service.ts) | video.source-analysis、media.source-analysis-case |
| 720秒／96分镜与4秒有界混音 | [composition-limits.ts](../packages/media-native/src/composition-limits.ts)、[composition-audio.ts](../packages/media-native/src/media/composition-audio.ts) | studio.long-film、media.audio-windows、media.long-composition-case |
| 文字时序／包装／源裁切 | [layer-text-treatment.ts](../packages/media-native/src/layer-text-treatment.ts)、[layer-packaging.ts](../packages/media-native/src/layer-packaging.ts) | media.text-treatment、media.layer-packaging、studio.text-treatment、studio.layer-packaging |
| 有限数据图解与状态同源 | [science-spec.ts](../packages/media-native/src/science-spec.ts)、[science-paint.ts](../packages/media-native/src/media/science-paint.ts) | media.science-spec、media.science-diagrams、studio.science |
| 区间音频技术证据与不自动播放的试听 | [audio-evidence.ts](../packages/media-native/src/media/audio-evidence.ts)、[audio-evidence-contract.ts](../packages/media-native/src/audio-evidence-contract.ts) | media.processing-runtime |

表中代码入口链接到实际作者源码。同一 smoke 文件的专用环境分支并不由默认 test:studio-e2e 全部触发，完整 offline runner 按目录逐项执行；配置见架构生成表。

手机成片审片、素材索引、配方与录屏 GUI 验收共用 studio.export-review；区间 ASR 与原时间检索由 speech/media 与 video.material-index 覆盖；声音切换、放大镜和录屏压缩由 video 原生导出覆盖。具体预算和失败行为维护在功能规格。

## 当前边界

有限多轨、显式关键帧和基础特效已经实现，不再列为待开发。更多复杂效果、任意动画曲线、任意复杂引用重绑定与通用 NLE 尚未实现，也不在当前能力范围。

审阅默认折叠、单列为测试功能，用户逐条采纳／忽略／撤销。参考分析仅依据实际采样 PNG；它们不保证完整视频语义、事实正确性或建议质量。原声 ASR 完整音轨最多 180 秒；最多 1800 秒源文件可按至多 180 秒区间进行 Project 索引。自动词／字准确率未批准。分阶段确认是给官方 Agent 的任务说明，遵从质量需要真实使用验收。

## 后续议题

未完成项统一见 [下一步设计](plans/NEXT_STEPS.md)，创作细节见 [内容计划](plans/CONTENT_CREATION.md)，观察依据见 [研究](research/CONTENT_CREATION.md)。本页只维护已实现能力映射，不复制全局待办。早期方案与阶段验收见 [历史索引](history/README.md)。
