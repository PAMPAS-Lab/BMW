# BMW

**Browser is boundary, media is native, web is runtime.**

BMW 是以浏览器为能力边界、以媒体为原生数据的桌面 Agent 工作区。一个 Project 管理网页、素材、视频草稿、文档和记忆；多个会话共享这些资源。浏览器操作与 Video Studio 手动编辑可在同一会话上下文中协作。

## 运行

需要 Node.js 24+。BMW Assistant 可选择 DSH、Codex 或 Qoder CN；各引擎使用官方运行时和独立认证配置。默认入口已装配三驱动；新 Profile 默认选择 DSH，之后按 Project 保存所选驱动。当前状态见 [PROJECT_STATUS.md](docs/PROJECT_STATUS.md)，分阶段验收和真实模型证据见 [实施记录](docs/history/agent-drivers/IMPLEMENTATION.md)。DSH 适配基线为 `0.2.1-rc.2`，Electron 为 `44.5.1`，Mediabunny 为 `1.61.0`。

```bash
git clone https://github.com/pampas-lab/BMW.git
cd BMW
npm ci
npm install -g @deepseek-ai/dsh@0.2.1-rc.2
npm start
```

DSH `0.2.1-rc.2` 为官方候选版（npm `next`）；本机已用该版与 `deepseek-flash` 完成[SI新闻](docs/research/DSH_SI_DELIVERY.json)及[科普／学术主片重制](docs/research/DSH_SCIENCE_RESEARCH_DELIVERY.json)。预设内使用官方上下文压缩，实际模型、成片、原声复用及验证范围分别登记，原Qoder版本保留。

上面的 DSH 安装只在使用该驱动时需要。`dsh` 必须位于 PATH；BMW 在自己的 `dsh-home` 安装预设，并在首次初始化时从 `DSH_HOME` 或 `~/.dsh` 复制已有普通 CLI 凭据，后续写入不修改原文件。无需先进入 DSH 界面配置模型，可在 BMW 登录框填写 DeepSeek API Key。Codex 通过公共 PATH、应用内 CLI 路径或 `BMW_CODEX_EXECUTABLE` 发现安装；Qoder 的官方 SDK/CLI 随依赖安装。切换 Assistant 驱动会读取认证；缺少凭据时自动打开登录框，可登录或改选其他驱动。DSH 提供 DeepSeek API Key，Codex 提供 ChatGPT 浏览器登录，Qoder CN 使用官方 CLI 浏览器授权。登录后只显示维护的支持名单中由官方目录提供的模型，点击“确认选择”保存；不要求用户发起模型验证或测试对话。Codex API Key 认证可由其独立 CLI 配置识别，BMW 当前没有 API Key 输入表单；未安装时显示安装状态。实际输入前仍自动验证唯一 `browser`。依赖版本由 `package-lock.json` 固定；首次启动自动构建。

产品使用 `BMW` Profile、`persist:bmw` Chromium 分区。引擎配置分别位于 Profile 的 `dsh-home`、`agent-drivers/codex`、`agent-drivers/qoder-cn`，模型上下文由各引擎保存；BMW 保存会话索引和显示历史。SDK 会话不要求出现在原生桌面侧边栏。系统钥匙串授权由用户自行完成。

隔离体验或测试必须使用临时 Profile：

```bash
BMW_USER_DATA_DIR=/tmp/bmw-disposable npm start
```

旧 Profile 升级前退出 BMW，按 [Agent 数据迁移](docs/AGENT_DATA_MIGRATION.md) 执行 `--plan` 和 `--apply`。迁移保留会话 ID、显示历史、模型选择、Studio 归属与素材，自动备份本次修改的元数据；旧格式不会在应用启动时自动转换。

## 主要能力

新闻速递可在Studio展开“新闻速递 · 选题与制作”，点击“推荐新闻选题”。Assistant核对近72小时的中美及全球AI消息，覆盖个人、公司机构、学术界和非AI人士的重要AI表态；最多推荐十题，不以旧闻凑数。优先推荐能直接观看变化的演示、同题作品对照、采访和演讲，并解释视频表达价值；纯文字公告也可用绑定来源版本的原页截图作为真实预览。查看原始来源与真实素材预览后，点击“选此题并制作”，同一Assistant再完成稿件、证据画面、配音字幕和新闻初稿。默认Qwen安明远男声，需先完成下方Qwen配置；新闻选题记录不等于事实、听感或内容验收。可退出选题，原素材与已有草稿保留。

NEWS-01已用BMW＋官方Codex完成54.61秒最新新闻并获用户接受，显式采用Qwen龙安朗男声；[验收记录](docs/research/CODEX_NEWS_REWORK.json)区分技术检查、Agent画面意见、人工声音反馈和最终接受。后续按新闻、科普、学术顺序改进，见[下一步计划](docs/plans/NEXT_STEPS.md)。

