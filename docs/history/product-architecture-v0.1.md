# Browser Agent 产品架构 v0.1

> Historical document: this describes the pre-split integrated prototype. The active BMW/BMWVideo/BMWDev monorepo architecture is documented in `README.md`, `handoff.md`, and the app-local `AGENTS.md` files. The exact integrated code is preserved by Git tag `bmw-integrated-wvl-v0.1.0`.

> 日期：2026-08-15
> 状态：方向性架构决策
> 产品边界：独立安装、独立浏览器 Profile、独立权限系统；不启动或接管外部浏览器。

## 1. 总体决策

产品由三个彼此隔离的核心组成：

```text
┌─────────────────────────────────────────────────────────┐
│                 Standalone Browser Product              │
│                                                         │
│  Browser Shell          Agent Core          Media Engine│
│  Electron/Chromium  ↔   DSH Runtime     ↔   WebGPU      │
│  WebContentsView        plugins/events      WebCodecs   │
│  Profile/Permission     session log         Web Audio   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

核心原则：

1. **DSH 是 Agent 内核，不是产品外壳。** 浏览器在 DSH 不可用时仍能独立启动和手动使用。
2. **Browser Kernel 是唯一执行边界。** DSH 不直接接触 Electron、cookie、密码、文件系统或任意网页 IPC。
3. **模型侧仍只有 Browser Skill。** 音视频能力属于 `browser.media.*`，不会成为绕过浏览器权限的新工具系统。
4. **所有网页执行发生在产品拥有的 WebContents 中。** 禁止启动外部 Chrome、独立 Playwright profile 或不可见的第二套浏览器权限。

## 2. 基于 DeepSeek Harness 的 Agent Core

### 2.1 为什么适合

DeepSeek Harness（`dsh`）的底层 Cordis 架构把模型 adapter、tool registry、session log、agent loop、approval policy 等都作为插件挂载。Profile 是若干 bundle 与 patch 的有序组合；能力可以通过 service provider 和事件 seam 替换，而不修改 loop。

这与产品需求高度一致：

- 用 DSH 管理模型调用、step/turn、流式输出、取消和恢复；
- 用 DSH append-only SessionEvent log 支持任务回放和 UI 同步；
- 用 DSH approval/tool pipeline 接入产品权限中心；
- 用自定义 profile 将所有模型能力压缩为一个 Browser Tool；
- 后续更新上游 DSH 时，只替换 runtime，不改浏览器产品代码。

DSH 使用 MIT License，可以作为产品内核并随产品分发，但必须保留许可证与第三方 notices。

### 2.2 不能直接耦合的原因

DSH 官方当前标记为 developer preview，并明确提示会发生 compatibility-breaking changes。因此不能让 Electron UI、Browser Kernel 或业务数据直接依赖 DSH 内部 package 类型。

必须设置一个产品自有、版本稳定的接口：

```ts
interface HarnessPort {
  boot(config: ProductAgentProfile): Promise<RuntimeInfo>
  createSession(input: CreateSessionInput): Promise<SessionId>
  send(sessionId: SessionId, input: AgentInput): Promise<void>
  cancel(sessionId: SessionId): Promise<void>
  resume(sessionId: SessionId): Promise<void>
  subscribe(sessionId: SessionId, cursor?: string): AsyncIterable<ProductAgentEvent>
  registerBrowserProvider(provider: BrowserProvider): Promise<void>
  healthcheck(): Promise<HarnessHealth>
  shutdown(): Promise<void>
}
```

`HarnessPort` 是产品 ABI。DSH 的事件、类型和错误必须在 adapter 内转换为产品自有协议，禁止穿透到 UI。

### 2.3 推荐的 DSH 组合方式

不 fork、不修改 DSH core，创建产品自己的 profile 和 bundle：

```text
dsh-base
  ↓
browser-product-base bundle
  ├─ browser-tool plugin
  ├─ product-permission plugin
  ├─ product-session-bridge plugin
  ├─ product-ui-bridge plugin
  ├─ product-model-policy plugin
  └─ product-media-context plugin
  ↓
