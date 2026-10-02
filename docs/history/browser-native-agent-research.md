# Browser-Native Agent 体系化调研

> 调研日期：2026-08-15
> 目标：判断是否已存在“Agent 与浏览器原生捆绑”的产品与平台，并评估一种只向模型暴露浏览器能力、其他能力全部经 Web API 或 Browser Extension 完成的 Agent 架构。

## 1. 结论先行

市场已经证明“AI Native + Browser Native”是一个真实产品类别，但还没有形成成熟、开放、跨浏览器的统一 Skill 平台。

当前存在三条路线：

1. **浏览器内建 Agent**：Chrome + Gemini、Edge + Copilot、Opera Neon、Comet、Dia。它们拥有当前页面、多标签、登录态、浏览历史和可视交互，是产品意义上的 Browser Native。
2. **Extension 挂载 Agent**：Claude for Chrome、Playwright MCP Extension 等。它们不需要维护 Chromium fork，能复用用户现有浏览器及登录态，是验证 Agent 能力的低成本路线；但不满足本项目“独立产品、独立权限边界”的要求。
3. **Agent 控制独立/远程浏览器**：Browser Use、Stagehand、Playwright MCP、Chrome DevTools MCP。它们更像 Agent runtime，而非用户日常浏览器；适合后台执行、测试和规模化任务。

真正重要的新变量是 **WebMCP**：Chrome 正在试验让网页以 JSON Schema 和 JavaScript/HTML 声明结构化工具。它把 Agent 与网页的关系从“猜 DOM、模拟点击”升级为“网页主动暴露可调用能力”。但截至本次调研，它仍是 Chrome 149 Origin Trial 中的 proposed standard，尚不能作为唯一生产接口。

因此建议的目标不是“所有事情都用视觉点击完成”，而是：

> **模型侧只存在一个 `browser` Skill；Browser Kernel 内部按 WebMCP → 结构化 DOM/Accessibility → 视觉操作的顺序执行，并通过 Extension API 与 Web API 扩展能力。**

这是可行且有差异化的方向。最终产品应是一个可独立下载安装的 Browser Agent：拥有自己的浏览器窗口、profile、cookie jar、权限中心和任务执行器。用户浏览与 Agent 操作发生在同一产品、同一会话体系内，不启动或接管外部 Chrome。浏览器成为 Agent 的统一能力总线、身份边界、权限系统和可观察界面，而不必成为所有计算实际发生的地方。

## 2. 什么才算 Browser Native

建议用以下标准，而不是厂商是否称自己为“AI Browser”来判断：

| 维度 | Browser Native 的要求 |
|---|---|
| 上下文 | 原生理解当前页、多标签、历史、下载和页面选择内容 |
| 身份 | 复用浏览器 profile、cookie、OAuth 和 Password Manager，而不是另建一套登录态 |
| 执行 | 能导航、点击、输入、上传、下载、管理标签及处理浏览器对话框 |
| 权限 | 权限能按 origin、读/写动作、时间和任务范围收敛 |
| UI | 用户能看到执行过程、暂停、接管、确认和回滚 |
| 扩展 | 网页或扩展能声明新能力，而非所有能力都硬编码在 Agent 后端 |
| 可移植性 | 优先遵循 Web / WebExtensions 标准，避免必须修改 Chromium 内核 |

按这一定义，“浏览器侧边栏里放一个聊天框”只是 Browser-embedded；具备上下文、执行、权限和可扩展能力后，才接近 Browser Native。

## 3. 现有产品版图

