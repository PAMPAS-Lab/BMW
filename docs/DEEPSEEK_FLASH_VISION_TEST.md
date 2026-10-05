# DeepSeek Flash 真实视觉测试

这是 2026-10-02 的专项视觉证据快照；其协议和能力结论仅适用于当时的对应链路。当前三驱动、登录与边界回归范围见 [PROJECT_STATUS.md](PROJECT_STATUS.md) 和 [VERIFICATION.md](VERIFICATION.md)。

日期：2026-10-02。产品：BMW。DSH 0.2.0-rc.2；Electron 44.5.1；官方 deepseek-official 路由、deepseek-flash、low reasoning、4096 最大输出 token。

## 官方模型核对

截至本次核对，最新 Flash 为 DeepSeek-V4.1-Flash，2026-09-10 发布，原生支持图像理解；官方推荐模型名 deepseek-flash，旧 deepseek-v4-flash / deepseek-v4-flash-vision-exp 暂时路由到新版。来源：[更新日志](https://api-docs.deepseek.com/updates/)、[视觉 API](https://api-docs.deepseek.com/guides/vision/)。此次测试没有改动用户已有模型选择。

## 实际测试与证据

链路为合成 Canvas → BMW BrowserKernel 元素截图 → Project Artifact → 认证 Bridge → 官方 MCP Client 的 image block 准入/附件存储 → DSH → DeepSeek 官方模型。截图实际 2000×1600；每个样本用新 Session，模型只能通过 browser 调用截图；夹具执行器拒绝其他操作。编号及三笔金额随机生成，图表最高柱、红色方位及圆数在两组间变化；提示和返回文本元数据不含正确答案。

| 核对项目 | 两组结果 |
|---|---|
| 随机编号与中文标题 OCR | 4/4 |
| 三笔金额求和 | 2/2 |
| 最高柱与最高/第二高差值 | 4/4 |
| 红色矩形方位 | 2/2 |
| 蓝色圆计数 | 2/2 |
| 不存在的绿色三角形 | 2/2 |
| 合计 | 16/16 |

两组提示提交到最终回复耗时：3.869 秒、3.833 秒，包含截图、工具往返和两次模型请求；不代表单次视觉推理延迟或并发吞吐。记录的每次模型 request/header 都只有 browser，路由/模型也已核对。

原始证据：[完整报告](vision-tests/2026-10-02T13-38-22-267Z/report.json)、[图 1](vision-tests/2026-10-02T13-38-22-267Z/case-1.png)、[图 2](vision-tests/2026-10-02T13-38-22-267Z/case-2.png)、每组 receipt JSON（原始回答、工具 Schema/调用和 token usage）。目录下较早失败/诊断轮次保留，未计入最终成绩；首轮测试夹具错误也不计为模型能力失败。

## 发现并修复的问题

实际模型请求中唯一工具为 browser，BMW 驱动预设禁用官方 mcp-resources，避免额外资源工具注册。当前产品边界检查实际驱动配置；视觉 E2E 检查最终 request/header.tools。截图与官方图像处理保持可用。

## 复跑

```bash
BMW_VISION_TEST=1 NODE_USE_ENV_PROXY=1 npm run test:vision-e2e
```

这是显式选择的真实付费模型测试，不纳入默认 npm test。使用临时 userData、Project、DSH Home；凭据仅供测试 Host 在受保护临时目录使用，原始凭据文件和真实用户 Profile 不改动，模型没有凭据/文件工具。macOS runner 使用测试专用 mock-keychain。每次生成独立证据目录。

## 范围限制

这证明清晰合成截图的 OCR、数值/图表和简单空间理解及 BMW 图像链路可用，不是通用视觉评测。真实网页复杂交互、点击坐标精度、小字/模糊图、自然照片、跨图比较、连续视频理解及长会话图像压缩仍未测试。本专项没有覆盖 Session 销毁撤权或完整 IPC 准入；后续对应租约、清理、Shell 请求与框架拒绝保障由 [VERIFICATION.md](VERIFICATION.md) 和生成的测试清单单列，不能由此视觉成绩推断。