product profile patch
```

建议插件职责：

| 插件 | 作用 |
|---|---|
| `browser-tool` | 向 `ctx.tools` 只注册一个模型可见的 `browser` 工具 |
| `product-permission` | 拦截 tools pipeline，将动作交给产品 Permission Broker |
| `product-session-bridge` | 将 DSH SessionEvent 映射为产品事件并持久化 cursor |
| `product-ui-bridge` | 对 Agent Panel 推送 step、chunk、tool call、状态 |
| `product-model-policy` | 限制可用模型、成本、超时、上下文和 fallback |
| `product-media-context` | 只向模型注入被授权的截图、关键帧、转写和媒体元数据 |

### 2.4 模型侧唯一 Browser Tool

即使 DSH 支持任意工具注册，产品 profile 也应默认拒绝其他 model-facing tools：

```ts
type BrowserAction =
  | { kind: "observe"; target: TargetRef }
  | { kind: "navigate"; target: TargetRef; url: string }
  | { kind: "act"; target: TargetRef; operation: SemanticAction }
  | { kind: "invoke_tool"; target: TargetRef; tool: string; input: unknown }
  | { kind: "media.screenshot"; target: TargetRef; options: ScreenshotOptions }
  | { kind: "media.record.start"; target: TargetRef; options: RecordOptions }
  | { kind: "media.record.stop"; recordingId: string }
  | { kind: "media.inspect"; artifactId: string; query: MediaQuery }
  | { kind: "wait"; condition: WaitCondition }
  | { kind: "checkpoint"; label?: string };
```

Browser Kernel 校验 `profileId + webContentsId + taskId + capabilityToken` 后才执行。

### 2.5 DSH 独立升级机制

产品不能在运行时直接执行 `npm update dsh@latest`。推荐使用签名、可回滚的双槽 runtime：

```text
App Version
├─ DSH Slot A：当前稳定版
├─ DSH Slot B：待验证新版
├─ Product DSH Adapter
└─ Compatibility Manifest
```

更新流程：

1. 产品始终内置一个 last-known-good DSH runtime；
2. 新 runtime 下载到非活动槽并校验签名、hash、license manifest；
3. 运行 boot、session replay、browser tool、cancel/resume、approval 等契约测试；
4. 通过后原子切换活动槽；
5. crash loop、事件协议不兼容或健康检查失败时自动回滚；
6. DSH 更新失败不能阻止浏览器手动模式启动。

版本兼容清单至少包含：

```json
{
  "runtime": "@deepseek-ai/dsh@x.y.z",
  "adapterAbi": 1,
  "productApi": ">=0.1 <0.2",
  "eventSchema": 1,
  "browserToolSchema": 1
}
```

由于上游处于 developer preview，应固定 npm 版本和 integrity，不能跟随 `latest`；升级必须由 CI 产生经过验证的 runtime bundle。

## 3. Browser Media Engine

WebGPU 是处理层，不是采集或编码 API。完整管线必须拆成四层：

```text
Capture
  ↓
Frame / Audio Pipeline
  ↓
WebGPU + Web Audio Processing
  ↓
WebCodecs / MediaRecorder Encoding
  ↓