| 产品/项目 | 形态 | 原生程度 | Skill / 扩展方式 | 对本项目的启示 |
|---|---|---:|---|---|
| **Google Chrome + Gemini / Auto Browse** | 主流浏览器内建 Agent | 高 | Chrome 内建能力；WebMCP 正在成为网页工具层 | 最接近未来标准形态；安全架构最值得参考 |
| **Microsoft Edge + Browse with Copilot** | 主流浏览器内建 Agent | 高 | 原生标签操作和 Edge 管控 | 证明无需另造浏览器，也能实现本地、可见、可接管的 Agent |
| **Opera Neon** | 独立 agentic browser | 高 | 内建 Chat / Do / Make | Browser Operator 在本地浏览器执行，但创作任务可进入云端 VM，并非严格 browser-only |
| **Perplexity Comet** | Chromium AI 浏览器 | 高 | 内建 Assistant、跨标签、邮件/日历等 | 产品体验完整，但能力协议封闭，不适合作为开放 Skill 底座 |
| **Dia** | Chromium AI-native browser | 中高 | 自然语言创建 Skills，组合页面上下文、Gmail、Calendar 等工具 | “Skill 是可复用工作流”的 UX 很接近目标；底层仍是厂商私有工具系统 |
| **BrowserOS** | 开源 Chromium fork | 高 | 53+ 浏览器工具，应用集成走 MCP | 最接近可研究的开源实现，但其 MCP 集成不符合“唯一 Browser Skill”的严格目标 |
| **Fellou** | 独立 Agentic Browser | 中高 | Web 自动化、Eko、Computer Use | 能力宽，但已扩展到桌面应用和本地文件，边界不再是 browser-only |
| **Claude for Chrome** | 浏览器扩展 | 中 | Extension 读取、点击、跨标签执行 | 证明 Extension-first 可做出强 Agent；也暴露 prompt injection 的核心风险 |
| **ChatGPT Atlas** | 曾为独立 AI 浏览器 | 曾高 | 内建 Agent | 已宣布弃用并迁回 ChatGPT/Codex 浏览器工作流，是“不宜过早维护浏览器 fork”的重要反例 |
| **Playwright / Chrome DevTools MCP / Browser Use / Stagehand** | 浏览器自动化 runtime | 非终端产品 | Accessibility、CDP、Playwright、MCP/SDK | 适合作为执行层或评测基座，不应直接成为面向用户的 Skill 心智模型 |

### 关键观察

- **“Agent 与浏览器捆绑”已经存在，而且成为 Chrome、Edge、Opera 等主流厂商明确投入的方向。**
- **“AI Native + Browser Native”在产品层成立，在平台层尚未完成。** 绝大多数产品的 Agent tool schema、权限模型和工作流格式仍然私有。
- Dia 的 Skills 更接近“提示词 + 上下文 + 工具编排”的 recipe，不等同于网页可声明、带类型、带权限的能力协议。
- BrowserOS 是很好的代码参考，但它选择“浏览器工具 + MCP 应用集成”，而不是把所有外部能力归一到 Browser Kernel。
- Atlas 的弃用说明：独立浏览器本身不是护城河；维护 fork、跨平台发布、同步安全更新和争夺默认浏览器的成本很高。

## 4. 浏览器作为唯一 Skill：可行性边界

### 4.1 可行的含义

“唯一 Skill”应限定为 **模型看到的唯一能力命名空间**：

```text
browser.observe
browser.navigate
browser.act
browser.invoke_tool
browser.fetch
browser.download
browser.wait
browser.request_permission
browser.confirm
browser.checkpoint
```

模型不直接看到 Gmail、Slack、Shell、Calendar、Database 等离散工具。它只看到浏览器，并通过以下方式获得能力：

- 网页原生 UI；
- 网页声明的 WebMCP tool；
- Extension 提供的浏览器能力；
- Extension 或网页调用的 HTTPS API；
- 由浏览器打开、显示状态并授权的远程执行任务。

这能够统一审计、权限、身份、上下文和用户接管体验。

### 4.2 不可取的含义

不应要求所有能力都退化为鼠标点击或截图识别。纯 UI actuation 有四个根本问题：

1. 页面变化即失效，长链任务的误差会逐步放大；
2. DOM/截图会大量占用上下文，并增加时延；
3. 网页内容既是数据又可能是恶意指令，prompt injection 无法仅靠提示词解决；
4. 上传、下载、后台任务、OAuth、跨 origin 数据流很难只靠页面点击安全表达。

正确做法是“一个 Skill，多种浏览器内部执行适配器”。

## 5. 推荐架构：Browser Kernel

```text
User Intent
    ↓
Planner（只看到 browser skill）
    ↓
Policy / Alignment Critic
    ↓
Browser Kernel
    ├─ WebMCP Adapter：页面声明的 typed tools，首选
    ├─ Semantic Adapter：DOM + Accessibility tree
    ├─ Vision Adapter：截图、坐标操作，最后兜底
    ├─ Extension Adapter：tabs / scripting / downloads / identity / side panel
    └─ Web Service Adapter：HTTPS API，经页面或 extension 发起
    ↓
Origin-scoped Session + Audit Log + User Confirmation
```

### 5.1 执行优先级

1. **WebMCP**：结构化输入输出、页面实时状态、明确语义；可靠性最高。
2. **语义 DOM / Accessibility**：对现有网站零改造，适合大多数表单和导航。
3. **视觉操作**：只处理 canvas、复杂富文本、无可访问性语义或跨域视觉组件。
4. **禁止默认任意 JavaScript 注入**：只允许审核过的 extension module 或受限动作模板。

