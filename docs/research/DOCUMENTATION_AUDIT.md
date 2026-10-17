# 文档组织与代码一致性审计

日期：2026-10-17。首次文档整理对象为当时BMW未提交工作树；不是仅核查 Git HEAD，也不是外部产品调研。本轮盘点根目录、docs 全部 Markdown、历史入口、Schema／证据附件和包内指导，重点对照类型契约、能力发现、生成器、测试目录及已有本机报告。未重新执行外部项目、付费模型或用户 Profile 操作。

后续三方对齐与完整回归见[验收归档](../history/2026-10-17-alignment/README.md)：修复音频首次中段／重叠读取、统一2.9版本发现、升级96镜头与来源GUI夹具；下文保留首次整理的发现和范围，不能把其“只改文档”套用到后续提交。

## 补充发现：AK 研究漏收

首次整理遗漏了被 Git 忽略的 `.bmw-runtime/akhaliq-analysis`：其中已有十条 AK 的 X 帖子视频研究，但根导航、research 和计划均未引用。现补入 [逐条研究与证据摘要](AK_X_VIDEOS.md)及[独立增量设计](../plans/AK_VIDEO_CAPABILITIES.md)，总计划登记 AK-01–05。已核对十个 MP4、1267 张抽帧 SHA、69 张联系表存在性与原账本；本次未重新看视频或核听。此修订只补文档，不改已归档的完整测试报告；新增能力仍未实现。

后续盘点应同时检查本机研究报告和交付页，按研究主题登记正文、来源、验证程度与计划去向；不能只扫描已入 Git 的 Markdown 就称研究覆盖完整。原始媒体留在本机，核心结论和最小证据摘要纳入版本控制。

## 原有组织与问题

原结构以 docs 根目录平铺为主：功能规格、架构、当前状态、验证方法、已完成实施记录和 NEXT／PLAN 命名的方案并列。根 README、agent、handoff 与 PROJECT_STATUS 重复介绍实现与阶段结果；VERIFICATION 混合现行命令、多个版本的通过／失败日志及真实模型案例。

已有 `history/2026-10-07-consistency` 是合理的冻结快照，但后来的驱动、卡片和量子位阶段没有继续按同样原则归档。`design/weibo-reference-*` 同时保存原始观察、五版方案、已完成结果和图片／脚本，容易把旧缺口当成下一步需求。CONTENT_CREATION_NEXT 则混合外部研究、当前能力判断及八项规划。

| 原文档组 | 本轮处理 | 保留理由 |
|---|---|---|
| README、AGENTS、apps/bmw/AGENTS、agent、handoff | 安装／开发规则保留，agent／handoff 收敛为接手入口 | 开发指令不随研究归档；前序代码与用户数据保护不变 |
| FUNCTIONAL_SPEC、ARCHITECTURE | 保留稳定权威路径；修正当前版本与命令说明，把散落文末的能力正文移到生成清单前 | 生成器引用固定路径；不为整洁拆散校验机制 |
| PROJECT_STATUS、VERIFICATION | 保留当前摘要与证据范围；历史详细验证移至快照 | 状态不再维护第二份完整待办／历史日志 |
| AGENT_DRIVER_DESIGN、QODER_BMW、AGENT_DATA_MIGRATION | 保留现行架构和操作说明，历史实施／迁移事实单列 | 已采纳架构仍是当前设计，不因实现完成整篇废弃 |
| AGENT_DRIVERS_IMPLEMENTATION | 移入 history/agent-drivers | 已完成封装／集成，结果受当时版本限制 |
| VIDEO_DOCUMENT_V2、AGENT_VIDEO_EDITING | 保留当前专题规范并对照代码修正 | 文档／命令说明须与发布 Schema 和运行时相符 |
| VIDEO_STUDIO_NEXT | 正文改名 VIDEO_STUDIO_SCOPE | 内容主要是现有能力与测试映射，NEXT 名称误导 |
| VIDEO_STUDIO_REVIEW、VIDEO_STUDIO_P0_IMPLEMENTATION | 保留原有历史跳转 | 原评审和 P0 不恢复为新待办 |
| CONTENT_CREATION_NEXT | 研究移入 research，增量设计移入 plans | 研究依据与实施范围独立；原计划细节保留并校正 |
| QBIT_DEVELOPMENT_PLAN | 移入 history/qbit，保留四阶段及10月17日修订 | 阶段实现已完成，质量缺口转入总计划 |
| DENSE_RESEARCH | 移入 research/WEIBO_REFERENCE | 观察、来源哈希和抽样限制属于研究 |
| DESIGN、SIMPLE_CARDS_DESIGN、TEMPLATE_SYSTEM_DESIGN、REVIEW_DESIGN、DENSE_DESIGN | 移入 history/weibo-templates，标记已替代／部分采纳／已完成核心 | 保留方案演变；不把全部旧提议统称已实现 |
| design 中 JSON／HTML／TS 与本机图像 | 保持路径，增加附件说明 | 不移动测试研究脚本、原始媒体或修改证据内容 |
| schemas 与 MIGRATION_PROVENANCE | 保持原位和内容 | 机器发布物和迁移来源不属于计划 |
| history/2026-10-07-consistency 全组 | 原文保持 | 相对链接按当时位置解释，历史失败与限制不修饰 |

