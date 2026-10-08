# Video Studio 当前范围与暂停的后续优化

核对日期：2026-10-08。功能字段与拒绝规则以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准，测试分支以 [ARCHITECTURE.md](ARCHITECTURE.md) 生成表为准。

用户已确认卡片与高级多轨两个方向基本成立，但要求暂不继续 UI／工作流优化。已获授权实施共享视频 schema，UI 只增加兼容性提示与模式返回约束；其他 UI／工作流优化仍暂停。专用 AI 图片／视频素材生成暂缓；素材使用真实 Project 文件、网页采集、截屏与录屏。

## 已实现与对应保障

| 能力 | 代码入口 | 分类测试 ID |
|---|---|---|
| Video Document 2.0、无损迁移、简洁可逆子集与类型命令 | [video-document.ts](../packages/feature-video/src/video-document.ts)、[video-edit.ts](../packages/feature-video/src/video-edit.ts)、[studio-compatibility.ts](../packages/feature-video/src/studio-compatibility.ts) | video.schema、studio.schema |
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
| 工作区恢复和素材读取 | [studio-runtime.ts](../packages/feature-video/src/studio-runtime.ts)、[studio.ts](../packages/feature-video/src/renderer/studio.ts) | studio.workspace-resume |

表中代码入口链接到实际作者源码。同一 smoke 文件的专用环境分支并不由默认 test:studio-e2e 全部触发，完整 offline runner 按目录逐项执行；配置见架构生成表。

## 当前边界

有限多轨、显式关键帧和基础特效已经实现，不再列为待开发。更多复杂效果、任意动画曲线、任意复杂引用重绑定与通用 NLE 尚未实现，也不在此次一致性修正中扩展。

审阅默认折叠、单列为测试功能，用户逐条采纳／忽略／撤销。参考分析仅依据实际采样 PNG；它们不保证完整视频语义、事实正确性或建议质量。原声 ASR 完整音轨最多 180 秒，没有长视频分块与自动词／字准确率认可。分阶段确认是给官方 Agent 的任务说明，遵从质量需要真实使用验收。

## 暂停的优化议题

后续如用户恢复优化，可再讨论卡片信息密度、画布与多轨布局、复杂任务与手动动作区分、快捷操作及完整真实制作体验。保持两种模式与默认简洁入口。当前 schema 的模式返回约束见 [Video Document 2.0](VIDEO_DOCUMENT_V2.md)；后续 UI 优化应遵守同一时间权威、简洁可逆子集及当前原生能力边界。

此前回退决策、旧 A/B 方案、逐阶段待办和原测试结果见 [历史快照](history/2026-10-07-consistency/index.md)。当时尚未实现的判断已从当前范围移除；历史证据保留原文，并按原源码日期解释。