### 5.2 能力发现

WebMCP 当前有一个明显限制：必须访问页面后才能知道它暴露了哪些工具。因此 Browser Kernel 需要自己的轻量目录，但目录只存元数据，不直接执行能力：

```json
{
  "origin": "https://calendar.example.com",
  "entry": "/agent",
  "tools": ["find_slots", "create_event"],
  "auth": "browser-session",
  "risk": "write"
}
```

进入 origin 后必须重新读取页面实际声明，并以页面声明和当前权限为准，防止目录污染或能力漂移。

### 5.3 Web API 如何保持“浏览器唯一能力”

Web API 不直接注册成模型工具，而由以下两种受控方式调用：

- **页面拥有 API**：Agent 调用页面的 WebMCP tool，网页自行请求其后端；
- **Extension 拥有 API adapter**：adapter 声明 origin、OAuth scope、读写级别和 JSON schema，由 `browser.invoke_tool` 统一调用。

这是一种“Capability behind Browser”的设计。API 仍然存在，但不会破坏模型侧只有一个 Skill 的抽象。

## 6. 独立产品优先：Electron Shell，而不是外部 Chrome Extension

根据产品边界，第一版应直接发布独立桌面应用。Electron 是适合验证产品的起点，但 Agent 控制层应由应用自身实现，而不能依赖安装到外部 Chrome 的 Extension。

推荐的应用内结构：

- `BaseWindow`：承载地址栏、标签栏、Agent 面板、任务中心和权限中心；
- 每个网页标签使用独立的 `WebContentsView`，由主进程统一创建、定位和销毁；
- persistent `session partition`：保存该产品自己的 cookie、cache、登录态和站点权限；
- `utilityProcess`：运行 Planner、任务状态机、解析和其他 CPU/长时工作，避免阻塞主进程；
- Browser Kernel：直接管理全部 `webContents`，完成导航、DOM/Accessibility、截图、输入和下载；
- 内建 WebMCP adapter 与 HTTPS API adapter；第三方能力以后可采用受控的内建插件格式。

Electron 官方不建议继续以 `<webview>` 作为核心嵌入方案，应优先使用 `WebContentsView`。远程网页必须关闭 Node integration、启用 context isolation 和 renderer sandbox；任何网页到高权限进程的 IPC 都必须经过 schema、origin 和 capability token 校验。

独立产品仍可借鉴 Manifest V3 的能力划分：

- Agent Panel：对话、计划、日志、确认；
- Tab Manager：多标签和前后台任务；
- Isolated preload / CDP：读取与操作网页；
- Download / Identity / Storage / Scheduler：文件、OAuth、状态和唤醒；
- WebMCP probe：优先发现页面 typed tools。

但 Electron 不是完整浏览器发行版。官方明确表示它只支持 Chrome Extension API 的一个子集，不支持任意 Chrome Web Store 扩展，并且完整兼容 Chrome Extensions 不是其目标。因此：

- 如果目标是“Agent 工作台 + 完整网页浏览 + 精选内建能力”，Electron 足够支撑 MVP；
- 如果目标是替代 Chrome 的通用浏览器、兼容 Chrome Web Store 或需要内核级安全隔离，长期应迁移到 Chromium fork；
- 两条路线对用户都是“下载一个独立产品”，差别只在内部技术底座，不改变产品体验。

第一版不再受 MV3 service worker 生命周期约束，可由应用主进程和 utility process 维护任务状态；但仍应采用事件驱动状态机和持久化 checkpoint，保证应用崩溃或重启后可恢复。所有真实网页操作都在本产品管理的 `WebContentsView` 中完成，不能静默启动另一个 Chrome/Playwright 浏览器 profile。

### 6.1 权限归属

权限权威必须是这个独立产品自身：

- 网站权限按 `profile + origin + capability` 存储；
- Agent 权限再细分为 read、act、download、upload、communicate、purchase 等动作；
- 操作系统仍会对摄像头、麦克风、文件夹等资源做最终授权，但授权对象是本产品；
- Password Manager、cookie 和 OAuth token 不直接暴露给模型；
- Agent 只可操作由本产品创建和登记的 webContents，不能发现或接管系统中其他浏览器窗口。

## 7. 安全模型是产品核心，不是附加功能

浏览器 Agent 的最大新风险是 **间接 Prompt Injection**。网页、邮件、广告、iframe、用户生成内容都可能携带试图改变 Agent 目标的隐藏指令。

