# 2026-10-05 显式 Agent 数据迁移记录

> 历史授权操作的记录，不能作为本轮访问生产 Profile 的授权。当前操作方法见 [迁移说明](../../AGENT_DATA_MIGRATION.md)。正文保留当时数据规模与本机路径；本轮未重新执行迁移。

## 本机执行记录（2026-10-05）

真实 BMW Profile 已完成这次明确授权的迁移：10 个 Project；28 个原有会话的 ID、历史、输入回执、选择、模型偏好和原生恢复锚点全部保留，再导入 4 个 DSH 会话，共 32 个；9 个 Studio 草稿及 848 个 Project 文件保持原字节。DSH Home 的 1,135 个原文件保持原字节，仅新增 harness 私有映射。38 个元数据文件已提交为 v2，重复预检报告 alreadyCurrent、零改动、零警告。

元数据备份位于 `~/Library/Application Support/BMW-agent-data-backup-1791209775488`，manifest 状态为 complete，备份原字节与迁移后哈希均已复核。完整离线报告为 109 项检查与 5 个检查门通过；真实数据迁移审计另存于 `.bmw-runtime/agent-data-closure/2026-10-05/`。本次未发起付费模型推理。

迁移后 BMW 已正常启动，恢复原 Project、Qoder CN 选择、会话历史和网页；Assistant 状态就绪，Studio 按当前会话显示，随后恢复浏览器工作区。启动后的复核仍确认原会话、偏好、历史回执和 9 个草稿保持不变，没有发送模型消息。