新结构与维护规则见 [文档导航](../README.md)。旧正文路径保留轻量跳转，活动链接指向新正文；专题当前规范仍在 docs 根目录，研究／规划／历史物理分目录，避免全仓迁移制造路径噪声。

## 已确认的漂移与修正

| 问题 | 当前源码或证据 | 处理结果 |
|---|---|---|
| README／视频文档／总规范仍写2.0–2.5 | [video-document.ts](../../packages/feature-video/src/video-document.ts)支持2.0–2.9，按实际字段择最低版本并拒绝旧版本承载新字段 | 改为2.0–2.9，补2.6/2.7/2.8/2.9分别对应能力 |
| 视频文档称产品仍限24镜／180秒 | [composition-limits.ts](../../packages/media-native/src/composition-limits.ts)：720秒、96镜、每镜60秒、64独立对象、256 MiB素材、4秒音频窗口 | 更正现行上限；旧2.0–2.5和单段旁白／ASR预算保留；计划的小样片限制标为试验范围 |
| Agent接口遗漏准备、加镜、字幕和卡片命令 | [video-edit-contract.ts](../../packages/feature-video/src/video-edit-contract.ts)：brief.set、scene.add、captions.set、card.set/bind及新增图层字段／类型 | 补命令与闭合字段，修正scene.set、diagram/card-stack等说明 |
| 模型读取说明误导为整份文档／Schema | [studio-agent-result.ts](../../packages/feature-video/src/studio-agent-result.ts)、[studio-discovery.ts](../../packages/feature-video/src/studio-discovery.ts)：摘要和按操作／镜头分页发现 | 区分宿主完整响应与模型摘要，强调describe-edit/read-scene |
| 简洁文档仍只称simple.cards/1 | [studio-compatibility.ts](../../packages/feature-video/src/studio-compatibility.ts)已发布simple.cards/3 | 更正版本并保留旧内容兼容与高级对象拒绝 |
| 内容计划把同源数据图解视为全部缺失 | [science-spec.ts](../../packages/media-native/src/science-spec.ts)、[science-paint.ts](../../packages/media-native/src/media/science-paint.ts)已含有限四类／七种表现、scienceState | CONTENT-08缩窄到新的可信因果模型／交互，不重建现有图解 |
| source.acquire段落保留旧MediaRecorder视频描述 | [studio-sources.ts](../../packages/feature-video/src/studio-sources.ts)经browser-kernel.captureSource复用media.video.capture的采集路径；[video-element-capture.ts](../../packages/media-native/src/video-element-capture.ts)与capture-mux分离视频编码和音频录制 | 改为引用总规范已描述的WebCodecs视频／MediaRecorder音频／有界封装路径 |
| 状态页与handoff继续称410文件完全一致 | 重新计算2026-10-15报告sourceHashes：410个记录中55个不同 | 降为历史完整基线；不涵盖新增文件，提出VERIFY-01 |
| 量子位全为40秒／竖屏的状态落后于修订 | 2026-10-17 review-evidence：PIP时间线34.666667秒、1280×720；文件34.730667秒 | 当前摘要更新，10月16日原版记录留在归档 |
| 已完成阶段与未来事项混列 | 驱动／卡片／量子位记录，用户质量反馈与未核听字段 | 归档对应完成范围；音频、时基、叙事和S04限制仍可见 |