最低安全基线：

1. **数据与指令分层**：页面内容永远标记为 untrusted data，不能提升为系统或用户指令。
2. **Planner 与 Critic 分离**：Critic 只看用户目标、动作元数据和权限，不读取未过滤网页正文。
3. **Origin Sets**：每个任务维护 read-only origins 与 read-write origins；新 origin 必须重新授权或通过受信 gate。
4. **秘密不进模型**：密码、cookie、token 由浏览器或 OAuth flow 使用，模型只得到成功/失败和必要的脱敏结果。
5. **后果分级**：发送消息、发布、购买、删除、授权、上传敏感数据必须确认。
6. **可见执行**：逐步日志、暂停、接管、取消；写操作前生成人可读 diff。
7. **能力令牌**：绑定 origin、动作、数据范围、有效期和 task id，默认一次性。
8. **可恢复性**：每一步 checkpoint；支持草稿优先、软删除、幂等 key 和补偿动作。

Google 为 Chrome Agent 描述的 User Alignment Critic 和 Agent Origin Sets，是目前最接近浏览器原生安全边界的公开方案；值得作为第一版设计基线，而不是只依赖模型“识别恶意提示”。

## 8. 仍然存在的硬边界

| 边界 | 影响 | 建议 |
|---|---|---|
| 本地文件系统和桌面 App | 纯 Web/Extension 无法通用操作任意本地资源 | 默认不支持；File System Access API 走用户授权。不要悄悄引入 Native Messaging |
| 长时后台任务 | MV3 service worker 非常驻，浏览器可能关闭 | 事件化 checkpoint；可选远端执行，但浏览器作为控制面 |
| 移动端 Extension | Chrome iOS/Android 的扩展能力与桌面不等价 | MVP 明确 desktop-first；移动端只做监督与确认 |
| 跨浏览器兼容 | Chrome 特有 API、WebMCP 尚未标准化 | 核心 contract 浏览器无关，适配层区分 Chromium / Firefox / Safari |
| CAPTCHA / 反自动化 | 技术和合规边界不稳定 | 交还用户，不把规避 CAPTCHA 作为平台能力 |
| Prompt Injection | 当前没有彻底解决方案 | origin 隔离、双模型检查、确认、最小权限、持续红队与评测 |
| 工具发现 | WebMCP 必须先访问站点 | 建目录，但运行时以 origin 上实际声明为准 |
| 网站条款 | 自动化可能违反目标网站 ToS | 提供域级政策、速率限制、禁用清单和企业审计 |

## 9. 建议的产品路线图

### Phase 0：定义不变的 Browser Skill Contract（1–2 周）

- 只定义 observe / navigate / act / invoke / permission / confirm / checkpoint；
- 定义动作风险等级、origin scope 和审计事件；
- 建立 30–50 个真实任务评测集，覆盖读取、跨站搬运、表单、下载、发送和购买前确认。

### Phase 1：独立 Electron Browser MVP（4–8 周）

- 独立安装包、地址栏、标签栏、Agent Panel；
- 当前标签/多标签上下文，全部基于应用内 WebContentsView；
- 自有 persistent profile、cookie jar 和权限中心；
- Accessibility/DOM 操作；
- WebMCP 探测与调用；
- 计划、逐步日志、暂停/接管；
- 默认只读，写操作逐项授权。

### Phase 2：Web API Adapter（4–8 周）

- OAuth 走应用内受信 WebContents 和标准 Web flow，凭据绑定本产品 profile；
- 首批只做 3–5 个高价值服务，每个 adapter 映射为 browser tool；
- 所有结果在浏览器中有可见 artifact，不做黑盒后台修改。

### Phase 3：工作流与生态

- 可复用 workflow/recipe，但 recipe 只编排 Browser Skill，不新增模型工具；
- 发布 origin tool manifest、权限说明和测试套件；
- 建立 WebMCP/DOM/vision 三层回归评测；
- 支持第三方 capability package 的签名、审核和最小权限安装。

### Phase 4：再决定是否迁移到 Chromium fork

Electron MVP 验证成功后，只有出现以下需求时才值得迁移到 Chromium fork：

- 需要内核级 origin gating、模型不可见数据过滤或受信 UI；
- 需要稳定控制多 profile、后台 tab 和下载沙箱；
- Electron 的扩展兼容、标签控制或进程隔离已成为可量化的核心瓶颈；
- 产品已经有足够留存，能承担浏览器更新、签名、企业部署与跨平台成本。

