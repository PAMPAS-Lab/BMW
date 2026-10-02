# BMW handoff

日期：2026-10-02。先读 agent.md / AGENTS.md / docs/FUNCTIONAL_SPEC.md / docs/PROJECT_STATUS.md。

## 当前结构

本仓库独立构建且只有 apps/bmw。BMWVideo 简称 BMW，由 product-bmw 提供浏览器、媒体与 Video Feature 基础。

DSH 0.2.0-rc.2 为唯一 Harness。当前仍用系统 dsh + 自有 Electron Shell + 官方 Web/Remote RPC/WS，并未替换成官方 Desktop 壳。Browser 是唯一模型 Tool。MCP 从认证 Bridge 获取组合 Catalog，不导入 App；Session/Project 随真实 Agent 绑定、串行化与过渡互斥继续保留。截图返回 PNG 图像与 Artifact 元数据，图像准入和附件持久化由官方 Client 完成。

## 入口和命令

- App：apps/bmw/product.ts；基础：packages/product-bmw/index.ts。
- npm ci；npm start。旧 start:bmw-video / 三产品选择器已删除。
- npm run build / npm run check / npm test / npm run test:boundaries。
- npm run test:dsh-e2e / test:desktop-e2e / test:media-e2e：临时 Profile，不调用模型。不要在同一仓库并行运行含 build 的命令。
- 功能/测试变化运行 npm run docs:features。

## 数据与拆仓

BMW 保留 BMW userData / persist:bmw / bmw preset，承接原 Base 数据。旧 BMWVideo Profile 没有自动合并或删除。

本仓库不能依赖 BMWDev；公开基础改动供 BMWDev 显式采用。

## 完成度与下一步

可用：浏览器/媒体/项目/Session/计划任务/登录连续性；Video Feature 只是制作扩展边界。

未完成：视频剪辑/成片、发布签名/更新、移动远控。真实模型视觉、DSH 销毁撤权、完整浏览器 GUI不是全面 E2E 已覆盖项。优先任务见 docs/PROJECT_STATUS.md。

拆仓验证：独立 npm ci（锁定依赖）、build/check、85 项单元/契约测试、6 项边界测试；DSH 与桌面/媒体冒烟通过。桌面验证驱动真实 Shell、创建第二个 Project 和 DSH Session；没有调用付费模型。最终目录的检查结果见 docs/VERIFICATION.md。

依赖审计：当前锁定 Electron 39.8.10/extract-zip 2.0.1 有两个 high 项，详见 PROJECT_STATUS；未在拆仓中做跨大版本升级，发布前优先处理。
