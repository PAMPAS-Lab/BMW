# BMW 文档导航

核对日期：2026-10-17。按“现在是什么、研究了什么、下一步做什么、过去完成什么”组织。当前实现以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准；研究和规划不得覆盖运行时契约，历史通过仅适用于报告中的源码版本。

## 阅读入口与权威关系

| 要解决的问题 | 入口 | 维护规则 |
|---|---|---|
| 安装和使用 | [仓库 README](../README.md) | 产品介绍、运行方法；不积累阶段日志 |
| 配置 Qwen、保存凭据和试听 | [使用步骤](../README.md#qwen-配置与试听)、[功能契约](FUNCTIONAL_SPEC.md#qwen-tts-配置安全保存与试听)、[验证范围](VERIFICATION.md#qwen-tts-验证范围) | 区分设置、原生配音与付费服务验收；凭据不提供给模型 |
| 开发约束 | [AGENTS.md](../AGENTS.md)、[应用约束](../apps/bmw/AGENTS.md)、[agent.md](../agent.md) | AGENTS 是编码指导；agent 是短入口 |
| 现在有什么、还缺什么 | [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前摘要、证据限制与计划入口 |
| 接手当前工作 | [handoff.md](../handoff.md) | 当前交接、关键约束、下一步入口 |
| 已实现行为、权限和字段 | [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) | 唯一功能总规范；人工正文与生成目录分开 |
| 模块、公开接口和测试映射 | [ARCHITECTURE.md](ARCHITECTURE.md) | 从模块与测试目录生成，不手改生成表 |
| 如何验证、证据覆盖到哪里 | [VERIFICATION.md](VERIFICATION.md) | 当前检查结果、历史基线索引和覆盖边界 |
| 当前源码的逐项离线回归 | [可移植验证摘要](verification/CURRENT.json) | 完整范围、逐项结果、未运行项及源码SHA；本机原始日志另存，不代表远程CI |
| DSH 最新候选版制作 SI 新闻 | [DSH SI交付](research/DSH_SI_DELIVERY.json) | 独立工程、57.664秒MP4、模型路由、男声复用及实际审阅范围 |
| DSH 科普与学术重制 | [两条完整主片交付](research/DSH_SCIENCE_RESEARCH_DELIVERY.json) | 量子位／AK形式参考、原声复用、实际MP4与审阅、原生压缩及验证范围 |

## 当前专题规范

| 文档 | 定位 |
|---|---|
| [AGENT_DRIVER_DESIGN.md](AGENT_DRIVER_DESIGN.md) | 已采纳的三官方驱动架构，仍是现行设计；不是未完成的多 Agent 开发计划 |
| [QODER_BMW.md](QODER_BMW.md) | Qoder 专用适配说明；包内 qoder-bmw/SKILL.md 是随实现发布的指导，不归入外部研究 |
| [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md) | 显式迁移操作说明；正常启动不做历史迁移 |
| [VIDEO_DOCUMENT_V2.md](VIDEO_DOCUMENT_V2.md) | 2.0–2.10 文档、时间权威、类型工作表、权限、预算与迁移 |
| [AGENT_VIDEO_EDITING.md](AGENT_VIDEO_EDITING.md) | 唯一 browser 下的发现、分页和类型编辑调用 |
| [VIDEO_STUDIO_SCOPE.md](VIDEO_STUDIO_SCOPE.md) | 已实现能力与测试 ID 的专题映射 |
| [schemas/](schemas/) | 两份生成 Schema 和三个示例；由运行时代码生成 |
| [MIGRATION_PROVENANCE.json](MIGRATION_PROVENANCE.json) | 仓库迁移来源记录，不是待办 |

## 研究、规划、历史

| 分类 | 内容 | 状态 |
|---|---|---|
| 研究 | [内容创作研究](research/CONTENT_CREATION.md) | Simon 案例与 Hypit／Anatomy 固定版本观察；未重验外部项目 |
| 研究 | [AK 的 X 帖子视频](research/AK_X_VIDEOS.md) | 十条固定样本、逐条画面观察、代码／测试映射与可移植证据；未核听、未完成逐条复刻 |
| 研究 | [微博参考片观察](research/WEIBO_REFERENCE.md) | 原始来源哈希、2fps 抽样和观察边界；不是当前能力清单 |
| 研究 | [文档与代码审计](research/DOCUMENTATION_AUDIT.md) | 本轮盘点、漂移、源码证据和组织决策 |
| 规划／实施状态 | [三类视频制作方案](plans/VIDEO_TYPES.md)与[文案模板](plans/VIDEO_TYPE_TEMPLATES.md) | 类型机制已实现，DSH三主片已制作；示例稿与实际成片分别登记，人工验收保持开放 |
| 规划 | [下一步设计](plans/NEXT_STEPS.md) | 全局优先级、依赖、最小交付与退出条件的唯一总表 |
| 规划／实施状态 | [内容创作增量](plans/CONTENT_CREATION.md) | 三类指导、改稿影响与句目标已实现；图文长篇、外部指导和自由批注等缺口另列 |
| 规划／实施状态 | [AK 视频能力增量](plans/AK_VIDEO_CAPABILITIES.md) | AK-01–05原生功能已实现；外部生成服务与人工内容验收单列 |
| 历史 | [归档索引](history/README.md) | 旧 P0、卡片设计、驱动验收、量子位已完成阶段及旧验证记录 |
| 证据附件 | [design/README.md](design/README.md) | 保留原抽样脚本／清单／联系表和样片记录的稳定路径 |

旧 `CONTENT_CREATION_NEXT`、`QBIT_DEVELOPMENT_PLAN`、`AGENT_DRIVERS_IMPLEMENTATION`、`VIDEO_STUDIO_NEXT` 和五份旧卡片设计路径只保留跳转；新增链接应直达正文。既有 P0／REVIEW 跳转保留。`docs/history/2026-10-07-consistency` 是冻结快照，相对路径按原位置解释，不批量修写。

## 文档生命周期

1. 调研只记录来源、观察方法、事实／推断、限制和可借鉴结论；建议转为计划时引用研究，不复制一遍证据。
2. 计划说明缺口、现有基础、代码落点、权限／数据变化、依赖和验收。状态使用待设计、待实施、部分实现、已完成、暂缓；“研究完成”不等于“功能完成”。
3. 实现进入功能规格、专题规范和生成清单；阶段报告归档，尚未解决的部分按稳定 ID 留在总计划，不能随整篇归档消失。
4. 验收分别记录技术、来源、视觉、音频、Agent 和用户结论。每次引用报告说明源码范围、环境、失败／未执行项；本机 `.bmw-runtime` 路径不等于可移植证据。
5. 修改文档时检查相对链接、版本和预算，运行仓库规定的检查。新增／移动／改名／删除测试才刷新 `docs:features`；生成内容不靠手工计数维护。

## 本机记录补收入口

- [完整补收审计与机器清单](research/LOCAL_RECORDS_AUDIT.md)：目录范围、漏收项、证据限制。
- [量子位十二候选视频](research/QBIT_VIDEOS.md)、[创作案例复核](research/PRODUCTION_CASES.md)、[Pelican 来源链](research/PELICAN_COMPARISON.md)。
- [本机交付及早期实验归档](history/local-deliveries/README.md)。
- [可编辑交付与有界获取设计](plans/DELIVERY_AND_ACQUISITION.md)：尚未实现的 DELIVERY-01／MEDIA-04。
