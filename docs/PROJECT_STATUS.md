# BMW 项目复查与拆仓状态

复查日期：2026-10-02。依据迁移前工作树和拆分后的源码、Manifest、测试与运行检查；历史研究文件保留在 docs/history，不作为当前实现的证明。

## 原项目的真实状态

原项目为三 App 的 TypeScript/Electron 单仓。BMW Base 提供浏览器、Project/Session、权限、Cookie 连续性、计划任务及媒体；BMWVideo 仅增加空 feature-video，没有视频剪辑、时间线或成片渲染。BMWDev 已有 OPFS/Service Worker Static Runtime、可选 WebContainer、WVL 计划审批、RunRegistry、证据与有限修复。DSH 0.2.0-rc.2 是唯一 Harness，官方 MCP Client 负责连接、取消及图像准入；BMW 自有 Shell/浏览器/媒体仍必须保留。

拆分前验证为 125 项单元/契约测试、6 项产品边界测试及 DSH/桌面/媒体冒烟检查。它们是旧结构的证据，不能直接证明新仓库通过；新仓库结果单独记在 handoff.md 和迁移验证报告。

## 本次架构变化

现在只有两个可继续开发的产品仓库：BMW（BMWVideo 的简称）与 BMWDev。BMW = 原 Base 浏览器/媒体基础 + Video Feature 扩展边界；BMWDev = 完整 BMW 基础 + Dev Runtime + WVL。原 BMWVideo 独立 App/id/preset 被移除，BMW 保留 `BMW`/`persist:bmw`，BMWDev 保留独立 `BMWDev`/`persist:bmw-dev`。没有触碰真实用户 Profile；旧 BMWVideo Profile 不会自动合并，按需进行显式迁移。

共享 MCP 代码不再导入 App：认证 Bridge 输出当前组合的工具 Catalog；模型始终只有 browser。Dev 专属持久状态和 WebContainer Secret 从公共 Platform 移到 BMWDev 的 dev-state 包。飞书遗留源码与 SDK 从两个新仓库完全移除，不再安装这些依赖。Dev 专属 Action、插件和状态只留在 BMWDev。

本仓库只保留 apps/bmw、公共基础和空 feature-video；不含 Dev Runtime、WVL、dev-state 或额外 App。BMWDev 后续通过显式评审同步基础改动，BMW 不反向依赖 Dev。

## 已实现与可用程度

| 范围 | 状态 | 证据与限制 |
|---|---|---|
| DSH/Session/单工具 | 已实现 | 鉴权 RPC、官方 WS 快照、Session/Project token、取消排队、FIFO；付费模型视觉理解未验证 |
| 桌面/Project/权限 | 已实现 | 独立 Profile，用户 Agent Control，敏感站点权限、临时 Profile 冒烟；完整 GUI 与所有安全面非全覆盖 |
| 浏览器/媒体 | 已实现 | 截图/下载/页面视频 Capture 的真实 Chromium 检查；WebM Capture 达最大时长为截断，不能称完整视频 |
| 视频制作 | 边界已建 | feature-video 无生产动作；无时间线、剪辑器、成片导出、FFmpeg |
| Dev Runtime/WVL | 仅 BMWDev 中实现，本仓库不存在 | 不属于 BMW 的安装、菜单或模型能力 |
| 发布/移动远控 | 未实现 | 无签名安装器、自动升级、移动客户端、独立远控服务 |

## 当前技术债与后续顺序

本次 `npm audit --json` 确认两个 high 依赖项：Electron 39.8.10（包含沙箱弹窗/协议相关公告）和 extract-zip 2.0.1（符号链接目录穿越公告）。锁文件保留迁移前版本，本次没有把跨大版本 Electron 升级伪装成已完成；上线前应独立升级并回归全部浏览器/弹窗/媒体/Preload 工作流。npm 当次建议的修复线为 Electron 44.5.1，仍须实际验证。审计来源：[Electron 公告](https://github.com/advisories/GHSA-gr2m-v5gq-v685)、[extract-zip 公告](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)。

1. 先补真实模型视觉与 Session 销毁生命周期集成覆盖；现有静态/契约测试不能替代该证据。
2. 设计视频 MVP（素材/片段/浏览器内合成/导出），以小规模 WebCodecs/WebAudio/Canvas 测试推进，避免先引入 CLI。
3. 大类仍存在迁移前 `any` 和非 strict TS；保留受控 legacy 测试豁免，逐步收紧而非宣称已完整类型安全。
4. 拆仓后公共基础通过显式基准更新，无自动源码同步；不同产品不得共享真实 Chromium/DSH Profile。
5. 再处理固定 DSH Runtime 打包、自有协议、签名/升级与 CI 临时 Profile UI 测试。独立远控/移动控制另做，不接聊天软件。

桌面冒烟还观测到启动前 Session 列表请求的临时 ECONNREFUSED/401/未就绪错误、弃用 console-message API 与退出时页面 theme target-closed 日志，最终均恢复并通过；后续应补统一启动就绪门控和退出收尾，不能把冒烟通过表述为无所有界面/日志问题。

## 维护与可追溯

功能和测试保障以 FUNCTIONAL_SPEC.md 为准。每个 repo 有自己的 agent.md、AGENTS.md、handoff.md、package-lock.json、唯一启动入口与 Git history。原仓库保持可恢复的迁移前快照，不作为第三个活跃产品继续开发。