## 能力核对矩阵

“代码存在”与“本轮执行通过”分开。测试ID来自 [test-catalog.ts](../../scripts/test-catalog.ts)；运行结果见 [VERIFICATION](../VERIFICATION.md)，这里不将每个列出的原生测试都宣称本轮运行。

| 能力／约束 | 核对入口 | 现有保障与结论 |
|---|---|---|
| 唯一应用、三官方循环 | apps/bmw/agent-assembly.ts、agent-contract、platform/agent-host.ts、各harness的准入策略 | driver、platform.driver-binding、browser.catalog等；边界保持，不引入Host模型循环 |
| 共享文档与编辑 | video-document.ts、video-edit-contract.ts、video-edit.ts、studio-compatibility.ts | video.schema、video.studio、studio.schema；当前规范可与Schema生成检查交叉核验 |
| 全片分析 | source-analysis-contract/service/store、renderer/source-analysis-panel | video.source-analysis及Studio／media.source-analysis-case；8图分页、独立revision、2fps/8fps、提取≠审阅 |
| 长篇与有界音频 | composition-limits、media/composition-audio、renderer/studio-preview | studio.long-film、media.audio-windows、media.long-composition-case；不声称高规格长片性能已验收 |
| 文字／包装／源裁切 | layer-text-treatment、layer-packaging、composition-layers、studio-layer-edits | media.text-treatment、media.layer-packaging和对应Studio分支；已实现，非未来需求 |
| 科学图解 | science-spec、science-paint、renderer/science-layer-editor | media.science-spec、media.science-diagrams、studio.science；有限数据模型不等于科学仿真 |
| 采集／资源保全 | capture-timeline、capture-source-index、media-preservation | media.video-capture、media.capture-source-index、media.preservation；原始分发不等于作者母版 |
| 音频技术证据 | audio-evidence-contract、media/audio-evidence | media.processing-runtime；WAV／指标存在，直接模型核听仍未完成 |
| 增量制作与语义 | studio-service/store、studio-speech-contract、studio-card-speech、studio-timing-diagnostics | 现有旁白失效／复用／句引用已具备；统一只读影响计划与解释阶段属于增量 |
| 文章／指导／自由批注 | 对照browser／Studio目录、现有Project文档、字段提案和审片日志 | 未找到规划所需的完整原生闭环；不能把notes、固定驱动指导或开发侧HTML算作完成 |

## 证据与保护方法

整理前将当前Markdown原文与作者文件SHA保存到本机临时审计目录，按实际工作树迁移正文并重定位Markdown链接。旧历史快照不改写；本机媒体报告只读。结束时重新比较非Markdown作者文件，确认没有把前序实现覆盖成HEAD或更改源码／测试／Schema。新旧链接检查分别报告活动文档、历史本机证据和缺失附件，不静默把缺失证据记为通过。

本轮build/check通过，unit/contract/boundary共89个分类项通过，独立边界复查9项通过；没有失败，不把范围外未执行项算通过。非Markdown作者文件与整理前SHA一致。活动及本轮迁移文档的仓库正文链接和21处章节锚点通过；只有归档中两条2026-10-05-login-flow本机日志链接缺失，已明确标注，未重造或删除历史证据。结果与报告入口见 [验证说明](../VERIFICATION.md)。

下一步设计的验收门是“当前完整源码基线＋具体题材内容质量＋可解释局部修改”，详见 [NEXT_STEPS](../plans/NEXT_STEPS.md)；不通过扩大模板数量、重做已实现功能或继续堆叠历史日志替代这些缺口。
