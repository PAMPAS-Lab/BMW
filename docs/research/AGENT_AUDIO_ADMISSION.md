# 官方运行时音频准入核验

核验日期：2026-10-17。此矩阵只描述本仓库实际适配路径。没有用 ASR、音频指标、WAV 文件、未静音播放或模型自述充当模型已经听到音频的证据。

| 驱动 | 当前 BMW 模型输入路径 | 官方接口／实际准入证据 | 本轮结论 |
|---|---|---|---|
| DSH | 会话文字；唯一 browser 的文本／PNG 工具回包 | harness-dsh 的 wire 归一化与 browser 结果准入；未实现或验证音频内容块 | BMW 内无已验证音频准入；模型核听未执行 |
| Codex | `turn/start` 文本；动态 browser 回包转 `inputText` / `inputImage` | harness-codex 当前闭合结果适配只接收 PNG；不含音频转发路径 | BMW 内无已验证音频准入；不推断账号其它产品的能力 |
| Qoder CN | SDKUserMessage 文字；browser MCP 的文字／图像回包 | SDK 1.0.50 / Worker 1.1.64；公开类型有 ImageContentBlock，通用 ContentBlock 的 type:string 不是音频支持证明；本轮官方冷控制目录选中 `dfmodel` / DeepSeek-Flash | BMW 内无已验证音频准入；付费视频制作中的图像审阅也不构成核听 |

可核对实现：`packages/harness-codex/src/codex-backend.ts`、`packages/harness-qoder/src/qoder-backend.ts`、`packages/harness-qoder/src/qoder-events.ts`、`packages/harness-dsh`、`packages/browser-capability/src/browser-mcp-server.ts`（目录中实际入口以源码为准）。本机官方 SDK 类型依据为 `@qodercn-ai/qodercn-agent-sdk/dist/protocol/common.d.ts`。没有向未经验证的音频内容块做真实上传或扩展模型权限。

`media.audio.sample` 仍提供有界原采样率／声道 PCM16 证据；`media.audio.preview` 打开不自动播放的试听控件。成片需要由人实际播放听审，分别记录清晰度、音色、爆音／静音、配乐遮挡与音画关系。人工试听和观众复述保持待验；类型工作表／技术检查不替代这些结论。

MEDIA-01 的当前路径支持矩阵研究已形成；实际模型音频准入仍未获得证据。若官方运行时以后提供可验证接口，须在各 harness 内验证有效目录、内容类型、预算、取消与回包，再决定是否引入 browser 的受限音频准入，不新增模型工具或 Host 模型循环。