Artifact Store + Agent Context
```

### 3.1 采集层

| 场景 | 首选接口 | 说明 |
|---|---|---|
| 当前页面可视区域截图 | `webContents.capturePage()` | 支持区域截图，也可捕获隐藏但仍由产品拥有的页面 |
| 完整页面截图 | CDP `Page.captureScreenshot` | 使用 `captureBeyondViewport`，不依赖滚动拼接 |
| 页面连续帧 | `webContents.beginFrameSubscription()` | 获取 presentation frame 和 dirty rect，适合产品内页面录制 |
| 当前标签视频/音频流 | `setDisplayMediaRequestHandler` + `WebFrameMain` | 由产品批准页面自捕获；音频可绑定 frame |
| 摄像头/麦克风 | `getUserMedia()` | 经 Product Permission Broker 与 OS 权限双重授权 |
| 整屏/其他应用窗口 | Electron `desktopCapturer` / 系统 picker | 必须由用户明确选择，不能作为 Agent 默认权限 |

所有 capture source 都必须绑定产品的 `profileId`、`origin`、`webContentsId` 和用户授权记录。

### 3.2 WebGPU 视频/图像处理

媒体 worker 在产品自有的受信 renderer 或 dedicated worker 中运行 WebGPU：

- 将 `VideoFrame` 通过 `GPUDevice.importExternalTexture()` 导入 GPU；
- 截图通过 `ImageBitmap` / external image 上传到 `GPUTexture`；
- WGSL shader 完成缩放、裁剪、旋转、颜色空间转换和锐化；
- 完成隐私区域模糊、文本/人脸区域遮挡、水印和指针叠加；
- GPU 计算 frame diff、缩略图、感知特征或 scene-change score；
- 合成网页、摄像头、字幕和 Agent 操作标记。

WebGPU 可以减少帧在 CPU/GPU 之间的复制；WebGPU 规范允许把 `VideoFrame` 包装为 `GPUExternalTexture`。但实现是否真正零拷贝取决于平台，必须用性能测试确认。

### 3.3 音频处理

音频不应强行全部放到 WebGPU：

- 实时混音、增益、静音、降噪前后处理使用 Web Audio；
- 自定义低延迟处理使用 `AudioWorkletProcessor`；
- WebGPU 只用于适合批处理的频谱、特征或模型推理；
- 麦克风、标签音频、系统音频是不同 permission scope；
- 系统音频能力存在平台差异，必须 feature detect。

### 3.4 编码与封装

提供两条编码路径：

1. **MVP 路径：MediaRecorder**
   - 直接消费 `MediaStream`；
   - 支持分片输出、暂停、继续和停止；
   - 用 `MediaRecorder.isTypeSupported()` 在运行时选择容器和 codec。

2. **高级路径：WebCodecs**
   - `VideoEncoder` / `AudioEncoder` 控制 bitrate、framerate、keyframe 和时间戳；
   - 适合经过 WebGPU 处理后的 VideoFrame；
   - 编码后的 chunk 仍需 WebM/MP4 muxer 进行容器封装；
   - 每个 `VideoFrame` 编码或处理后必须显式 `close()`，防止 GPU 内存泄漏。

### 3.5 媒体 Artifact

Agent 不应直接把完整录像塞进模型上下文。Media Engine 产生统一 artifact：

```ts
interface MediaArtifact {
  id: string
  ownerTaskId: string
  source: { profileId: string; webContentsId?: number; origin?: string }
  type: "screenshot" | "recording" | "audio" | "frame-set" | "transcript"
  mimeType: string
  durationMs?: number
  dimensions?: { width: number; height: number }
  createdAt: string
  consentId: string
  retentionPolicy: string
  derivatives: Array<{ kind: string; artifactId: string }>
}
```

模型默认只获得：

- 一张经过缩放和脱敏的截图；
- 关键帧及时间戳；
- 音频转写；
- scene-change / OCR / 页面状态等结构化摘要；
- 必要时通过 `browser.media.inspect` 请求指定时间段或区域。

### 3.6 媒体权限与安全

最低要求：

- 录制期间必须显示不可被网页遮挡的产品级红色指示器；
- 开始录制需要用户手势或明确确认，Agent 不能静默授权自己；
- 区分一次、当前任务、当前 origin 三种授权，不提供永久整屏录制默认项；
- 上传媒体是独立的 write/exfiltration 权限，录制许可不等于上传许可；
- 对密码框、支付页、隐私 origin 支持自动暂停或黑帧；
- DRM/protected content 可能返回黑帧，产品不得尝试绕过；
- 录制按 chunk 落盘并持久化索引，崩溃后可恢复已有片段；
- 默认本地保存，云端分析必须再次告知数据范围和保留周期。

### 3.7 降级策略

WebGPU 并非所有设备上都可用，且可能发生 device lost：

```text
WebGPU
  ↓ unavailable / device lost
WebGL2 or Canvas2D + Web Workers
  ↓ insufficient
