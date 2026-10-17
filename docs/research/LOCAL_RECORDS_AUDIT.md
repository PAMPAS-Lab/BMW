# 本机研究与交付记录补收审计

核对日期：2026-10-17，代码基准 410e9cd25dc719462cad5a11b19ce4be110c2f23。本轮只改文档与证据索引；研究、交付、当前实现和未完成计划分开。

## 范围与方法

盘点 .bmw-runtime 的 60 个目录族、根目录交付记录，相关本机 HTML 研究页、/tmp/bmw-download-research，以及 BMW Project 的 18 份 MEMORY 和 39 份规范化 Studio 文档元数据。Project 数据只读，没有使用生产 Profile 跑测试。记录标题／版本与结论优先；媒体不复制、不重新执行历史脚本、不把重复测试运行算成新研究。不是对整个硬盘、所有用户目录或已删除文件的穷尽检索。

[机器清单](LOCAL_RECORDS_INVENTORY.json)保存目录分类、数量及选定原记录 SHA；[量子位可移植证据](QBIT_VIDEOS_EVIDENCE.json)保存逐条观察和抽样账本。原始媒体、浏览器状态、完整 Agent 历史、签名 CDN URL 不上传。路径用于定位，原本机数据不存在时仍可阅读仓库结论；哈希证明文件身份，不证明观察正确。

## 补收结果与处置

| 材料 | 原缺口 | 新归属与当前结论 |
|---|---|---|
| AK 十条视频 | 此前已补收 | [AK 研究](AK_X_VIDEOS.md)与 AK-01–05 保留 |
| 量子位十二候选／十一条全片研究 | 主要保留四阶段技术完成记录，原逐段视觉观察入口不足 | [完整研究](QBIT_VIDEOS.md)；研究抽样和自动测试账本分开 |
| 来源头下载实验 | 本机 HTML 保留旧“未集成”正文，缺当前结论 | 量子位研究注明已修复；只有队列／刷新／条件恢复进入 MEDIA-04 |
| Musk 九项 gap report | 未逐项和当前实现复核 | [创作案例](PRODUCTION_CASES.md)；已实现项关闭，工程交付和来源关系保留 |
| 三份博客视频交付 | 早期模板档案只有弱入口，后两份分散在 Project 记忆 | [交付账本](../history/local-deliveries/README.md)，分别登记草稿、导出和限制 |
| Karpathy 四格式研究及多驱动／Sol 迭代 | 最终可靠性归档掩盖早期研究及中间部分改善 | 创作案例＋交付账本；不同条件不作为模型排名 |
| Pelican 来源与提示词链 | 技术完成记录较全，来源归因和更正不集中 | [Pelican 研究](PELICAN_COMPARISON.md)，保留未知及后加更正 |
| Three.js、旧实验／静态页／产品演示 | Project 记忆中存在失败与未完成材料 | [早期归档](../history/local-deliveries/LEGACY_PROJECTS.md)，不恢复旧接口或声称交付完成 |
| Simon、模板、Qbit 实现、驱动迁移 | 已有研究或历史入口 | 保留既有归档，增补导航，不重复创建待办 |
| native／Studio／desktop／classified 运行 | 大量重复机器证据 | 按测试目录族归类；过往失败与后来通过保留各自版本范围 |
| 本地 ASR/TTS、编译快照与 Codex runtime | 缓存与依赖 | 计数但不算独立调研 |

## 全部 runtime 目录族