当前已包含手机原图阅读、句级卡片引用、素材索引与区间语音检索、原声转解说及录屏整理。正式全片分析支持2fps分页和选定区间8fps加密；视频支持720秒／96分镜、有界混音、原生文字包装和有限科学图解。专用 AI 图片／视频素材生成暂缓；当前范围见 [Studio 范围](docs/VIDEO_STUDIO_SCOPE.md)。

- 浏览器标签页、语义观察、页面交互、站点权限、后台取材、登录连续性和按 Project 保存的日常任务。
- 稳定 BMW Session 固定所属 Project 和驱动；按驱动保留原生续聊身份。不同驱动共享 Project 页面和媒体，会话切换保留独立历史；旧 DSH 身份由一次性迁移保留；日常启动不转换旧数据，原生 Workspace 映射只在对应 harness 内维护。
- 截图、页面媒体发现与下载、HTTP／有限 HLS VOD 分发资源保全、视频 Capture、录屏、媒体检查、抽帧、裁剪、缩放和 MP4/WebM 转换。视频采集记录源时间到成品 PTS 的逐帧映射，支持中段／尾段定位与尺寸切换留边；音频支持区间 WAV 技术证据和不自动播放的试听。
- Video Studio 在主窗口中切换工作区：素材收集、全局与分镜脚本、真实旁白、画面匹配、预览编辑和导出。
- 草稿强绑定所属会话：一个会话可有多个草稿，共享 Project 素材；切换会话切换可见草稿，无草稿显示空状态。支持删除草稿并保留素材与可恢复记录。
- 素材准备、匹配、工作台、封面和画面片段均支持真实图片／视频缩略图、放大预览与列表／图标切换；支持拖拽绑定、使用关系分组与时间轴定位。
- 类型制作提供新闻速递、综合科普、学术解释三类版本化指导，分段工作表、配方预览／显式采用和类型审阅表。来源作品／版本关系、句目标与原生改稿影响查询保存到2.10文档；重套模板保留既有编辑。新增事件联动、独立测量柱图／对数散点、有限分组和16格受限预合成；外部素材保留显式版本链。技术验证、三类样片、人工试听和观众理解分别验收，状态见[下一步计划](docs/plans/NEXT_STEPS.md)。
- Video Studio 默认把镜头卡片、脚本与预览放在一个工作台；高级编辑主动开启，使用全窗口资源／画布／属性／多轨，同一 Assistant 转为小浮框或停靠。两种视图共享 Video Document 2.0–2.10、保存与撤销；简洁编辑是可逆子集，独立图层／音轨／自由关键帧要求高级编辑，移除或撤销后可恢复简洁模式。支持主轨和独立图层／音轨、有限关键帧、整镜头分割、基础颜色／模糊和静音；参考抽样与逐项审阅按需使用，审阅标为可选测试功能。
- 已有 MP4 可直接查看、另存；视频内容和源素材未变时自动复用新版成片，支持明确重新制作。封面编辑不要求重新编码视频。
- 比例、分辨率、帧率、画面风格、水印、配乐及 TTS 设置与命名模板。显式参数优先于模板，模板优先于默认值。
- 旁白支持 Edge、Qwen TTS 和本地 Matcha。全局初始默认仍为 Edge 云希男声、0% 语速；Qwen 默认音色为新闻推荐的闻怀之，提供设置内加密保存凭据与试听。改变音色须重新生成已有音频。
- 页面录制事件与可编辑焦点、限定正文来源、准确原文引用、候选确认和有限下载／播放器采集；来源与冲突状态可导出核对。
- 固定 whisper.cpp base/small 语音证据、句／段校正与字幕、强调、板书共享锚点；自动句／词／字声学准确率未获批准。

本地语音安装：

```bash
NODE_USE_ENV_PROXY=1 npm run setup:local-tts
```

本地合成使用固定 Sherpa-ONNX WASM 与模型缓存，合成期间禁止网络。Edge 将旁白文本发送至固定 Microsoft 服务，可能因服务或网络不可用而失败。

### Qwen 配置与试听

1. 打开 BMW 的 **More → Settings → Media → Video narration**，勾选 **Allow Qwen online narration**。
2. 填写阿里云百炼北京地域的 **Workspace ID** 和 **API Key**，点击 **保存 Qwen 配置**。保存后立即生效，无需环境变量或重启。
3. 选择试听音色，点击 **生成并试听**。固定示例文本为“这里是新闻速递，为你播报今日要闻。”；生成期间可取消，完成后可反复播放；关闭设置会中止生成并释放试听音频。试听会消耗少量百炼额度。
4. 在 **Settings → 视频制作 → 旁白音色** 中选择 Qwen 并保存全局设置，或在 Studio 的视频设置中为当前草稿选择。试听选择不会修改视频默认音色，已有录音需重新生成才会改变。

