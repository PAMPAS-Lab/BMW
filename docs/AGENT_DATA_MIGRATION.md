# BMW Agent 数据迁移

BMW 日常运行只使用统一的 Host、Assistant 与 v2 Agent 数据格式。DSH、Codex、Qoder CN 的认证、原生恢复、协议和工具准入留在各自 harness。旧 DSH Client/DOM 选择入口、Project 内原生映射和启动时历史导入已移除。

## 新格式与保留内容

| 文件 | 当前责任 |
|---|---|
| `agent-data-version.json` | v2 提交标记；最后写入，应用启动验证 |
| `projects.json` | BMW Project 身份、目录、页面与文档；不含 agentBindings/原生 Workspace |
| `agent-conversations.json` | 稳定 BMW Session、Project/driver、不可替换的原生恢复锚点与选择 |
| `agent-history/*.json` | 显示消息、事件、输入回执，以及通用 owner `{projectId,driverId,externalSessionId}` |
| `agent-preferences.json` | 每个 Project 的驱动与每个驱动的模型选择 |
| `global-settings.json` | 浏览器、外观、媒体和视频设置；无旧原生侧栏字段 |
| `scheduled-tasks.json` | 明确的 Project/BMW Session/driver 与执行记录 |
| `dsh-home/bmw-project-bindings.json` | DSH harness 私有的 BMW Project 到原生 Workspace 映射 |

上述 Agent 数据均为 v2。权限、布局、登录连续性、Project sources 与 Studio 的独立格式不由本次迁移升级。

迁移保留已有 BMW Session ID、Project ID、原生 resume anchor、显示历史、模型偏好及任务归属。尚未进入 BMW 索引的旧 DSH 会话按原 ID 导入；归档 Project 的原 Workspace 已移除时，必须由官方 Session header cwd 证明目录归属才能导入。Studio ownerSessionId 和素材字节保持不变。已保存的显示历史优先保留；原生模型上下文仍由引擎负责，不伪造 BMW 输入回执，也不把显示文本当作跨驱动原生续聊。

## 操作

先退出 BMW 并确认其进程结束，使用迁移后版本的源码执行。旧版本不认识新的 Profile 锁，因此不能同时运行。先构建，再查看计划：

```bash
npm run migrate:agent-data -- --profile "/absolute/path/to/BMW" --plan
npm run migrate:agent-data -- --profile "/absolute/path/to/BMW" --apply
```

macOS 默认 Profile 通常为 `~/Library/Application Support/BMW`；若设置了 `BMW_USER_DATA_DIR`，使用该实际绝对路径。`--plan` 不改写应用状态，但会临时获取并释放迁移锁；冷原生导出只在复制的临时 DSH Home 上执行。需要与项目固定基线匹配的官方 DSH 安装，不发送模型输入，不使用付费推理。

`--apply` 重新读取并验证计划；在 Profile 同级生成 `BMW-agent-data-backup-<timestamp>`，备份所有本次修改的元数据，写入 `manifest.json`，再原子替换目标文件并最后提交标记。该目录可能包含独立 DSH 凭据副本，权限为 0700/0600，应与 Profile 一样保密，不提交 Git。它不是媒体或整个 Profile 的完整备份：素材不参与改写。

失败、身份不一致、Studio owner 未绑定、状态格式混用或并发修改会中止。普通写入失败恢复本事务已写文件；出现并发修改时保留该修改并记录 rollback-conflict。原生清理失败不算迁移成功，也不删除仍需清理的临时导出目录。已有凭据符号链接只在这次显式迁移中转换为私有普通文件，链接源不改写；日常 harness 不自动修复旧链接。

迁移成功后启动 BMW，已有会话和 Studio 草稿仍使用同一 owner。切换引擎只选择该引擎原有 BMW 会话，没有才创建空会话；不复制其他引擎的模型上下文。再次执行计划会验证当前文件并报告 alreadyCurrent，不重复导入。

## 备份恢复

恢复前退出 BMW，保留当前 Profile 和备份。依据 `manifest.json` 的文件清单恢复 `before/` 的原字节；`existed=false` 的目标移除，`link` 非空的目标恢复原链接，不能把整个 before 目录覆盖到未知位置。只恢复清单中的文件，Project 媒体和 Studio 草稿不改动。`rolled-back` 已由工具恢复；`rollback-conflict` 需先人工核对被保留的并发改动。

恢复成旧格式后只能使用迁移前版本，或重新运行显式迁移；新版本不会自动接受旧 Profile。进程被强制终止而留下混合格式时，先依据备份恢复，再迁移，不能仅手工添加提交标记。

## 验证边界

隔离测试验证稳定身份/归档导入、显示历史及 Studio/media 保留、严格 v2 加载、备份/回滚、并发保护和 Host 锁。完整离线回归另覆盖三驱动设置、唯一 browser、MCP 租约、桌面、重启、Studio、媒体、视频及本地旁白。具体执行结果见 [VERIFICATION.md](VERIFICATION.md)，历史付费模型结果与本次数据迁移分开记录。

## 本机执行记录（2026-10-05）

真实 BMW Profile 已完成这次明确授权的迁移：10 个 Project；28 个原有会话的 ID、历史、输入回执、选择、模型偏好和原生恢复锚点全部保留，再导入 4 个 DSH 会话，共 32 个；9 个 Studio 草稿及 848 个 Project 文件保持原字节。DSH Home 的 1,135 个原文件保持原字节，仅新增 harness 私有映射。38 个元数据文件已提交为 v2，重复预检报告 alreadyCurrent、零改动、零警告。

元数据备份位于 `~/Library/Application Support/BMW-agent-data-backup-1791209775488`，manifest 状态为 complete，备份原字节与迁移后哈希均已复核。完整离线报告为 109 项检查与 5 个检查门通过；真实数据迁移审计另存于 `.bmw-runtime/agent-data-closure/2026-10-05/`。本次未发起付费模型推理。

迁移后 BMW 已正常启动，恢复原 Project、Qoder CN 选择、会话历史和网页；Assistant 状态就绪，Studio 按当前会话显示，随后恢复浏览器工作区。启动后的复核仍确认原会话、偏好、历史回执和 9 个草稿保持不变，没有发送模型消息。
