# 历史设计与阶段验收

归档表示已完成对应阶段、已被替代或保留为背景，不表示原计划的每一项都实现，也不表示所有质量问题已关闭。当前规范见 [功能说明书](../FUNCTIONAL_SPEC.md)，未完成事项见 [下一步设计](../plans/NEXT_STEPS.md)。

| 目录／记录 | 归档理由 | 继续保留的限制或去向 |
|---|---|---|
| [素材库与社媒整合前验证](2026-10-22-before-library-social-integration/README.md) | 保留此前173组完整验证及源码身份 | 当前源码、首轮失败与重新完整运行见当前验证摘要；历史不冒认新版覆盖 |
| [2026-10-17-alignment](2026-10-17-alignment/README.md) | 文档／代码／测试对齐、发现的缺陷修复和完整离线基线 | 154 passed／0 failed／11 not-run；可移植指纹摘要，不包含本机媒体与付费验收 |
| [2026-10-07-consistency](2026-10-07-consistency/index.md) | 已有 P0、一致性核查前原文与失败过程；保持原快照 | 自动句／词／字精度仍未批准；历史待办不自动恢复 |
| [agent-drivers/IMPLEMENTATION.md](agent-drivers/IMPLEMENTATION.md) | 三驱动及 GPT-6 封装、登录集成的阶段验收已完成 | 当前架构仍在 AGENT_DRIVER_DESIGN；旧临时目录和付费模型结果不代表新版验证 |
| [agent-drivers/MIGRATION.md](agent-drivers/MIGRATION.md) | 2026-10-05 已授权迁移执行记录 | 操作方法仍在当前迁移说明；本轮不访问生产 Profile |
| [WorkBuddy 初版设计](agent-drivers/WORKBUDDY_DRIVER.md)、[路线比较](agent-drivers/WORKBUDDY_DRIVER_COMPARISON.md) | 合并旧分支时保留的研究与初版实现记录 | 已由实际目录门禁、系统加密、进程组清理和输入回执加固替代；旧参数结构保证与未实现结论不是当前规范 |
| [weibo-templates/DESIGN.md](weibo-templates/DESIGN.md) | 最早依赖高级对象的资讯方案，已被卡片方案替代 | 参考来源与观察保留；不执行旧字段建议 |
| [SIMPLE_CARDS_DESIGN.md](weibo-templates/SIMPLE_CARDS_DESIGN.md) | 两类资讯卡的中间提案，已被八类体系替代 | 共享内容与简洁可逆约束仍有效 |
| [TEMPLATE_SYSTEM_DESIGN.md](weibo-templates/TEMPLATE_SYSTEM_DESIGN.md)、[REVIEW_DESIGN.md](weibo-templates/REVIEW_DESIGN.md) | 八类模板及分批设计；已实现部分不再当待办 | 连续指针轨迹、通用 3D、专用生成仍不属于已实现范围 |
| [DENSE_DESIGN.md](weibo-templates/DENSE_DESIGN.md) | 2.2 证据阅读／重点／人物／范围等核心能力已有实现与阶段验收 | 其“未自动句绑定”是当时状态；当前 2.3+ 句引用以规范为准 |
| [qbit/IMPLEMENTATION.md](qbit/IMPLEMENTATION.md) | 四阶段实现与样片技术验收已完成，保留 10 月 17 日修订记录 | S04 未下载／全片分析；核听、叙事质量、长篇高规格性能仍待验，不因归档关闭 |
| [2026-10-17-documentation/VERIFICATION.md](2026-10-17-documentation/VERIFICATION.md) | 本次整理前混合在验证页中的历次证据 | 保留失败、阶段范围及 Simon／双驱动案例；142 项是历史完整快照 |

Markdown 相对链接在本轮迁移的记录中已重定位；正文中的代码样式路径保留原上下文。旧冻结快照不重写。媒体、用户 Profile、模型缓存、原始报告与测试基线均不随文档归档移动或删除。

## 补收的本机记录

[交付与迭代账本](local-deliveries/README.md)保存博客、Musk、多驱动和阅读节奏试验；[早期 Project](local-deliveries/LEGACY_PROJECTS.md)保留未完成／失败范围。完整来源分类见[补收审计](../research/LOCAL_RECORDS_AUDIT.md)。
