# BMW current handoff

BMW 当前提供浏览器、素材库、Video Studio 三个并列工作区。一个 Project 管理网页、素材、视频草稿、文档和记忆；多个会话共享这些资源。模型始终只有一个 `browser` 工具。

## 核心工作流与当前状态

1. **素材库与滚动资讯流（`@bmw-agent/feature-library`）**
   - 自动聚合各 Project 的已保存来源和媒体，支持全库检索、日期/状态筛选、收藏、标签、批量整理、历史新闻批次和跨 Project 完整证据复制。
   - 提供 24 项可选 AI 新闻固定来源预设（`AI_NEWS_SOURCE_PRESETS`）、有界手动巡检、增量批量采集（2–3 路隐藏页面读取、串行来源 CAS、URL 检查点）、线索与事件修订、严格十题事件推荐快照及明确绑定的周期采集，详见[分阶段设计](docs/plans/LIBRARY_STREAMS.md)与[批量采集方案](docs/plans/COLLECTION_BATCH_OPTIMIZATION.md)。
   - 新闻收集与选题位于素材库，可信用户选择后建立所属 Session 的唯一草稿并单次投递进入原生 Studio。

2. **原生视频工坊（`@bmw-agent/feature-video` & `@bmw-agent/media-native`）**
   - 共享 Video Document 2.0–2.10、CAS 修订并发控制、实测旁白音频溯源与独立导出审阅（`video.review`）。
   - 支持新闻速递（`news-brief`）、综合科普（`science-explainer`）、学术解读（`research-explainer`）三类版本化制作指导、分段工作表与 6 套视觉配方。
   - 旁白支持 Edge ReadAloud、Qwen TTS 和本地 Matcha；语音证据支持固定 `whisper.cpp` base/small 锚点对齐与句级字幕绑定。

3. **核心提示词、信源预设与实战经验归档**
   - 所有生产级提示词索引、自定义竖屏/横屏视频模板备份、历史案例编导提示词与本地项目实战经验已统一归档至 [docs/prompts-and-presets/README.md](docs/prompts-and-presets/README.md)。

## 代码入口与边界

| 范围 | 入口与约束 |
|---|---|
| 官方循环与唯一 `browser` | `apps/bmw/product.ts`、`agent-contract` 及各 harness；核心不导入具体 provider 协议、凭据或原生客户端存储 |
| 新闻选题与素材索引 | `feature-library/src/news-contract.ts`、`news-store.ts`、`material-index-contract.ts`、`material-index-store.ts` 及 `feature-video/src/news-service.ts`、`renderer/studio-news.ts` |
| 来源与真实预览 | `browser-capability/src/collect-page-source.ts`、`source-screenshot.ts`、`page-navigation.ts` 及 `platform/src/project-source-store.ts` |
| 草稿与局部编辑 | `feature-video/src/studio-service.ts`、`studio-store.ts` 及 `studio-runtime.ts`；CAS、FIFO、GUI 冲突、既有影响计划 |
| Qwen 配置与试听 | `platform` 凭据存储和受信 Shell，`media-native` 旁白契约与原生处理；七种 Qwen 音色闭合校验，密钥不回传模型或日志 |
| 媒体与审阅 | `media-native` 负责解码、处理、旁白和导出；来源分析、Agent 画面审阅、人工核听与最终接受分别记录 |

## 验证与下一步

- 全局优先级与待办维护在 [下一步计划](docs/plans/NEXT_STEPS.md)，功能总规范见 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)，模块与接口保障见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)，验证方法见 [VERIFICATION.md](docs/VERIFICATION.md)。
- 运行时或测试改动后请串行执行 `npm run build`、`npm run docs:features`、`npm run docs:architecture` 与 `npm run check`。