固定模型为 `qwen-audio-3.1-tts-flash`，Qwen 默认 **闻怀之 `wenhuaizhi_v3.1`**、0% 语速，适合作为新闻速递的起始选择；另可选女声许言初 `xuyanchu_v3.1`、许玉远 `xuyuyuan_v3.1`，或男声安明远 `anmingyuan_v3.1`、霍拙石 `huozhuoshi_v3.1`、龙安朗 `longanlang_v3.1`、龙三叔 `longsanshu_v3.1`。Qwen 在线开关默认关闭，已有 Edge／本地设置和草稿保留；服务失败不会自动切换提供方。[音色与接口边界](docs/FUNCTIONAL_SPEC.md#qwen-tts-配置安全保存与试听)及[验证范围](docs/VERIFICATION.md#qwen-tts-验证范围)分别说明实现和验收限制。

API Key 与 Workspace ID 使用系统安全存储加密保存在当前 BMW Profile，Key 保存后不回显；再次保存时留空保留原 Key。系统安全存储不可用时拒绝保存，已有密文无法读取时保留原文件；可主动点击 **清除 Qwen 配置** 删除旧配置并关闭 Qwen。凭据只由原生配音层使用，不写入视频模板、Project 文档或模型上下文。

## 包边界

```text
apps/bmw ── product-bmw ── platform / feature-video
    │                          │
    ├── harness-dsh / harness-codex / harness-qoder ── agent-contract
    └── agent-ui ── agent-contract
                               │
platform ── agent-contract / browser-capability / media-native
feature-video ── browser-capability / media-native
```

`agent-contract` 定义官方后端生命周期、稳定 BMW Session、原生恢复身份、任务回执、设置及 BMW 上下文；三个 harness 各自实现官方协议、认证、目录准入和事件转换。默认入口注入三驱动装配，BMW Host 与自有 Assistant 协调会话和资源，核心不调用具体驱动 RPC 或读取原生桌面私有存储。Project、页面、媒体和 Studio 保持一份。

模型始终只有一个 `browser` 工具。Bridge 验证会话与 Project、串行执行操作，保护 Project 切换，并限制图像和媒体输出。没有聊天软件连接器、模型 shell 或任意本地文件能力。

当前媒体实跑已验证 Codex + GPT-6.1 的动作发现、Studio 子操作帮助与错误恢复，无需人工补充契约。原始保全指平台分发资源，不能认证作者母版；当前 Codex 登录路径的模型直接音频核听仍未完成。最新结果、Veo 尾帧归因限制及后续验收目标统一维护在 [项目进展](docs/PROJECT_STATUS.md)。

## 验证

```bash
npm run build
npm run check
npm test
npm run test:boundaries
npm run test:driver-e2e
npm run test:dsh-e2e
npm run test:desktop-e2e
npm run test:studio-e2e
npm run test:media-e2e
npm run test:video-e2e
npm run test:tts-e2e
```

当前完整离线基线为 **167 passed／0 failed／12 opt-in not-run**（2026-10-20）；构建、check及新闻、浏览器生命周期、DSH、desktop、Studio、media、video和narration检查通过，范围与源码指纹见[CURRENT](docs/verification/CURRENT.json)。测试使用一次性Profile，不计入付费模型或真实在线服务覆盖。已准备BMW＋DSH／DeepSeek Flash日常Project并通过实际只读连通；[使用流程](docs/AGENT_VIDEO_EDITING.md#日常新闻使用)与[就绪范围](docs/research/NEWS_DAILY_READINESS.json)明确选题确认、龙安朗和资源边界。已接受的43.03秒Chuck Lorre片保留，下一内容主线仍是科普、再学术。

局部改动默认先用下方 `test:plan` / `test:affected -- --files ...` 查看并执行本次范围；既有未提交工作不应混入本次文件列表。`verify:stability` 显式使用 `--all`，执行全部非 opt-in 分类；六项专用本地素材夹具和六项外部服务／模型测试仍需单独启用，不计为通过。完整串行验证：`npm run verify:stability`，并单独执行 `npm run check` 检查完整编译／Schema与生成文档一致性。完整入口构建一次，再执行源码／清单门禁、单元/边界及运行时回归；记录源码哈希、依赖版本和通过/失败/未执行结果。桌面工作区测试分为工作区、Project/会话（含实际重启）、设置、原生焦点/键盘四组；Studio 各专用环境分支另由分类目录逐项执行，单组失败不阻止其余组运行。新证据在 `.bmw-runtime/classified-tests/`，既有证据保留。

标准测试使用临时 Profile，不调用付费模型。含 build 的命令顺序执行；测试和 Action 变更后运行 `npm run docs:features`。

当前视频能力是受限分镜、多轨编辑与合成；不包含通用 NLE、任意 HTML 视频导入、安装器签名、自动升级或独立远控服务。透明视频可检查，实际 alpha 视频抽帧和转换明确拒绝。真实模型视觉复测的启用方式和适用范围见 [验证说明](docs/VERIFICATION.md)。

实现与边界见 [功能说明书](docs/FUNCTIONAL_SPEC.md)，开发入口见 [AGENTS.md](AGENTS.md)，当前工作状态见 [handoff.md](handoff.md)，验证方法见 [VERIFICATION.md](docs/VERIFICATION.md)。

## 模块接口与局部测试

[架构与接口保障](docs/ARCHITECTURE.md)定义 12 个模块（10 个产品包、应用组装、验证工具）、公开入口、依赖方向、10 项接口保障及 3 项具体实现／装配保障。源码依赖、接口测试及分类缺失会使检查失败。

```bash
npm run test:plan -- --files packages/browser-capability/src/renderer-read.ts
npm run test:affected -- --files packages/browser-capability/src/renderer-read.ts
npm run test:contracts
```

每个入口先串行构建一次，再按文件依赖与接口保障选择测试，并报告选择和排除原因。默认 `test:affected` 对比最后完整通过的源码哈希基线；删除、未知路径、共享配置或无法证明的动态导入会升级为全量离线测试。`--files` 使用仓库相对路径，表示调用者声明的改动范围。新报告位于 `.bmw-runtime/classified-tests/`，既有报告保留。

Browser 和 AgentBackend 的直接接口保障使用通用 driver 夹具，经真实 MCP/Bridge 操作 Project 页面。DSH 专有与产品装配回归单列；Browser 模型接口（Schema、目录、Bridge、MCP）单独改动不会自动启动 DSH，通用 Agent 契约、DSH 实现、产品组装及完整基线仍会验证它。

Shell 的全部请求验证来源、主框架和固定本地页面；损坏的权限、布局、登录保持配置与加密快照和 Project 一样提供保留原文件的重试/退出。共享测试辅助库改动会自动选择运行时消费测试；生产代码不能引用测试目录、验证工具或任意计算式模块加载。

### 截图标注与绘图

在 BMW Assistant 中可以要求“给当前页面截图，用红框标出按钮并写上说明”，或“绘制流程图并保存为 Project 图片”。Assistant 使用唯一 `browser` 工具：先 `media.screenshot` 或 `media.image.inspect` 获取素材与实际尺寸，再 `media.image.annotate` 标注；新建图解使用 `media.image.draw`。新 PNG 会作为图像回传，也可作为 Video Studio 素材，原图保留。

绘图支持框、椭圆、箭头、线条、路径、中文文字和不透明遮盖。坐标为实际图片像素；文字可设置字号、加粗、背景和折行宽度。原生执行限制和输入格式见 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md)。


## 文档入口

[文档导航](docs/README.md)分别索引当前规范、调研、后续设计和历史验收；[下一步设计](docs/plans/NEXT_STEPS.md)维护未完成事项。研究结论和旧阶段记录不代表当前能力。

## 仓库内容

- `apps/`：唯一 BMW 应用组合。
- `packages/`：产品、平台、Agent 契约、自有 Assistant、DSH/Codex/Qoder CN 驱动、浏览器、原生媒体与 Video Studio 实现及测试。
- `scripts/`：构建、文档清单、分类验证、隔离桌面和媒体工作流检查。
- `docs/`：功能说明、架构、当前状态、验证方法与合成视觉测试证据。

`node_modules`、生成的 JavaScript、运行日志、Profile、Project 素材、模型缓存和本机凭据由使用者本地维护，不纳入版本控制。迁移来源见 [MIGRATION_PROVENANCE.json](docs/MIGRATION_PROVENANCE.json)；旧多产品迁移归档不属于本仓库。

本地语音锚点研究使用 whisper.cpp 1.9.1（`whisper-cli`）与固定 base/small 缓存；可运行 `node --experimental-strip-types scripts/install-local-asr.ts` 安装模型。缓存不证明时间准确率。Studio 旁白面板支持原始识别证据、句级校正与锚点字幕；画面/旁白属性可按句绑定强调和标题卡板书揭示，共用预览、MP4 与来源清单，支持引用失效检查及撤销。用户已核听并采用十段 base 标注，保留 12 个可编辑片段的 ASR 来源与越界修正；这不构成独立声学金标，自动句／词／字准确率门仍未通过。验收范围见 [当前状态](docs/PROJECT_STATUS.md) 与 [P0 实施记录](docs/VIDEO_STUDIO_P0_IMPLEMENTATION.md)。

视频共享结构、迁移与权限见 [Video Document 2.0](docs/VIDEO_DOCUMENT_V2.md)，外部 Agent 调用见 [视频编辑接口](docs/AGENT_VIDEO_EDITING.md)。
