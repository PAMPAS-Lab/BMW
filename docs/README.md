# BMW 文档导航

当前实现以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准；研究和规划不得覆盖运行时契约。

## 阅读入口与权威关系

| 要解决的问题 | 入口 | 维护规则 |
|---|---|---|
| 安装和使用 | [仓库 README](../README.md) | 产品介绍、运行方法；不积累阶段日志 |
| 核心提示词、信源预设与实战经验 | [prompts-and-presets/README.md](prompts-and-presets/README.md) | 生产提示词索引、自定义模板备份、历史案例提示词与踩坑经验 |
| 配置 Qwen、保存凭据和试听 | [使用步骤](../README.md#qwen-配置与试听)、[功能契约](FUNCTIONAL_SPEC.md#qwen-tts-配置安全保存与试听)、[验证范围](VERIFICATION.md#qwen-tts-验证范围) | 区分设置、原生配音与付费服务验收；凭据不提供给模型 |
| 开发约束 | [AGENTS.md](../AGENTS.md)、[应用约束](../apps/bmw/AGENTS.md)、[agent.md](../agent.md) | AGENTS 是编码指导；agent 是短入口 |
| 现在有什么、还缺什么 | [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前摘要、证据限制与计划入口 |
| 接手当前工作 | [handoff.md](../handoff.md) | 当前交接、关键约束、下一步入口 |
| 已实现行为、权限和字段 | [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) | 唯一功能总规范；人工正文与生成目录分开 |
| 模块、公开接口和测试映射 | [ARCHITECTURE.md](ARCHITECTURE.md) | 从模块与测试目录生成，不手改生成表 |
| 如何验证、证据覆盖到哪里 | [VERIFICATION.md](VERIFICATION.md) | 当前检查结果与覆盖边界 |
| 当前源码的逐项离线回归 | [可移植验证摘要](verification/CURRENT.json) | 完整范围、逐项结果、未运行项及源码 SHA |
| AI 新闻固定来源与滚动素材流 | [设计](plans/LIBRARY_STREAMS.md)、[真实来源验证](research/AI_NEWS_REAL_SOURCES.md)、[批量采集设计](plans/COLLECTION_BATCH_OPTIMIZATION.md)、[批量验证](research/COLLECTION_BATCH_VALIDATION.md) | 可选固定订阅、X/YouTube 观察类型、近 72 小时原文/事件/快照 |
| 日常新闻速递手册 | [NEWS_DAILY.md](NEWS_DAILY.md) | 选题确认、原声核验、局部改稿及收工恢复 |

## 当前专题规范

| 文档 | 定位 |
|---|---|
| [AGENT_DRIVER_DESIGN.md](AGENT_DRIVER_DESIGN.md) | 已采纳的四官方驱动架构 |
| [QODER_BMW.md](QODER_BMW.md) | Qoder 专用适配说明；包内 `qoder-bmw/SKILL.md` 是随实现发布的指导 |
| [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md) | 显式迁移操作说明；正常启动不做历史迁移 |
| [VIDEO_DOCUMENT_V2.md](VIDEO_DOCUMENT_V2.md) | 2.0–2.10 文档、时间权威、类型工作表、权限、预算与迁移 |
| [AGENT_VIDEO_EDITING.md](AGENT_VIDEO_EDITING.md) | 唯一 `browser` 下的发现、分页和类型编辑调用 |
| [VIDEO_STUDIO_SCOPE.md](VIDEO_STUDIO_SCOPE.md) | 已实现能力与测试 ID 的专题映射 |
| [schemas/](schemas/) | 生成 Schema 与示例；由运行时代码生成 |
| [MIGRATION_PROVENANCE.json](MIGRATION_PROVENANCE.json) | 仓库迁移来源记录 |