| 目录 | 分类 | 文件／记录数 |
|---|---|---:|
| `.bmw-runtime/akhaliq-analysis` | research-and-validation | 1373 / 15 |
| `.bmw-runtime/analysis-unit-build` | generated-cache | 401 / 11 |
| `.bmw-runtime/assistant-display-fix` | validation-and-fixtures | 1 / 0 |
| `.bmw-runtime/bmw-contract-fixes` | validation-and-fixtures | 130 / 8 |
| `.bmw-runtime/bmw-video-fixes` | validation-and-fixtures | 332 / 30 |
| `.bmw-runtime/card-blog-sample` | delivery-and-iteration | 346 / 56 |
| `.bmw-runtime/card-speech-export-review` | validation-and-fixtures | 6 / 1 |
| `.bmw-runtime/card-template-validation` | validation-and-fixtures | 86 / 23 |
| `.bmw-runtime/classified-tests` | validation-and-fixtures | 17247 / 2152 |
| `.bmw-runtime/codex-comparison` | delivery-and-iteration | 8 / 6 |
| `.bmw-runtime/codex-runtime` | generated-cache | 49 / 1 |
| `.bmw-runtime/context-reading` | delivery-and-iteration | 15 / 2 |
| `.bmw-runtime/context-sol` | delivery-and-iteration | 91 / 9 |
| `.bmw-runtime/cover-validation` | validation-and-fixtures | 2 / 0 |
| `.bmw-runtime/dense-card-validation` | validation-and-fixtures | 65 / 2 |
| `.bmw-runtime/desktop-projects` | validation-and-fixtures | 1 / 1 |
| `.bmw-runtime/desktop-suite` | validation-and-fixtures | 150 / 40 |
| `.bmw-runtime/dsh-comparison` | delivery-and-iteration | 6 / 6 |
| `.bmw-runtime/image-drawing-validation` | validation-and-fixtures | 2 / 0 |
| `.bmw-runtime/layer-packaging` | validation-and-fixtures | 121 / 20 |
| `.bmw-runtime/local-asr` | generated-cache | 4 / 2 |
| `.bmw-runtime/local-tts` | generated-cache | 6 / 1 |
| `.bmw-runtime/long-composition` | validation-and-fixtures | 225 / 24 |
| `.bmw-runtime/media-preservation-validation` | validation-and-fixtures | 1 / 1 |
| `.bmw-runtime/musk-daily-production` | delivery-and-iteration | 246 / 76 |
| `.bmw-runtime/p0-sources` | validation-and-fixtures | 113 / 68 |
| `.bmw-runtime/p0-speech` | validation-and-fixtures | 422 / 320 |
| `.bmw-runtime/pelican-comparison` | research-and-validation | 98 / 39 |
| `.bmw-runtime/pelican-followup` | research-and-validation | 40 / 13 |
| `.bmw-runtime/pelican-mapping` | research-and-validation | 52 / 9 |
| `.bmw-runtime/pelican-p0` | research-and-validation | 54 / 6 |
| `.bmw-runtime/pelican-p1` | research-and-validation | 151 / 42 |
| `.bmw-runtime/pelican-study` | research-and-validation | 63 / 3 |
| `.bmw-runtime/phone-improvements` | delivery-and-iteration | 119 / 13 |
| `.bmw-runtime/phone-reading-sequence` | delivery-and-iteration | 394 / 1 |
| `.bmw-runtime/production-reliability` | delivery-and-iteration | 4000 / 406 |
| `.bmw-runtime/qbit-final-report` | research-and-validation | 13 / 4 |
| `.bmw-runtime/qbit-playback-review` | research-and-validation | 15 / 12 |
| `.bmw-runtime/qbit-stage3-samples` | research-and-validation | 774 / 60 |
| `.bmw-runtime/qbit-stage4-samples` | research-and-validation | 285 / 37 |
| `.bmw-runtime/qoder-contract-remake` | delivery-and-iteration | 9 / 8 |
| `.bmw-runtime/qoder-reading` | delivery-and-iteration | 78 / 10 |
| `.bmw-runtime/qoder-remake` | delivery-and-iteration | 7 / 6 |
| `.bmw-runtime/recording-workflow` | validation-and-fixtures | 44 / 14 |
| `.bmw-runtime/rhythm-sol` | delivery-and-iteration | 42 / 7 |
| `.bmw-runtime/science-diagrams` | validation-and-fixtures | 140 / 15 |
| `.bmw-runtime/simon-pelicans` | research-and-validation | 749 / 87 |
| `.bmw-runtime/simon-pelicans-v2` | research-and-validation | 336 / 12 |
| `.bmw-runtime/sol-remake` | delivery-and-iteration | 108 / 9 |
| `.bmw-runtime/source-analysis` | research-and-validation | 4549 / 44 |
| `.bmw-runtime/studio-layer-packaging` | validation-and-fixtures | 2 / 1 |
| `.bmw-runtime/studio-long-debug` | validation-and-fixtures | 3 / 1 |
| `.bmw-runtime/studio-long-film` | validation-and-fixtures | 2 / 1 |
| `.bmw-runtime/studio-next` | validation-and-fixtures | 17 / 3 |
| `.bmw-runtime/studio-science` | validation-and-fixtures | 2 / 1 |
| `.bmw-runtime/studio-text-treatment` | validation-and-fixtures | 2 / 1 |
| `.bmw-runtime/studio-validation` | validation-and-fixtures | 77 / 17 |
| `.bmw-runtime/text-treatment` | validation-and-fixtures | 68 / 12 |
| `.bmw-runtime/video-capture-eof` | validation-and-fixtures | 2 / 1 |
| `.bmw-runtime/video-improvements` | validation-and-fixtures | 32 / 6 |

分类是导航，不代表每个目录内所有二进制或日志均重新审阅。selected records 的指纹在清单中；详细判断以专题文档和原回执为准。

## 规划与三方对齐

新增设计只有 [DELIVERY-01／MEDIA-04](../plans/DELIVERY_AND_ACQUISITION.md)；SOURCE-01 增补具体反例，CONTENT 系列继续负责理解与内容质量。已有 720 秒／96 镜头、阅读、原声切旁白、科学组件和下载来源头能力不重新进入待开发清单。早期 Three.js 记录没有突破单 browser、原生媒体及官方 Agent 边界的依据。

本轮验证见 [VERIFICATION](../VERIFICATION.md)。旧 154 通过／11 未运行的完整隔离基线只在 430 份非 Markdown 源文件哈希一致时继续引用；本轮单元／契约／边界检查另记，不冒充付费模型、真实平台、生产数据或用户核听覆盖。已知两份旧驱动日志缺失保持原标注，不补造文件。