Raw capture + MediaRecorder
```

截图、基础录制不能依赖 WebGPU；WebGPU 只负责加速和高级处理，因此 GPU 不可用不会破坏核心浏览器能力。

## 4. 进程与信任边界

```text
Electron Main（高信任）
├─ Window / WebContents 生命周期
├─ Profile / Permission Broker
├─ Capture authorization
└─ Signed runtime manager

DSH Utility Process（受限信任）
├─ Agent loop
├─ Model adapters
├─ Session events
└─ Browser tool client

Browser Renderer（不可信内容）
├─ Remote webpages
└─ 无 Node、sandbox、context isolation

Trusted UI Renderer（受信 UI）
├─ Tabs / Agent Panel / Task Center
└─ 仅暴露窄 IPC

Media Worker（受限高性能）
├─ WebGPU / Web Audio / WebCodecs
└─ 只访问显式授权的 frame/audio ports
```

关键点：DSH 插件生态不能自动获得 Electron main 权限。任何 DSH plugin 想访问浏览器或媒体，都必须通过 Product Browser Provider 和 Permission Broker。

## 5. 分阶段实现

### Milestone A：DSH 嵌入验证

- 固定一个 DSH 版本；
- 在 utility process 启动自定义 product profile；
- 实现 HarnessPort 和事件映射；
- 只注册 `browser` 工具；
- 验证 session、stream、cancel、resume、approval 和 crash recovery。

### Milestone B：截图与基础录制

- `capturePage` 与 CDP 完整页截图；
- 产品内单标签录制；
- MediaRecorder 分片写入；
- 产品级录制指示器、权限与 artifact 索引。

### Milestone C：WebGPU Pipeline

- VideoFrame → GPUExternalTexture；
- resize、crop、blur、redaction、composite；
- WebCodecs 编码与 mux；
- device-lost 和非 WebGPU 降级测试。

### Milestone D：DSH 独立更新

- 双槽 runtime；
- 签名与 compatibility manifest；
- DSH 契约测试矩阵；
- 原子切换和自动回滚。

### Milestone E：BMW Web Validation Loop

- DSH 原生 `/wvl` 与 `/runs` 生成 Project/Session 绑定的 Experiment Plan 卡片；只有用户批准的 Dev Target 命令可以启停，DSH 不获得 Shell；
- 每个 Project 复用一个 BMW Test Tab，后台运行语义步骤、结构化断言和多 viewport 回归；
- CDP 提供完整页截图、Accessibility、Network、Console 和性能证据；
- Media Worker 用 WebGPU compute 完成视觉差异，用连续帧采样检测 Canvas、Three.js、视频的冻结和黑屏；
- 测试用例、基线、运行报告和 Failure Bundle 都归 Project 所有；
- 用户可以启动最多三轮的 DSH 修复—失败项重跑循环，外部发布与不可逆操作仍不在授权范围内。

## 6. 当前推荐

可以把产品定义为“完全以 DSH 为 Agent Runtime 基础”，但不应定义为“整个产品就是 DSH 的一个 UI”。最佳边界是：

> **Browser Product owns identity, permissions, web contents and media; DSH owns reasoning, sessions and agent lifecycle.**

这样既能持续获得 DSH 上游能力，又能在 DSH 发生破坏性更新、启动失败或未来需要替换 harness 时，保持浏览器、用户 Profile、权限数据和媒体资产完全独立。

## 7. 主要依据

- [DeepSeek Harness：README、developer preview、MIT License](https://github.com/deepseek-ai/deepseek-harness)
- [DeepSeek Harness Architecture：Cordis、profiles、bundles、events、session log 与 capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [Electron webContents：capturePage 与 frame subscription](https://www.electronjs.org/docs/latest/api/web-contents/)
- [Electron Session：display media 与 WebFrameMain capture](https://www.electronjs.org/docs/latest/api/session)
- [Chrome DevTools Protocol：Page.captureScreenshot](https://chromedevtools.github.io/devtools-protocol/1-3/Page/)
- [W3C WebGPU：GPUExternalTexture](https://www.w3.org/TR/webgpu/)
- [MDN WebCodecs：VideoFrame、WebGPU 与 Encoder](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Using_the_WebCodecs_API)
- [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [MDN AudioWorkletProcessor](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor)