## 10. 最终判断

### 是否已经有原生捆绑浏览器的 Agent？

**有，而且很多。** Chrome、Edge、Opera Neon、Comet、Dia、BrowserOS 都属于不同程度的原生捆绑。

### 是否已经有真正统一的 AI-Native + Browser-Native Agent 平台？

**产品形态有，开放平台还没有。** WebMCP 是最接近的标准化方向，但目前仍早期；现有厂商的 Skills/Tools 大多封闭。

### “浏览器原生能力作为唯一 Skill”是否值得做？

**值得，但必须做成 Browser Kernel 抽象，而非纯点击 Agent。** 最有价值的差异化不是再做一个侧边栏聊天框，而是：

- 一个稳定的模型侧 Browser Skill contract；
- WebMCP / DOM / Vision 的可靠性降级链；
- origin-aware、read/write 分离的权限系统；
- Web API 和 Extension 都被收敛进浏览器能力边界；
- 所有行动可见、可暂停、可确认、可审计、尽量可恢复。

建议从独立 Electron Browser 开始验证，第一天就保证用户不需要启动外部浏览器；暂不做 Chromium fork。长期护城河应是 **Browser Kernel + 自有 profile/权限系统 + 可复用 workflow + 评测数据**，而不是 Chromium 外壳本身。

## 11. 补充架构决策：DSH 与浏览器音视频

后续核心 Agent Runtime 采用 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)：使用其 Cordis plugin、profile/bundle、Agent loop、SessionEvent log、tool pipeline 和 approval seam，但不修改 DSH core。产品通过稳定的 HarnessPort 隔离 DSH 内部类型，固定并验证版本，以签名双槽实现独立升级和自动回滚。DSH 当前处于 developer preview，不能在终端产品中直接跟随 `latest`。

音视频形成独立 Browser Media Engine：截图使用 Electron `capturePage` 或 CDP，连续页面帧使用 frame subscription / display media，WebGPU 负责 resize、crop、blur、redaction、frame diff 和合成，WebCodecs 或 MediaRecorder 负责编码。WebGPU 不是采集或编码 API，且必须具备 Canvas/MediaRecorder 降级路径。

完整设计参见：[Browser Agent 产品架构 v0.1](./product-architecture-v0.1.md)。

## 12. 主要来源

- [Chrome：WebMCP 概览、API、限制与安全模型](https://developer.chrome.com/docs/ai/webmcp)
- [Google Security：Agentic Chrome 的 Alignment Critic 与 Origin Sets](https://blog.google/security/architecting-security-for-agentic/)
- [Chrome Extensions 开发能力概览](https://developer.chrome.com/docs/extensions/develop)
- [Chrome Manifest V3 与 Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Electron：WebContentsView 与 Web Embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds/)
- [Electron：Chrome Extension 支持边界](https://www.electronjs.org/docs/latest/api/extensions/)
- [Electron：安全清单与远程内容隔离](https://www.electronjs.org/docs/latest/tutorial/security)
- [Microsoft：Browse with Copilot](https://support.microsoft.com/en-us/microsoft-copilot/browse-with-copilot)
- [Opera：Opera Neon / Browser Operator](https://press.opera.com/2025/05/28/opera-neon-the-first-ai-agentic-browser/)
- [Perplexity：Comet](https://www.perplexity.ai/grow/comet)
- [Dia：AI-native browser 与 Skills](https://www.diabrowser.com/download/thanks)
- [BrowserOS：开源 Chromium agentic browser](https://github.com/browseros-ai/BrowserOS)
- [Anthropic：Claude for Chrome 与 Prompt Injection 防护](https://www.anthropic.com/research/prompt-injection-defenses)
- [OpenAI：Atlas 发布说明及其当前弃用状态](https://openai.com/index/introducing-chatgpt-atlas/)
- [Microsoft Playwright MCP：Accessibility-based browser control](https://github.com/microsoft/playwright-mcp)
- [Chrome DevTools：Agent 连接个人 Chrome](https://developer.chrome.com/docs/devtools/agents/use-cases/auto-connect)
- [Browserbase Stagehand](https://docs.browserbase.com/welcome/quickstarts/stagehand)
- [Fellou：Agentic Browser 与 Computer Use 范围](https://fellou.ai/)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Electron webContents：截图与帧订阅](https://www.electronjs.org/docs/latest/api/web-contents/)
- [W3C WebGPU：GPUExternalTexture](https://www.w3.org/TR/webgpu/)
