# 社媒素材采集截屏剪辑与视频二创 Skills 调研

社媒素材再加工需要衔接搜索、归档、真实截图、原片选段、剪辑与交付。上游优先关注 OpenCLI、CommentRadar 和 content-reader；下游优先关注 video-remix-workflow、cut-as-code 与中文口播剪辑方案。BMW 可借鉴来源记录、截图核验、选段计划和素材描述的交接方式，并通过现有 Project 素材与受限原生媒体能力承接流程。

| 项目 | 内容 |
|---|---|
| 整理日期 | 2026-10-08 |
| 调研快照 | 2026-10-06；7 个剪辑项目复用 2026-10-05 快照 |
| 覆盖范围 | 社媒内容采集与归档、真实页面截屏、视频抽帧、拆解与检索、现有素材剪辑、二创包装与导出 |
| 统计口径 | 54 个评估条目，52 个去重仓库，137 个相关 SKILL 文件入口 |
| 来源范围 | 本轮取得 44 个仓库的 219 份文档或源码；复用前轮 7 个项目；保留 1 个不可用仓库线索 |
| 证据等级 | 公开 README、SKILL 和重点脚本静态核对；没有安装试跑、社媒登录、付费调用或样片效果验证 |
| BMW 状态 | 专项调研与候选方案，不变更当前产品范围、工具目录或实施计划 |

本专题承接 [awesome-claude-video-skills](https://github.com/zhuyansen/awesome-claude-video-skills) 的视频制作技能调研，重点转向已有社媒素材的再加工。大型技能集合只抽取相关模块；平台适配副本、内部维护入口和不同版本不分别计为独立视频能力。54 个条目中，`mcncarl/yichen-skills` 按归档、X 切片与剪映三个功能分别评估，所以条目数大于仓库数。

优先级表示与本专题需求的匹配度。文档中的工具行为按所列快照描述，不能据此承诺当前平台可用性或生产效果；后续选型应通过真实素材验收。出处尽可能指向原仓库的提交快照，少数源链接仍为分支地址。

## 阅读导航

- [截图类型与判断标准](#截图类型与判断标准)
- [优先评估的十二个入口](#优先评估的十二个入口)
- [四条制作流程](#四条制作流程)
- [影响选型的源码发现](#影响选型的源码发现)
- [素材交接与去重](#素材交接与去重)
- [BMW 能力映射与适配建议](#bmw-能力映射与适配建议)
- [完整统一分析目录](#完整统一分析目录)
- [SKILL 文件入口索引](#skill-文件入口索引)

## 截图类型与判断标准

| 类型 | 实际产物 | 候选入口 | 需要保存的证据 |
|---|---|---|---|
| 真实网页或 App 页面截图 | 原帖、评论或界面当时的像素 | CommentRadar、OpenCLI、agent-browser、xhs-research-conductor、SeeCut 的 grab_evidence | URL、帖子或评论身份、截图时间、元素范围、正文完整性、是否有登录墙或弹窗 |
| 视频抽帧与缩略帧拼图 | 原视频中某个源时间的图像 | writing-agent-harness 的 video-highlight-select、ll-video-decomposer、video-shot-analysis-feishu、千川素材拆解 | 源素材身份、实际源时间、帧序号、采样方法与镜头区间 |
| 重排生成的图文卡片 | 将原文和原图重新设计的视觉资产 | yichen-x-slicer、image-text-layout-skill、social-media-cover | 原文与原图来源、渲染参数、卡片和原始证据的对应关系 |

重排卡片适合成片包装，不能替代原页面证据。少量视频关键帧也不能证明已观察整段动作或音频。`yichen-x-slicer` 的 PNG 属于重排卡片，其 MP4 可以嵌入所选帖子原生视频并保留原声；它不是 X 网页原样截图器。

## 优先评估的十二个入口

按工作流选择少量互补入口，先验证交接产物，再决定是否采用完整框架。以下是专题候选，并非 BMW 的安装清单。

| 任务 | 项目或入口 | 值得借鉴的能力 | 主要条件 |
|---|---|---|---|
| 国内社媒搜索与页面取材 | [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI/blob/24136945847afbfad266c6c46a8cd335377f9112/skills/opencli-browser/SKILL.md) | 站内搜索、正文或评论读取、部分平台媒体下载与浏览器截图 | 适配器、平台会话与下载依赖不同；采集后仍需统一来源记录 |
| 博主与评论截图素材库 | [HeiGeAi/HeiGe-CommentRadar](https://github.com/HeiGeAi/HeiGe-CommentRadar/blob/main/SKILL.md) | 元素截图、内容身份核验、CSV/JSONL、去重续跑与可选飞书导出 | 主要产出文字和截图；PolyForm NC 许可影响商业代码采用 |
| 链接转笔记与媒体 | [Jiaranbb/content-reader](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/bilibili-reader/SKILL.md) | 五个路由和平台技能保存 Markdown、媒体或逐字稿 | 默认笔记，需明确媒体意图；小红书真实登录态会停止；CC BY-NC 4.0 |
| 已知链接统一归档 | [mcncarl/yichen-skills](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-asr/SKILL.md) | content-archive 的 manifest、失败清单和标准交接 | 关键词发现由 unified-search 分担；公众号历史枚举已标不支持 |
| 小红书图片与文本库 | [chubbyguan/chubbyskills](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/bilibili-transcribe/SKILL.md) | 图片本地化、视频音轨转写、钩子分析和知识库管理 | 视频转写不等于完整原片归档；依赖解析、ASR 与外部接口 |
| 可追溯的原片选段 | [eriklee1895/writing-agent-harness](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/article-video-clip/SKILL.md) | ingest、缩略帧拼图、候选选段、clip 三段接力 | 人或 Agent 决定起止；不自动完成高光识别或字幕 |
| 评论与解说二创 | [macong0420/video-remix-workflow](https://github.com/macong0420/video-remix-workflow/blob/7b3103919a8a6e61fed68606125bea101594393a/SKILL.md) | 来源库、增量观点、分镜、素材清单和可校验 render_plan | 下载和转写另配；TTS 默认不启用；流程有确认阶段 |
| 可修改的现有视频剪辑 | [WhiteTowerAI/cut-as-code](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/cut-as-code/SKILL.md) | 文件表达剪辑决策，组合字幕、B-roll、卡片、调色和 shorts | 需要本地素材与执行依赖；社媒采集在上游 |
| 中文口播与长视频转短片 | [maxazure/video-editing-skill](https://github.com/maxazure/video-editing-skill/blob/87798462eb0f946104da3d67d0f92cb4406e8c18/SKILL.md) | 语义清稿、停顿处理、字幕与多源 B-roll | 需以真实中文样本验证识别、切口、竖裁与字体 |
| 可检索与复用的素材描述 | [UditAkhourii/cdaf](https://github.com/UditAkhourii/cdaf/blob/e5620646312753bda5eaa7a1305c32c20af0fd6d/skills/claude-code/cdaf/SKILL.md) | 带时间戳的描述 sidecar 与文件 hash 绑定 | hash 用于精确文件身份与过期检查；不等于近似画面去重 |
| X 帖子转图文视频 | [mcncarl/yichen-skills#yichen-x-slicer](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-x-slicer/SKILL.md) | 3:4 图片、ZIP 和含所选原生视频及原声的 MP4 | 重排卡片；无 TTS/BGM；不处理引用帖内容与他人回复 |
| 口播与真实网页证据动效 | [YeJe-cpu/SeeCut](https://github.com/YeJe-cpu/SeeCut/blob/75c6ca3c6ec00872ba03e8741b9a14df60dc6195/skill/seecut/SKILL.md) | 网页截图、证据卡片、弹字、MP4 和分层工程 | 审片依赖 Antigravity/agy，无对应降级；剪映引擎可选 |

## 四条制作流程

### 国内社媒证据解说

`OpenCLI / CommentRadar → content-reader / chubbyskills → ll-video-decomposer → video-remix-workflow / cut-as-code`

先保存帖子、评论、原图和必要原视频，再把论点对应到真实截图或原片源时间。新增自己的解释和观点，编排引用片段、原声或旁白、字幕与来源标注。这条流程适合产品评论、科技热点、教程和案例复盘。

### 长视频拆成短片

`ytdlp-ops / content-reader → claude-shorts / maxazure → 剪辑导出`

保存原片和带来源的转写时间戳，由人或 Agent 选出语义完整的区间，再校验切口、画幅和字幕。录屏应优先保证文字可读性。`viral-clip-editor` 可以执行已有选段计划，但计划缺失时会停止等待；它的每段固定裁切也不能当作动态人物跟踪。

### 评论与帖子截图视频

`CommentRadar / OpenCLI → 截图来源表 → SeeCut / video-remix-workflow`

用真实评论截图展示具体观点，与自己的录屏或口播组合。保留必要上下文，裁图和美化结果另存副本。只处理公开 X 帖子时，`yichen-x-slicer` 可单独完成重排图片与原生视频嵌入成片。

### 多项目素材检索与复用

`yichen-content-archive / video-material-ingest → CDAF 或 VideoDB → cut-as-code / 剪辑执行器`

采集层保存源链接、媒体与 manifest；理解层保存可搜索描述和转写；剪辑层引用资产身份与源区间。源文件变化后旧描述失效。CDAF 偏本地旁置文件，VideoDB 是云服务，需分别评估数据导入、服务成本和 HLS/MP4 导出形式。在 BMW 内采用这些思路时仍应按 Project 管理资源；跨 Project 共享属于另行评估的范围。

这些组合基于公开接口和产物提出，尚未做组合运行验证。各项目的 JSON 字段、目录、时间基和依赖需要转换，安装多个技能不意味着它们能够直接串联。

## 影响选型的源码发现

| 项目 | 静态核对结论 | 对选型的影响 | 原始来源 |
|---|---|---|---|
| eligapris/viral-clip-editor-skill | pipeline.py 缺少 clip_plan.json 时提示 Agent 创建计划并重跑；smart_crop.py 给每段返回一个固定 crop_x | 有下载、转写、裁切和字幕执行器，但选段依赖外部决策，裁切不是动态跟踪 | [pipeline.py](https://github.com/eligapris/viral-clip-editor-skill/blob/b2cd0c0e00230a314ad9969edcb19bce00b2f151/scripts/pipeline.py)、[smart_crop.py](https://github.com/eligapris/viral-clip-editor-skill/blob/b2cd0c0e00230a314ad9969edcb19bce00b2f151/scripts/smart_crop.py) |
| mcncarl/yichen-skills#yichen-x-slicer | FxTwitter 取帖数据，Playwright 渲染重排卡片，FFmpeg 合成所选原生视频与原声 | 归入图文重排与包装，不归入原页面截图 | [SKILL](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-x-slicer/SKILL.md) |
| HeiGeAi/HeiGe-CommentRadar | 截图按评论文本与作者核验元素；storage.mjs 读取 JSONL 唯一键 | 真实元素截图与去重库有实现，站点选择器仍需运行验证 | [SKILL](https://github.com/HeiGeAi/HeiGe-CommentRadar/blob/main/SKILL.md)、[storage.mjs](https://github.com/HeiGeAi/HeiGe-CommentRadar/blob/main/storage.mjs) |
| macong0420/video-remix-workflow | render_remix.py 有实际计划校验和 FFmpeg 渲染逻辑 | 可借鉴二创流程与结构化渲染计划；下载、转写和配音是独立依赖 | [render_remix.py](https://github.com/macong0420/video-remix-workflow/blob/7b3103919a8a6e61fed68606125bea101594393a/scripts/render_remix.py) |
| anbeime/skill | image_generator 生成纯色占位图，音乐和音效存在占位回退；部分脚本出现内置凭据样式字符串 | 采用前须补齐真实实现与凭据配置；不复制相关字面量 | [image_generator.py](https://github.com/anbeime/skill/blob/5094637f62bcb9f66f607044b41ca9258837ede6/skills/video-recreation/video-recreation/scripts/image_generator.py) |
| danasong/douyin-downloader-skill | 公开技能指向作者本机绝对路径的私有下载器，文件树没有该执行器 | 只能借鉴流程，不能当作下载即可运行的技能 | [SKILL](https://github.com/danasong/douyin-downloader-skill/blob/28e61d3bd14dadec6f6c61e74069f1eeeace91ed/skills/douyin_downloader/SKILL.md) |
| Francis-Xavier-code/tiktok-douyin-dl | 快照 README 明示关闭下载功能并停止维护 | 旧搜索缓存中的下载承诺不应纳入可用能力 | [README](https://github.com/Francis-Xavier-code/tiktok-douyin-dl/blob/7f637fad064853baa0899d7b0ee3623bff45ca13/README.md) |
| lovensky1992-wk/content-collector | SKILL 引用 cache-wechat-images.sh、post-collect.sh 等配套脚本，取得的树中未见这些脚本 | 收藏体系可参考，完整自动化需补齐环境 | [SKILL](https://github.com/lovensky1992-wk/content-collector/blob/793e08be95b0a663ffe4576c5c258ff8920d60f2/SKILL.md) |
| mcncarl/yichen-skills#yichen-jianying-edit | 需要匹配剪映版本和独立核心项目；根 README 提示 private core checkout | 公开技能不是完整独立后端；草稿编辑与渲染导出要分别验收 | [SKILL](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-jianying-edit/SKILL.md) |
| UditAkhourii/cdaf | 描述缓存绑定 SHA-256 和字节数，语义索引带时间戳 | 文件变更检查不能当作感知去重；推测的段落边界不能替代准确剪辑切口 | [SKILL](https://github.com/UditAkhourii/cdaf/blob/e5620646312753bda5eaa7a1305c32c20af0fd6d/skills/claude-code/cdaf/SKILL.md) |

## 素材交接与去重

技能之间最值得统一的是资产身份、来源证明和源时间与输出时间的映射。原件与处理副本分别保存，才能重新剪辑、核对出处和判断描述是否过期。

| 对象 | 建议保留的信息 | 用途 |
|---|---|---|
| 来源记录 | source_id、平台、content_id、canonical_url、作者、发表时间、采集时间、标题、获取状态 | 内容 ID 去重、失败重试、链接失效追踪；发表与采集时间分别保存 |
| 原始媒体 | Artifact 或资产 ID、SHA-256、字节数、原片/原图/音轨、实测时长、轨道范围、fps、分辨率、语言 | 字幕和描述绑定精确文件；下载成功与实际解码分别记录 |
| 网页证据 | 原始截图、URL、内容身份、截取时间、页面或元素定位、完整性状态、可选 OCR | 回溯到具体帖子或评论；重排卡片保留独立类型 |
| 视频证据 | 抽帧与源时间、采样方式、镜头区间、原始 ASR 或字幕、语义描述 sidecar | 找到可复用的源秒数；识别时间戳和人工校正分别保存 |
| 剪辑决策 | 资产 ID、source_start/end、output_start/end、用途、原声/配音策略、裁切、字幕与来源展示 | 调整素材后仍能核对画面、字幕与旁白的时间映射 |
| 成片与使用状态 | 草稿/成片身份、结构化计划或应用草稿、执行依赖、质检帧、来源与许可备注、使用历史 | 区分已获取、已分析、已选用、已渲染和已审片，保留再次编辑入口 |

去重分为三个层次：平台内容 ID 防止同一帖子重复采集；文件散列识别相同字节与过期描述；感知画面、音频或语义相似性帮助发现跨平台转载与不同编码版本。调查中的多数技能覆盖前两层，尚未核实通用的跨平台感知去重实现。

代码许可与被采集素材的使用条件是不同记录。CommentRadar 的 PolyForm NC、content-reader 的 CC BY-NC 4.0 会影响代码采用；项目内的原片使用比例阈值只属于其编辑策略，不能作为素材许可依据。

## BMW 能力映射与适配建议

BMW 能力映射基于 2026-10-08 的本地实现提交 `fba94c3`，参考该基线的功能说明书、Video Document 2.0、视频编辑接口与 Studio 范围。该视频功能提交尚未包含在本调研分支，因此这里的本地能力基线可能先于 GitHub main。当前发布范围以仓库的 [功能说明书](../FUNCTIONAL_SPEC.md) 和 [Studio 范围](../VIDEO_STUDIO_NEXT.md) 为准。下面的“建议”是候选设计，不表示功能已实现或已批准开发。

### 现有能力与候选补充

| 专题能力 | BMW 当前可承接的能力 | 候选补充与验收重点 |
|---|---|---|
| 来源采集与归档 | 同一 browser 内限定正文和媒体范围；Project 来源、获取记录、原文 Artifact/SHA 与候选确认 | 借鉴站点适配与标准 manifest，评估平台 content_id、作者身份和失败续做；禁止将全页推荐内容混入正文 |
| 原图与原视频获取 | 页面媒体发现、有限下载、已确认播放器 capture、实际媒体解码与证明核对 | 保留平台原时长、播放器区间、采集终止原因与文件时间域；partial-preview 与 decoded-file 不作为平台全长证明 |
| 真实页面截图 | viewport/selector 截图产生 Project PNG；图片标注另存副本 | 借鉴 CommentRadar 的文本与作者身份核验，保存原帖/评论和截图的关系；检验遮挡、截断和错误元素 |
| 视频抽帧与参考分析 | media.frames.sample；Studio 参考记录绑定源/帧 SHA、字节数和实际源时间 | 借鉴缩略帧拼图和候选选段清单；新检索描述应随源文件变化失效，仍需准确取帧复核 |
| 长转短与解说二创 | 受限分镜、多轨、剪裁、字幕、原声/旁白、封面和 MP4；两种编辑视图共用视频文档 | 借鉴结构化选段/剪辑计划与来源交接，映射到现有 schema，不导入任意外部渲染脚本 |
| 语义素材检索 | 已有 Project 素材与按需参考分析记录 | CDAF 的旁置描述可作设计参考；可搜索语义库与感知去重应单独定义，不声称现有参考记录已具备全库检索 |
| 交付与追溯 | 成片、封面、字幕及来源清单；引用核对与文件可用性状态 | 将已采集/已选用/已渲染的状态明确展示；来源失效、字幕漂移与源区间越界可回溯 |

### 适配边界

第三方技能常依赖 shell、Python、FFmpeg CLI、Playwright、额外 MCP 或云端 SDK。BMW 应复用其流程与数据契约，通过既有 browser 动作和受限宿主媒体实现承接，不能直接把这些执行入口加入模型工具目录。

- 模型保持唯一 `browser` 工具，由认证 Bridge 核验 Project、Session、权限、FIFO、取消与 revision。
- 页面、来源、截图、原片和派生素材由 Project 管理；草稿保持所属 Session 与版本保护。
- 媒体能力遵守 Mediabunny、WebCodecs、Canvas/WebAudio 等现有边界，不开放模型 shell、任意文件路径、凭据或 cookie 读取、Electron IPC 与 FFmpeg CLI。
- HTML/HyperFrames、第三方剪映草稿、BaoCut 应用控制不能直接当作已支持的 BMW 输入；需要独立适配研究。
- 外部语义服务、付费 API 和飞书写入属于不同依赖和数据流，不随技能安装自动启用。
- UI/工作流优化和专用 AI 图片/视频生成仍按当前 Studio 范围处理，本专题没有解除暂停或扩大产品范围。

### 后续试验建议

首先验证一条限定任务：同一平台的若干公开帖子或已知链接，保存正文、原图、评论真实截图和一段明确区间的原片，制作可修改的解说短片。评价来源能否核验、媒体是否实际可用、时间是否对齐和成片能否重新编辑。

| 试验 | 候选参考 | 需要验收的结果 |
|---|---|---|
| 社媒采集与评论截图 | OpenCLI、CommentRadar、content-reader | 原文范围正确，截图对应内容和作者，登录墙/部分采集不误报成功，失败可续做 |
| 已有素材的短片二创 | video-remix-workflow、cut-as-code、maxazure | 每段有源身份与源区间，中文字幕与原声/旁白一致，修改后可复用原件重新导出 |
| 素材描述与检索 | writing-agent-harness、CDAF | 可以从描述定位到原片具体秒数，源文件变更使旧描述失效，不把推测切口当作准确边界 |

上述试验需另行选择真实样本与执行范围；本次只归档研究，不安装技能或执行外部项目。

## 完整统一分析目录

每个条目使用相同的采集、截图、剪辑、产物、依赖、限制与证据维度。条目编号沿用专题数据，分组顺序不代表质量排名。默认均没有样片运行验证，具体证据类型见每条记录。

### 采集与归档

共 18 个评估条目。

#### 条目 01 jackwener/OpenCLI

[仓库](https://github.com/jackwener/OpenCLI) · [主要证据](https://github.com/jackwener/OpenCLI/blob/24136945847afbfad266c6c46a8cd335377f9112/skills/opencli-browser/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书、B站、X 等多平台 |
| 采集与归档 | 站内搜索、正文/评论提取；部分平台图片/视频下载；结构化输出 |
| 截图与抽帧 | 真实浏览器截图命令；可补页面证据 |
| 剪辑与再加工 | 采集基础设施，剪辑需下游工具 |
| 输出产物 | JSON/Markdown、媒体文件、截图 |
| 依赖与成本条件 | Node ≥20.18.1、桌面服务或 Chrome 扩展；视频下载需 yt-dlp |
| 限制与采用条件 | 适配器与登录态影响覆盖；截图与结构化 DOM 是不同产物 |
| 证据 | README + SKILL，未运行 |

#### 条目 03 Panniantong/Agent-Reach

[仓库](https://github.com/Panniantong/Agent-Reach) · [主要证据](https://github.com/Panniantong/Agent-Reach/blob/a19a171fa980a0785849596492e0af4db800c82f/agent_reach/skill/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 多平台 |
| 采集与归档 | 检查并路由 OpenCLI、平台 CLI、yt-dlp 等工具 |
| 截图与抽帧 | 沿用底层工具能力 |
| 剪辑与再加工 | 上游访问/搜索入口 |
| 输出产物 | 内容、字幕、候选链接 |
| 依赖与成本条件 | Python、按渠道配置的外部 CLI/MCP |
| 限制与采用条件 | 主要负责渠道配置与路由，不能把聚合入口视为独立采集/剪辑引擎 |
| 证据 | README + SKILL，未运行 |

#### 条目 04 Jiaranbb/content-reader

[仓库](https://github.com/Jiaranbb/content-reader) · [主要证据](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/bilibili-reader/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书、X、YouTube、B站 |
| 采集与归档 | 5 个技能路由；正文/图片/逐字稿入库；显式需要时下载原视频 |
| 截图与抽帧 | 可编排浏览器读取和 OCR；非专用截图流水线 |
| 剪辑与再加工 | 素材供料与知识整理 |
| 输出产物 | Markdown 笔记、本地图片/媒体、时间戳逐字稿 |
| 依赖与成本条件 | Agent 浏览器；yt-dlp/FFmpeg；可选 faster-whisper |
| 限制与采用条件 | 小红书 skill 遇真实登录态会停止；默认仅保存笔记；仓库 CC BY-NC 4.0 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 05 chubbyguan/chubbyskills

[仓库](https://github.com/chubbyguan/chubbyskills) · [主要证据](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/bilibili-transcribe/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书、抖音、B站 |
| 采集与归档 | xiaohongshu-ingest 图片本地化；视频取音频转写；配知识库管理 |
| 截图与抽帧 | 保存笔记原图；不等于帖子页面截图 |
| 剪辑与再加工 | 钩子拆解、衍生选题、知识库搜索/整理 |
| 输出产物 | frontmatter Markdown、.assets、文字稿、选题 |
| 依赖与成本条件 | FFmpeg、FunASR/SenseVoice；分析用 DeepSeek key；可选 XHS_COOKIE |
| 限制与采用条件 | 小红书视频路线默认抽音频转写，不应宣称已经归档完整原视频；页面解析可能失效 |
| 证据 | README + SKILL，未运行 |

#### 条目 06 yuwanpai2004-create/codex-skills

[仓库](https://github.com/yuwanpai2004-create/codex-skills) · [主要证据](https://github.com/yuwanpai2004-create/codex-skills/blob/8cb6f9c700819d0c4fdbbdaee76f4d9e2eb1a1f7/skills/product-video-pipeline/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书、抖音、微博 |
| 采集与归档 | social-corpus-harvest：核验账号→预检→采集本人公开文字和元数据；支持 refresh |
| 截图与抽帧 | 未见专用截图导出 |
| 剪辑与再加工 | 文本语料归档、风格分析供料 |
| 输出产物 | Markdown、账号映射、source_manifest |
| 依赖与成本条件 | Python、OpenCLI/Browser Bridge |
| 限制与采用条件 | 默认不下载音视频、不采他人评论；refresh 是重新采集，不能当作完整媒体增量同步 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 07 zczxd1118/content-catcher

[仓库](https://github.com/zczxd1118/content-catcher) · [主要证据](https://github.com/zczxd1118/content-catcher/blob/3705eddc07c068d93e0754ab83dfb3b2b9c9d1fb/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | B站、YouTube、小宇宙、小红书等 |
| 采集与归档 | 长内容转笔记；批量专题/对比；订阅历史避免重复；XHS 图片素材包 |
| 截图与抽帧 | 下载笔记图片，非网页原样截图 |
| 剪辑与再加工 | 总结/蒸馏、主题对比 |
| 输出产物 | 原文/投喂包/笔记、专题文档；可选 EPUB |
| 依赖与成本条件 | Python、yt-dlp、FFmpeg、faster-whisper；自动分析可接 LLM API |
| 限制与采用条件 | 默认处理笔记/音频文字，不是剪辑器；自动模式会调用外部模型，不能一概声称内容不出机 |
| 证据 | README + SKILL，未运行 |

#### 条目 08 lovensky1992-wk/content-collector

[仓库](https://github.com/lovensky1992-wk/content-collector) · [主要证据](https://github.com/lovensky1992-wk/content-collector/blob/793e08be95b0a663ffe4576c5c258ff8920d60f2/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 网页、微信文章、B站、小红书/抖音视频等 |
| 采集与归档 | 收藏去重、主题标签、文章插图、Obsidian 同步 |
| 截图与抽帧 | 图片缓存为工作流要求 |
| 剪辑与再加工 | 从收藏库按选题筛素材，交给其他技能二创 |
| 输出产物 | 收藏笔记、索引、Daily Note |
| 依赖与成本条件 | 部分脚本、Supadata API、Obsidian 配置 |
| 限制与采用条件 | SKILL 引用多份 .sh 脚本，但本次文件树没有这些脚本；需补齐配套环境再采用 |
| 证据 | README + SKILL，未运行 |

#### 条目 09 mcncarl/yichen-skills

[仓库](https://github.com/mcncarl/yichen-skills) · [主要证据](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-asr/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | X、小红书、抖音、微博、YouTube/B站等 |
| 采集与归档 | yichen-content-archive 处理已知链接/清单；yichen-unified-search 单独做发现 |
| 截图与抽帧 | 归档原图/媒体；网页截图需其他工具 |
| 剪辑与再加工 | 严格区分发现、读取、下载、归档；可连接 ASR |
| 输出产物 | archive-manifest.jsonl、summary、failures、handoff、媒体 |
| 依赖与成本条件 | Python/Node、平台执行器；部分渠道 OpenCLI/其他 CLI |
| 限制与采用条件 | 归档模块不做关键词搜索；公众号历史枚举已标 unsupported；不能把整个包当无约束爬虫 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 10 redfox-data/redfox-community-dsh

[仓库](https://github.com/redfox-data/redfox-community-dsh) · [主要证据](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-keywords-accounts/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 抖音、小红书、快手、B站、微博、YouTube、TikTok 等 |
| 采集与归档 | 多平台搜索、账号/作品数据；部分模块批量下载到本地，部分仅返回解析直链 |
| 截图与抽帧 | 多为封面/媒体或数据报告，非真实页面截图 |
| 剪辑与再加工 | 趋势、评论、账号诊断供料 |
| 输出产物 | JSON/HTML、解析链接、部分本地视频 |
| 依赖与成本条件 | REDFOX_API_KEY；DSH 插件含 MCP；对应 Python 脚本 |
| 限制与采用条件 | 第三方数据服务，需核对额度；本次只抽样相关模块；直链返回不等于已下载 |
| 证据 | README + SKILL，未运行 |

#### 条目 11 43COLLEGE/43-Agent-skills

[仓库](https://github.com/43COLLEGE/43-Agent-skills) · [主要证据](https://github.com/43COLLEGE/43-Agent-skills/blob/385773aecd59e38e1d82e8237e122baec1b685a7/social-media-scout/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 抖音、TikTok、小红书、微博、B站等 |
| 采集与归档 | social-media-scout 用 TikHub API 查询、搜索、解析；客户端支持下载文件 |
| 截图与抽帧 | 数据与媒体链接；未见截图编排 |
| 剪辑与再加工 | 跨平台素材发现 |
| 输出产物 | JSON 数据、候选/媒体 |
| 依赖与成本条件 | TikHub key；Python；MCP 代理可退 REST |
| 限制与采用条件 | 接口是否稳定、媒体能否下载需逐平台验证；接口数量是作者说明，未逐项测试 |
| 证据 | README + SKILL，未运行 |

#### 条目 12 jackwener/xiaohongshu-cli

[仓库](https://github.com/jackwener/xiaohongshu-cli) · [主要证据](https://github.com/jackwener/xiaohongshu-cli/blob/4d63f3c0c85ccd9054fa8e96d7f761aaf2507449/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书 |
| 采集与归档 | 搜索笔记/账号、正文/评论、结构化 JSON/YAML |
| 截图与抽帧 | 不是专门网页截图器 |
| 剪辑与再加工 | 用于发现和读取 |
| 输出产物 | 结构化内容/互动数据 |
| 依赖与成本条件 | Python CLI；浏览器 Cookie 或二维码会话 |
| 限制与采用条件 | 主要是平台操作 CLI；完整原视频归档和剪辑需另配；本次未使用用户登录态 |
| 证据 | README + SKILL，未运行 |

#### 条目 13 jackwener/bilibili-cli

[仓库](https://github.com/jackwener/bilibili-cli) · [主要证据](https://github.com/jackwener/bilibili-cli/blob/dbe28551930df43b633baa52e9639832aeada967/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | B站 |
| 采集与归档 | 搜索、用户投稿、视频详情、字幕等 |
| 截图与抽帧 | 未见专用截图流水线 |
| 剪辑与再加工 | 字幕与元数据供料 |
| 输出产物 | 结构化数据、字幕/音频相关产物 |
| 依赖与成本条件 | Python CLI；部分功能需要会话 |
| 限制与采用条件 | CLI 读取能力与高画质媒体下载分开评估，不能承诺匿名固定分辨率 |
| 证据 | README + SKILL，未运行 |

#### 条目 14 jackwener/twitter-cli

[仓库](https://github.com/jackwener/twitter-cli) · [主要证据](https://github.com/jackwener/twitter-cli/blob/7c634e0d396b1e7af9f63315b414925fe4f29ae7/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | X/Twitter |
| 采集与归档 | 时间线、搜索、书签、帖子/回复数据 |
| 截图与抽帧 | 非帖子截图器 |
| 剪辑与再加工 | 内容发现与素材索引 |
| 输出产物 | JSON/YAML、帖子数据 |
| 依赖与成本条件 | Python CLI、Cookie 会话 |
| 限制与采用条件 | 私人书签导出和公开搜索是不同输入范围；原视频/截图需下游 |
| 证据 | README + SKILL，未运行 |

#### 条目 15 jackwener/weibo-cli

[仓库](https://github.com/jackwener/weibo-cli) · [主要证据](https://github.com/jackwener/weibo-cli/blob/ea2e86e0b3c9fb4120660529a60ed7a44b2b90bb/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 微博 |
| 采集与归档 | 搜索、热榜、用户/个人数据查询 |
| 截图与抽帧 | 未见截图编排 |
| 剪辑与再加工 | 微博选题供料 |
| 输出产物 | 结构化数据 |
| 依赖与成本条件 | Python CLI、对应认证环境 |
| 限制与采用条件 | 平台读写 CLI，不能等同多媒体二创系统 |
| 证据 | README + SKILL，未运行 |

#### 条目 16 0xDarkMatter/claude-mods

[仓库](https://github.com/0xDarkMatter/claude-mods) · [主要证据](https://github.com/0xDarkMatter/claude-mods/blob/24ac6d11c75db238a3f4338b35cbb4ad3a9be1dc/skills/ytdlp-ops/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | yt-dlp 支持的网站 |
| 采集与归档 | ytdlp-ops：格式选择、字幕、分段下载、播放列表/频道 archive 同步 |
| 截图与抽帧 | 不提供网页截图 |
| 剪辑与再加工 | 给 FFmpeg 后端供料 |
| 输出产物 | 视频/音频、字幕、元数据、下载历史 |
| 依赖与成本条件 | yt-dlp、FFmpeg；完整 YouTube 提取可能需要 JS runtime |
| 限制与采用条件 | download-archive 主要按平台 ID 去重，不是内容相似去重；精确切口通常仍需本地重编码 |
| 证据 | README + SKILL，未运行 |

#### 条目 17 davidtoby/agent-skills

[仓库](https://github.com/davidtoby/agent-skills) · [主要证据](https://github.com/davidtoby/agent-skills/blob/9c6dececf1efb723ea716d09d1d13b3e69c83798/skills/curated/video-transcription-subtitle-workflows/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | YouTube、X 等 |
| 采集与归档 | video-transcription-subtitle-workflows：元数据、字幕去重/归一、ASR 回退 |
| 截图与抽帧 | 未提供专门截图器 |
| 剪辑与再加工 | 转写前处理 |
| 输出产物 | 带时间戳的字幕/文字稿 |
| 依赖与成本条件 | yt-dlp、FFmpeg、Whisper |
| 限制与采用条件 | 以技能说明为主；非完整媒体资产管理或剪辑工具 |
| 证据 | README + SKILL，未运行 |

#### 条目 18 franciscobmacedo/postreef-skills

[仓库](https://github.com/franciscobmacedo/postreef-skills) · [主要证据](https://github.com/franciscobmacedo/postreef-skills/blob/3664fa2a80ac353a6dab2541a7210eb8d0dfe87c/skills/yt-dlp-troubleshooting/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | YouTube、TikTok、Instagram 等 |
| 采集与归档 | yt-dlp-troubleshooting 排查下载问题 |
| 截图与抽帧 | 无专用截图 |
| 剪辑与再加工 | 辅助采集故障定位 |
| 输出产物 | 诊断步骤；可选 PostReef 服务结果 |
| 依赖与成本条件 | yt-dlp；可选收费 API |
| 限制与采用条件 | 故障指南不是下载器；其中服务兜底与本地免费路线应分开计成本 |
| 证据 | README + SKILL，未运行 |

#### 条目 53 JimLiu/baoyu-skills

[仓库](https://github.com/JimLiu/baoyu-skills) · [主要证据](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-url-to-markdown/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 网页、X、YouTube |
| 采集与归档 | baoyu-url-to-markdown/baoyu-danger-x-to-markdown/baoyu-youtube-transcript 供料 |
| 截图与抽帧 | 网页正文/原图、YouTube 封面；非完整社媒页面截屏库 |
| 剪辑与再加工 | 抓取、逐字稿与封面，后续剪辑独立 |
| 输出产物 | Markdown、字幕/文字稿、图片 |
| 依赖与成本条件 | baoyu-fetch/Chrome 或对应平台脚本；按模块配置 |
| 限制与采用条件 | 本机已有相关技能；适合作为小型供料工具；X 模块采用非官方接口并有自身使用门槛 |
| 证据 | README + SKILL，未运行 |

### 截图与素材选择

共 5 个评估条目。

#### 条目 02 vercel-labs/agent-browser

[仓库](https://github.com/vercel-labs/agent-browser) · [主要证据](https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 通用网页 |
| 采集与归档 | 打开、导航、提取可见内容；可保持会话状态 |
| 截图与抽帧 | 网页截图与浏览器录像 |
| 剪辑与再加工 | 为素材采集提供浏览器底座 |
| 输出产物 | 页面数据、截图、录屏 |
| 依赖与成本条件 | agent-browser CLI 与浏览器运行环境 |
| 限制与采用条件 | 需自行规定帖子定位、完整性检查和归档字段；没有现成社媒素材库 |
| 证据 | README + SKILL，未运行 |

#### 条目 19 HeiGeAi/HeiGe-CommentRadar

[仓库](https://github.com/HeiGeAi/HeiGe-CommentRadar) · [主要证据](https://github.com/HeiGeAi/HeiGe-CommentRadar/blob/main/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书、抖音、B站 |
| 采集与归档 | 监控指定博主新内容、热门评论；CSV/JSONL 去重续跑，飞书可选 |
| 截图与抽帧 | 内容、评论元素、主页三类真实截图；评论与作者/内容核验 |
| 剪辑与再加工 | 把评论沉淀成选题素材 |
| 输出产物 | CSV/JSONL、截图、可选飞书附件 |
| 依赖与成本条件 | Node ≥18、Chrome/Playwright；小红书/抖音需专用 profile 登录 |
| 限制与采用条件 | 主要产出文字与截图，不是原视频下载器/剪辑器；PolyForm NC，商用需另核许可 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 20 maxi-max-dev/xhs-research-conductor

[仓库](https://github.com/maxi-max-dev/xhs-research-conductor) · [主要证据](https://github.com/maxi-max-dev/xhs-research-conductor/blob/main/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 小红书 App |
| 采集与归档 | 主题扩词→真实 App 搜索→图文采集/OCR；视频另走 URL→音轨转写 |
| 截图与抽帧 | Android/模拟器截图；图文与视频路线分开 |
| 剪辑与再加工 | 多笔记综合研究报告 |
| 输出产物 | PNG/OCR、笔记 bundle、vault 报告 |
| 依赖与成本条件 | Android 模拟器/手机、ADB、XHS 登录、Tesseract；Agent runner；视频需 yt-dlp/Whisper |
| 限制与采用条件 | 环境较重；README 与 SKILL 版本有差异；视频道不产出视频画面截图 |
| 证据 | README + SKILL，未运行 |

#### 条目 21 mcncarl/yichen-skills#yichen-x-slicer

[仓库](https://github.com/mcncarl/yichen-skills) · [主要证据](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-x-slicer/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 公开 X 帖子/同作者 Thread |
| 采集与归档 | FxTwitter 匿名读取、原图/原生视频下载、来源桥接 |
| 截图与抽帧 | 将帖子重新排版成 3:4 图片切片；不是真实 X 页面截图 |
| 剪辑与再加工 | 图片序列→视频；完整嵌入所选原生视频及其对应原声 |
| 输出产物 | 1080×1440 PNG、ZIP、MP4、manifest/QA |
| 依赖与成本条件 | Node、Playwright、FFmpeg/ffprobe、FxTwitter |
| 限制与采用条件 | 不做配音/BGM；忽略引用帖内容与他人回复；长文章需其他路线 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 22 eriklee1895/writing-agent-harness

[仓库](https://github.com/eriklee1895/writing-agent-harness) · [主要证据](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/article-video-clip/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 已知公开视频、本地素材包 |
| 采集与归档 | video-material-ingest 以 yt-dlp 保存媒体+来源；3 个视频技能接力 |
| 截图与抽帧 | video-highlight-select 生成 contact sheet 与时间索引 |
| 剪辑与再加工 | 人/Agent 填候选起止→article-video-clip 轻包装剪辑 |
| 输出产物 | source manifest、候选表、final.mp4、clip-manifest、预览帧 |
| 依赖与成本条件 | Node、yt-dlp、FFmpeg/ffprobe、HyperFrames |
| 限制与采用条件 | 高光选段是辅助选择；不自动生成字幕、不自动上传公众号 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

### 拆解与检索

共 9 个评估条目。

#### 条目 25 wocha-xiaoli/video-shot-analysis-feishu

[仓库](https://github.com/wocha-xiaoli/video-shot-analysis-feishu) · [主要证据](https://github.com/wocha-xiaoli/video-shot-analysis-feishu/blob/943f960300111758023b2da2b6802e68642ce9a0/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地视频 |
| 采集与归档 | 现有视频输入 |
| 截图与抽帧 | extract_shots.py 抽镜头代表帧，保存 CSV/JSON |
| 剪辑与再加工 | 逐镜头拉片、视听分析、反推提示词 |
| 输出产物 | 关键帧、镜头表、可选飞书 Base 附件 |
| 依赖与成本条件 | FFmpeg/ffprobe；飞书用 lark-cli |
| 限制与采用条件 | 主产物是拉片库与提示词，不是二创成片；飞书写入是独立动作 |
| 证据 | README + SKILL，未运行 |

#### 条目 26 liuliu-66-create/ll-video-decomposer

[仓库](https://github.com/liuliu-66-create/ll-video-decomposer) · [主要证据](https://github.com/liuliu-66-create/ll-video-decomposer/blob/5e00606ce3f1708d380cc6e3e337320cc5af2c80/codex/ll-video-decomposer/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地视频/音频、链接、逐字稿 |
| 采集与归档 | 下载器、音轨与转写工具发现 |
| 截图与抽帧 | sample_frames.py 采样帧/总览 |
| 剪辑与再加工 | 5 层拆解、多视频横向比较、视听证据分析 |
| 输出产物 | 证据包、拆解报告 |
| 依赖与成本条件 | FFmpeg、Whisper/faster-whisper、Agent 视觉 |
| 限制与采用条件 | Codex/WorkBuddy 两套目录是适配副本；报告不等于自动生成或剪辑视频 |
| 证据 | README + SKILL，未运行 |

#### 条目 27 sharon-laicc/viral-video-decomposer

[仓库](https://github.com/sharon-laicc/viral-video-decomposer) · [主要证据](https://github.com/sharon-laicc/viral-video-decomposer/blob/34093598d48bda6492f687c5eae3472b782d0637/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 链接、截图、录屏、字幕、本地视频 |
| 采集与归档 | 编排现有下载/浏览器工具 |
| 截图与抽帧 | 按需采样帧与 contact sheet |
| 剪辑与再加工 | 镜头级结构、机制、选题变量、下游 JSON brief |
| 输出产物 | HTML 报告、镜头表、制作 brief |
| 依赖与成本条件 | Agent 视觉；可选 yt-dlp/FFmpeg；报告校验器 |
| 限制与采用条件 | 主要是分析说明与报告校验；根/skill/plugin 内容存在差异，需选定一个入口 |
| 证据 | README + SKILL，未运行 |

#### 条目 28 Rimagination/dy-note

[仓库](https://github.com/Rimagination/dy-note) · [主要证据](https://github.com/Rimagination/dy-note/blob/9a65f0d069cacdf5b0d7529f2ce1139d38072b47/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 抖音 |
| 采集与归档 | 字幕提取/本地 Qwen3-ASR；资产归档、评论与选题调研 |
| 截图与抽帧 | 可接网页 AI 视觉摘要，非通用截屏流水线 |
| 剪辑与再加工 | 事实与观点分离、竞品拆解、分析预算 |
| 输出产物 | Markdown/TXT、来源证据与资产 |
| 依赖与成本条件 | Python、FFmpeg、Qwen3-ASR；可选已登录网页 AI |
| 限制与采用条件 | 偏内容理解/知识库；不是剪辑器；部分视觉渠道有登录与网页依赖 |
| 证据 | README + SKILL，未运行 |

#### 条目 29 alchaincyf/huashu-skills

[仓库](https://github.com/alchaincyf/huashu-skills) · [主要证据](https://github.com/alchaincyf/huashu-skills/blob/2efea35738efa06abbfa9acaee923fcef0732a14/huashu-douyin-script/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 抖音竞品视频 |
| 采集与归档 | huashu-douyin-script 下载参考视频 |
| 截图与抽帧 | 视频视觉分析，非网页截屏 |
| 剪辑与再加工 | Gemini 拆钩子结构→新脚本/分镜→润色 |
| 输出产物 | 分析、短视频脚本、分镜 |
| 依赖与成本条件 | uv/Python、下载脚本、Gemini key；部分下载依赖 Chrome cookies |
| 限制与采用条件 | 交付重心是策划；未提供最终剪辑渲染器 |
| 证据 | README + SKILL，未运行 |

#### 条目 30 bianzigege/qianchuan-material-breakdown-skill

[仓库](https://github.com/bianzigege/qianchuan-material-breakdown-skill) · [主要证据](https://github.com/bianzigege/qianchuan-material-breakdown-skill/blob/0ff3f462d6ddce094ad539e74dee10d260913988/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地商品广告；单条抖音/巨量创意链接 |
| 采集与归档 | 本地优先；单条链接下载；独立案例目录 |
| 截图与抽帧 | 真实逻辑片段 MP4 与每段 1—3 张关键帧 |
| 剪辑与再加工 | 按转化任务分段、卖点证据、仿拍方案 |
| 输出产物 | report.json、分段视频、关键帧、可选飞书/钉钉报告 |
| 依赖与成本条件 | Python、FFmpeg、ASR/分析环境；同步需对应 CLI |
| 限制与采用条件 | 拆解不能证明 ROI/销量；分段样片不是完成仿拍二创；完整分析能力需配置确认 |
| 证据 | README + SKILL，未运行 |

#### 条目 31 UditAkhourii/cdaf

[仓库](https://github.com/UditAkhourii/cdaf) · [主要证据](https://github.com/UditAkhourii/cdaf/blob/e5620646312753bda5eaa7a1305c32c20af0fd6d/skills/claude-code/cdaf/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地素材库 |
| 采集与归档 | 为视频建 .cdaf 时间戳描述；SHA-256/大小校验新鲜度 |
| 截图与抽帧 | 本地生成可按镜头分析；不是网页截图 |
| 剪辑与再加工 | 关键词检索/选素材，减少重复理解 |
| 输出产物 | 视频旁置描述、status/read/validate 输出 |
| 依赖与成本条件 | Python；生成用 Gemini key 或本地视觉端点；部分需 FFmpeg |
| 限制与采用条件 | 散列用于内容绑定/过期检测，非跨库感知去重；模型边界不应替代精确切口 |
| 证据 | README + SKILL，未运行 |

#### 条目 32 video-db/skills

[仓库](https://github.com/video-db/skills) · [主要证据](https://github.com/video-db/skills/blob/b47b587e282bc95a0ec4e8a25fc72a8600941341/python/SKILL.md) · 快照 2026-10-05 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 云端导入视频/音频 |
| 采集与归档 | VideoDB 云服务导入、索引 |
| 截图与抽帧 | 视频分析/检索支持定位画面 |
| 剪辑与再加工 | 语义搜索、时间线剪辑、字幕 |
| 输出产物 | 索引、编辑/流媒体结果；本地 MP4 需明确导出 |
| 依赖与成本条件 | VideoDB SDK API key 或托管 MCP OAuth |
| 限制与采用条件 | 安装 skill 不自动连 MCP；HLS URL 与本地 MP4 区分；素材将进入外部服务 |
| 证据 | README + SKILL，未运行 |

#### 条目 54 social-media-skills/skills

[仓库](https://github.com/social-media-skills/skills) · [主要证据](https://github.com/social-media-skills/skills/blob/6e30eeb2f6736bda8683b6bbaa674af3641d7945/skills/viral-reverse-engineering/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 社媒视频的逐字稿、截图、评论、数据 |
| 采集与归档 | 由用户或其他工具提供可观察证据 |
| 截图与抽帧 | 消费截图/关键帧，不自带采集器 |
| 剪辑与再加工 | viral-reverse-engineering 提炼钩子、机制、可复用表达 |
| 输出产物 | 拆解与重构建议 |
| 依赖与成本条件 | Agent 分析能力；下载/转写/截图工具另配 |
| 限制与采用条件 | skill 明确把自身定位为分析者；输入不足时不能宣称看过整片 |
| 证据 | README + SKILL，未运行 |

### 剪辑与二创

共 14 个评估条目。

#### 条目 23 YeJe-cpu/SeeCut

[仓库](https://github.com/YeJe-cpu/SeeCut) · [主要证据](https://github.com/YeJe-cpu/SeeCut/blob/75c6ca3c6ec00872ba03e8741b9a14df60dc6195/skill/seecut/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地口播、网页/B-roll/截图/录屏 |
| 采集与归档 | grab_evidence.mjs 可抓真实网页；素材台账 |
| 截图与抽帧 | 真实网页截图；渲染抽帧与几何核对 |
| 剪辑与再加工 | 口播加证据卡片、弹字、动效；迭代审片；分层工程 |
| 输出产物 | MP4、分层工程包；有剪映引擎时草稿 |
| 依赖与成本条件 | HyperFrames、FFmpeg、Playwright、Whisper；Antigravity/agy 为必需 |
| 限制与采用条件 | 不是通用社媒账号采集器；依赖 agy 审片且不提供无 agy 降级；剪映引擎可选 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 24 lainshao/video-editor

[仓库](https://github.com/lainshao/video-editor) · [主要证据](https://github.com/lainshao/video-editor/blob/d74619d3cca98ae6a3ee9447e312905da39cb450/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 口播、本地 B-roll、新闻素材 |
| 采集与归档 | 把采集委托 footage-finder/news-highlight |
| 截图与抽帧 | 本仓主要渲染卡片和字幕；新闻真源截图依赖兄弟技能 |
| 剪辑与再加工 | FFmpeg 合成、标题、动效、字幕、双画幅 |
| 输出产物 | MP4、透明层 MOV/PNG、章节时间轴 |
| 依赖与成本条件 | FFmpeg、Whisper、HyperFrames；兄弟素材技能 |
| 限制与采用条件 | 只核实本仓；未定位到公开可独立安装的 footage-finder/news-highlight 仓库，不计为已核验采集能力 |
| 证据 | README + SKILL，未运行 |

#### 条目 33 macong0420/video-remix-workflow

[仓库](https://github.com/macong0420/video-remix-workflow) · [主要证据](https://github.com/macong0420/video-remix-workflow/blob/7b3103919a8a6e61fed68606125bea101594393a/SKILL.md) · 快照 2026-10-06 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 视频、SRT、转录稿、链接、截图、笔记 |
| 采集与归档 | 编排下载/转写；来源库、引用起止、素材清单 |
| 截图与抽帧 | 图片卡片与成片 QA 抽帧；无通用页面采集器 |
| 剪辑与再加工 | 先策划后 render_plan；脚本执行切片/拼接/字幕/旁白音轨/BGM |
| 输出产物 | 脚本/分镜/发布包、draft/final MP4、SRT、录音稿、QA帧 |
| 依赖与成本条件 | Python、FFmpeg/ffprobe、中文字体；采集/转写独立；旁白可外部音频 |
| 限制与采用条件 | render_remix.py 确有实现；源片比例阈值是项目自定策略，不是法律许可标准；TTS 默认不启用 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 34 WhiteTowerAI/cut-as-code

[仓库](https://github.com/WhiteTowerAI/cut-as-code) · [主要证据](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/cut-as-code/SKILL.md) · 快照 2026-10-05 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地现有视频 |
| 采集与归档 | 素材理解与本地/Pexels B-roll |
| 截图与抽帧 | 理解/对比预览与视频审阅 |
| 剪辑与再加工 | 9 个模块覆盖切片、字幕、调色、B-roll、卡片、shorts |
| 输出产物 | 可审阅剪辑文件、工程/成片 |
| 依赖与成本条件 | FFmpeg、Python/相关 CLI；可选 Pexels |
| 限制与采用条件 | 现有素材编辑框架，社媒采集需补上游；以文件记录剪辑决策便于调整 |
| 证据 | README + SKILL，未运行 |

#### 条目 35 maxazure/video-editing-skill

[仓库](https://github.com/maxazure/video-editing-skill) · [主要证据](https://github.com/maxazure/video-editing-skill/blob/87798462eb0f946104da3d67d0f92cb4406e8c18/SKILL.md) · 快照 2026-10-05 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 中文口播、播客、采访、vlog、录屏 |
| 采集与归档 | 主要使用用户已有素材 |
| 截图与抽帧 | 素材分析与输出画面质检 |
| 剪辑与再加工 | 语义清稿、删停顿、B-roll、多源编排、字幕、平台画幅 |
| 输出产物 | 剪辑视频与辅助文件 |
| 依赖与成本条件 | Python、FFmpeg、Whisper；Apple Silicon 可用 mlx-whisper |
| 限制与采用条件 | 复杂流程要挑一条真实素材验证；不能据文档承诺所有镜头类型效果 |
| 证据 | README + SKILL，未运行 |

#### 条目 36 kajisho5/ffmpeg-skill

[仓库](https://github.com/kajisho5/ffmpeg-skill) · [主要证据](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/build-artifacts/SKILL.md) · 快照 2026-10-05 · 优先试用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地视频/音频 |
| 采集与归档 | ffprobe 探测，机器可读计划/EDL |
| 截图与抽帧 | 可作底层抽帧处理 |
| 剪辑与再加工 | 切片、拼接、字幕、画幅、响度、静音处理 |
| 输出产物 | 媒体输出、SPEC/EDL |
| 依赖与成本条件 | Python 标准库、FFmpeg/ffprobe |
| 限制与采用条件 | 根 SKILL 为生产入口；13 个内部开发 skill 不计为视频功能 |
| 证据 | README + SKILL，未运行 |

#### 条目 37 bryanwhl/ffmpeg-video-editor

[仓库](https://github.com/bryanwhl/ffmpeg-video-editor) · [主要证据](https://github.com/bryanwhl/ffmpeg-video-editor/blob/d5c3ee6e9896fdabccd4e8b5d68149252bbb682c/SKILL.md) · 快照 2026-10-05 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地媒体 |
| 采集与归档 | 已有素材输入 |
| 截图与抽帧 | FFmpeg 基础操作 |
| 剪辑与再加工 | 裁切、拼接、转码、叠图、字幕、归一 |
| 输出产物 | MP4/媒体文件 |
| 依赖与成本条件 | FFmpeg/ffprobe，文档要求 6.0+ |
| 限制与采用条件 | 基础操作集合；选题、来源台账和复杂素材编排需上层技能 |
| 证据 | README + SKILL，未运行 |

#### 条目 38 blazerior/videoediting-claude-skill

[仓库](https://github.com/blazerior/videoediting-claude-skill) · [主要证据](https://github.com/blazerior/videoediting-claude-skill/blob/b9a2cbfe87537291252f7a6966aefe244dc49802/skill/videoediting/SKILL.md) · 快照 2026-10-05 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地讲话类视频 |
| 采集与归档 | 已有素材输入 |
| 截图与抽帧 | HTML 图形可经浏览器渲染 |
| 剪辑与再加工 | 删语音停顿、调色、逐词字幕、信息叠层 |
| 输出产物 | 剪辑成片 |
| 依赖与成本条件 | FFmpeg、Python/Whisper、图形渲染用 Chrome |
| 限制与采用条件 | 依赖字体与浏览器；未实测中文逐词字幕质量 |
| 证据 | README + SKILL，未运行 |

#### 条目 39 eligapris/viral-clip-editor-skill

[仓库](https://github.com/eligapris/viral-clip-editor-skill) · [主要证据](https://github.com/eligapris/viral-clip-editor-skill/blob/b2cd0c0e00230a314ad9969edcb19bce00b2f151/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | YouTube、X/yt-dlp 网站、本地长视频 |
| 采集与归档 | download.py 下载；Whisper 逐词转写 |
| 截图与抽帧 | OpenCV 逐段采样运动/颜色 |
| 剪辑与再加工 | Agent 提供 clip_plan→固定位置竖裁→字幕→拼接转场 |
| 输出产物 | 9:16 MP4、clip_plan/crop_data、字幕中间件 |
| 依赖与成本条件 | Python、FFmpeg、yt-dlp、faster-whisper、OpenCV |
| 限制与采用条件 | pipeline.py 无选段计划会停止；每段一个固定裁切 x，不是动态人物跟踪；中文字体需补配 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 40 AgriciDaniel/claude-shorts

[仓库](https://github.com/AgriciDaniel/claude-shorts) · [主要证据](https://github.com/AgriciDaniel/claude-shorts/blob/a369fad9d84287edbb8fa3ab515f268e770f683b/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 长视频/录屏 |
| 采集与归档 | 已有视频转写、内容分析 |
| 截图与抽帧 | 录屏内容识别/重构画幅、切口吸附 |
| 剪辑与再加工 | Agent 选段评分、音频边界、字幕、Remotion 渲染 |
| 输出产物 | 竖屏短视频、Remotion 工程 |
| 依赖与成本条件 | Python/Whisper、FFmpeg、Node/Remotion |
| 限制与采用条件 | 更适合长转短；录屏适配比中心裁切细，仍需核查文字可读性；采集独立 |
| 证据 | README + SKILL，未运行 |

#### 条目 41 zenstory-ai/video-recap-skills

[仓库](https://github.com/zenstory-ai/video-recap-skills) · [主要证据](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-assemble/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地单/多视频、参考成片 |
| 采集与归档 | 多源 manifest；参考片风格测量/缓存 |
| 截图与抽帧 | 镜头检测、代表帧、成片检查 |
| 剪辑与再加工 | 理解→故事计划→选段→旁白→装配；支持原声/旁白混编 |
| 输出产物 | MP4、计划/审查文件；可选剪映/CapCut 草稿 |
| 依赖与成本条件 | Python、FFmpeg、MiMo key/语音等配置；无 GPU 路线 |
| 限制与采用条件 | 7 个模块有实际剪辑脚本；原片时间与剪后旁白时间分开；需要模型/服务依赖 |
| 证据 | README + SKILL，未运行 |

#### 条目 42 linyqh/speclip-skills

[仓库](https://github.com/linyqh/speclip-skills) · [主要证据](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/ffmpeg-best-practice/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 短剧、口播、本地视频/字幕 |
| 采集与归档 | 视频索引检索，用工具召回片段 |
| 截图与抽帧 | doubaovision 按需视觉复核 |
| 剪辑与再加工 | drama-explainer 编排解说+原声；short-drama-commentary 只设计结构 |
| 输出产物 | storyboard、口播/插片计划；环境齐全可 FFmpeg 成片 |
| 依赖与成本条件 | mediainfo、videoindex/videosearch、转写/TTS/视觉工具、FFmpeg |
| 限制与采用条件 | 技能主要是工具编排说明；仓库未自带上述全部执行器；skill-creator 为维护技能 |
| 证据 | README + SKILL，未运行 |

#### 条目 43 JimLiu/baocut

[仓库](https://github.com/JimLiu/baocut) · [主要证据](https://github.com/JimLiu/baocut/blob/6caf38144d82008d80e53e5d8e2000b7c2d81710/skills/baocut/SKILL.md) · 快照 2026-10-05 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 本地视频/音频 |
| 采集与归档 | BaoCut 转写与字幕工程 |
| 截图与抽帧 | Subtitle Studio 审阅 |
| 剪辑与再加工 | 字幕驱动剪辑、翻译、说话人/时间线检查、导出 |
| 输出产物 | 字幕/剪辑媒体、应用工程 |
| 依赖与成本条件 | BaoCut 应用、bcut CLI；对应本地环境 |
| 限制与采用条件 | 应用控制技能，安装 SKILL 不包含完整应用 |
| 证据 | README + SKILL，未运行 |

#### 条目 44 mcncarl/yichen-skills#yichen-jianying-edit

[仓库](https://github.com/mcncarl/yichen-skills) · [主要证据](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-jianying-edit/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | Apple Silicon Mac 本地剪映素材 |
| 采集与归档 | 独立素材副本/计划 |
| 截图与抽帧 | 原生草稿审阅与导出检查 |
| 剪辑与再加工 | 无界面构建/修改多轨草稿；可选原生 MP4 导出 |
| 输出产物 | 可编辑剪映草稿；条件满足可 MP4 |
| 依赖与成本条件 | 匹配剪映 11.5.0/11.4.2 与另行检出的核心项目 |
| 限制与采用条件 | 公开 skill 不是完整剪辑后端；README 提示 private core checkout，不能当可独立复现方案 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

### 包装辅助

共 4 个评估条目。

#### 条目 45 EwingYangs/social-media-cover

[仓库](https://github.com/EwingYangs/social-media-cover) · [主要证据](https://github.com/EwingYangs/social-media-cover/blob/835d3a3f054c861927960265f2a187861db2e2a7/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 社媒封面/产品截图输入 |
| 采集与归档 | 不采集社媒 |
| 截图与抽帧 | HTML→PNG；已有截图可作为设计输入 |
| 剪辑与再加工 | 封面包装 |
| 输出产物 | 中文封面 PNG |
| 依赖与成本条件 | 浏览器/渲染脚本、HTML/CSS |
| 限制与采用条件 | 不是原帖截图器，也不剪视频 |
| 证据 | README + SKILL，未运行 |

#### 条目 46 Errno722/image-text-layout-skill

[仓库](https://github.com/Errno722/image-text-layout-skill) · [主要证据](https://github.com/Errno722/image-text-layout-skill/blob/98b065fd9de06730add337bb87eb7cfaeb610172/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 笔记、截图、图片、草稿 |
| 采集与归档 | 输入已有素材 |
| 截图与抽帧 | 现有截图排版；卡片 PNG 导出 |
| 剪辑与再加工 | 图文编辑排版、裁图建议 |
| 输出产物 | HTML 预览、PNG 卡片/contact sheet |
| 依赖与成本条件 | Node、浏览器渲染环境 |
| 限制与采用条件 | 生成卡片与保存原始证据需分开 |
| 证据 | README + SKILL，未运行 |

#### 条目 47 wyuzhi/qisi-video-remix

[仓库](https://github.com/wyuzhi/qisi-video-remix) · [主要证据](https://github.com/wyuzhi/qisi-video-remix/blob/91138b08e3d25dacaea75770e9722767c39d0f2b/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 参考视频/截图/逐字稿 |
| 采集与归档 | 使用宿主已有读取能力 |
| 截图与抽帧 | 分析已有截图，无专用采集脚本 |
| 剪辑与再加工 | 叙事改编、新剧本、人物/场景、分段提示词 |
| 输出产物 | 可读策划与生成提示词 |
| 依赖与成本条件 | Agent 视频理解/转写能力，后续生成服务独立 |
| 限制与采用条件 | 明确不提供下载器/转写/生成服务；任务默认止于策划 |
| 证据 | README + SKILL，未运行 |

#### 条目 51 NomaDamas/slides-grab

[仓库](https://github.com/NomaDamas/slides-grab) · [主要证据](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-card-news/SKILL.md) · 快照 2026-10-06 · 按场景评估

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | HTML 演示文稿、社媒卡片 |
| 采集与归档 | 可用 yt-dlp 将视频下载为演示资产 |
| 截图与抽帧 | 渲染 HTML/卡片为图像 |
| 剪辑与再加工 | 演示/卡片创作与导出 |
| 输出产物 | HTML/PPTX/PDF/PNG 等 |
| 依赖与成本条件 | Node、浏览器、部分图像服务 |
| 限制与采用条件 | 名称不代表从视频自动抽取幻灯片；核心是演示工具，非长视频选段器 |
| 证据 | README + SKILL，未运行 |

### 受限或待核实

共 4 个评估条目。

#### 条目 48 anbeime/skill

[仓库](https://github.com/anbeime/skill) · [主要证据](https://github.com/anbeime/skill/blob/5094637f62bcb9f66f607044b41ca9258837ede6/skills/pet-commerce-creator/pet-commerce-creator/SKILL.md) · 快照 2026-10-06 · 暂不推荐直接采用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 参考视频、图文生成 |
| 采集与归档 | 关键帧提取、Coze 分析 |
| 截图与抽帧 | OpenCV 抽帧；新图像生成存在占位实现 |
| 剪辑与再加工 | MoviePy 合成；部分音乐/音效占位回退 |
| 输出产物 | 可能导出 MP4，但素材质量不可按名称保证 |
| 依赖与成本条件 | Coze API/发布 Bot、MoviePy、Edge TTS 等 |
| 限制与采用条件 | 源码 image_generator 生成纯色占位图；音效/音乐可占位；部分脚本内置凭据样式字符串，未使用，采用前应清理 |
| 证据 | SKILL + 重点脚本静态核对，未运行 |

#### 条目 49 danasong/douyin-downloader-skill

[仓库](https://github.com/danasong/douyin-downloader-skill) · [主要证据](https://github.com/danasong/douyin-downloader-skill/blob/28e61d3bd14dadec6f6c61e74069f1eeeace91ed/skills/douyin_downloader/SKILL.md) · 快照 2026-10-06 · 暂不推荐直接采用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 抖音分享链接 |
| 采集与归档 | 仅公开调用流程；下载执行器为作者私有路径 |
| 截图与抽帧 | 下载后可接抽帧 |
| 剪辑与再加工 | 输入输出编排 |
| 输出产物 | 声明视频/元数据 |
| 依赖与成本条件 | 作者本机私有 douyin_downloader.py |
| 限制与采用条件 | 公开文件树没有下载器；不能直接复制安装后期待运行 |
| 证据 | README + SKILL，未运行 |

#### 条目 50 Francis-Xavier-code/tiktok-douyin-dl

[仓库](https://github.com/Francis-Xavier-code/tiktok-douyin-dl) · [主要证据](https://github.com/Francis-Xavier-code/tiktok-douyin-dl/blob/7f637fad064853baa0899d7b0ee3623bff45ca13/README.md) · 快照 2026-10-06 · 暂不推荐直接采用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 曾涉及 TikTok/抖音 |
| 采集与归档 | 搜索结果有旧下载说明 |
| 截图与抽帧 | 未核实 |
| 剪辑与再加工 | 未核实 |
| 输出产物 | 当前仓库无有效 skill 路径 |
| 依赖与成本条件 | 不可作为现成执行依赖 |
| 限制与采用条件 | 当前 README 明示关闭下载功能、停止维护；搜索缓存不能代表现状 |
| 证据 | README，未找到有效 SKILL |

#### 条目 52 gnipbao/minimax-h3-video-reverse-skill

[仓库](https://github.com/gnipbao/minimax-h3-video-reverse-skill) · [主要证据](https://github.com/gnipbao/minimax-h3-video-reverse-skill) · 快照 2026-10-06 · 暂不推荐直接采用

| 维度 | 统一分析 |
|---|---|
| 平台与输入 | 前轮目录线索 |
| 采集与归档 | 本轮 main/master 树均未取得 |
| 截图与抽帧 | 未核实 |
| 剪辑与再加工 | 未核实 |
| 输出产物 | 未核实 |
| 依赖与成本条件 | 仓库可用性待确认 |
| 限制与采用条件 | GitHub 返回 404；保留线索，不计为已验证可用项目 |
| 证据 | 仓库未取得 |

## SKILL 文件入口索引

以下共 137 个相关 SKILL 文件路径，用于定位生产入口、适配副本和维护技能。它们来自已取得的相关目录，不表示覆盖每个仓库的全部技能，也不表示 137 个独立视频功能。标为“平台适配副本”“多个入口/版本”或“内部维护/开发”的记录，应按具体用途选择。

| 序号 | 仓库 | SKILL 文件路径 | 角色 | 快照 |
|---|---|---|---|---|
| 1 | 0xDarkMatter/claude-mods | [skills/ytdlp-ops/SKILL.md](https://github.com/0xDarkMatter/claude-mods/blob/24ac6d11c75db238a3f4338b35cbb4ad3a9be1dc/skills/ytdlp-ops/SKILL.md) | 生产技能 | 2026-10-06 |
| 2 | 43COLLEGE/43-Agent-skills | [social-media-scout/SKILL.md](https://github.com/43COLLEGE/43-Agent-skills/blob/385773aecd59e38e1d82e8237e122baec1b685a7/social-media-scout/SKILL.md) | 生产技能 | 2026-10-06 |
| 3 | AgriciDaniel/claude-shorts | [SKILL.md](https://github.com/AgriciDaniel/claude-shorts/blob/a369fad9d84287edbb8fa3ab515f268e770f683b/SKILL.md) | 生产技能 | 2026-10-06 |
| 4 | alchaincyf/huashu-skills | [huashu-douyin-script/SKILL.md](https://github.com/alchaincyf/huashu-skills/blob/2efea35738efa06abbfa9acaee923fcef0732a14/huashu-douyin-script/SKILL.md) | 生产技能 | 2026-10-06 |
| 5 | anbeime/skill | [skills/pet-commerce-creator/pet-commerce-creator/SKILL.md](https://github.com/anbeime/skill/blob/5094637f62bcb9f66f607044b41ca9258837ede6/skills/pet-commerce-creator/pet-commerce-creator/SKILL.md) | 生产技能 | 2026-10-06 |
| 6 | anbeime/skill | [skills/video-creation-suite/video-creation-suite/SKILL.md](https://github.com/anbeime/skill/blob/5094637f62bcb9f66f607044b41ca9258837ede6/skills/video-creation-suite/video-creation-suite/SKILL.md) | 生产技能 | 2026-10-06 |
| 7 | anbeime/skill | [skills/video-recreation/video-recreation/SKILL.md](https://github.com/anbeime/skill/blob/5094637f62bcb9f66f607044b41ca9258837ede6/skills/video-recreation/video-recreation/SKILL.md) | 生产技能 | 2026-10-06 |
| 8 | bianzigege/qianchuan-material-breakdown-skill | [SKILL.md](https://github.com/bianzigege/qianchuan-material-breakdown-skill/blob/0ff3f462d6ddce094ad539e74dee10d260913988/SKILL.md) | 生产技能 | 2026-10-06 |
| 9 | blazerior/videoediting-claude-skill | [skill/videoediting/SKILL.md](https://github.com/blazerior/videoediting-claude-skill/blob/b9a2cbfe87537291252f7a6966aefe244dc49802/skill/videoediting/SKILL.md) | 生产技能 | 2026-10-05 |
| 10 | bryanwhl/ffmpeg-video-editor | [SKILL.md](https://github.com/bryanwhl/ffmpeg-video-editor/blob/d5c3ee6e9896fdabccd4e8b5d68149252bbb682c/SKILL.md) | 生产技能 | 2026-10-05 |
| 11 | chubbyguan/chubbyskills | [bilibili-transcribe/SKILL.md](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/bilibili-transcribe/SKILL.md) | 生产技能 | 2026-10-06 |
| 12 | chubbyguan/chubbyskills | [douyin-transcribe/SKILL.md](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/douyin-transcribe/SKILL.md) | 生产技能 | 2026-10-06 |
| 13 | chubbyguan/chubbyskills | [knowledge-base-management/SKILL.md](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/knowledge-base-management/SKILL.md) | 生产技能 | 2026-10-06 |
| 14 | chubbyguan/chubbyskills | [xiaohongshu-ingest/SKILL.md](https://github.com/chubbyguan/chubbyskills/blob/a5f9f2fbfc7f36725f282c4510914306fe8f11b9/xiaohongshu-ingest/SKILL.md) | 生产技能 | 2026-10-06 |
| 15 | danasong/douyin-downloader-skill | [skills/douyin_downloader/SKILL.md](https://github.com/danasong/douyin-downloader-skill/blob/28e61d3bd14dadec6f6c61e74069f1eeeace91ed/skills/douyin_downloader/SKILL.md) | 生产技能 | 2026-10-06 |
| 16 | davidtoby/agent-skills | [skills/curated/video-transcription-subtitle-workflows/SKILL.md](https://github.com/davidtoby/agent-skills/blob/9c6dececf1efb723ea716d09d1d13b3e69c83798/skills/curated/video-transcription-subtitle-workflows/SKILL.md) | 生产技能 | 2026-10-06 |
| 17 | eligapris/viral-clip-editor-skill | [SKILL.md](https://github.com/eligapris/viral-clip-editor-skill/blob/b2cd0c0e00230a314ad9969edcb19bce00b2f151/SKILL.md) | 生产技能 | 2026-10-06 |
| 18 | eriklee1895/writing-agent-harness | [.agents/skills/article-video-clip/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/article-video-clip/SKILL.md) | 生产技能 | 2026-10-06 |
| 19 | eriklee1895/writing-agent-harness | [.agents/skills/video-highlight-select/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/video-highlight-select/SKILL.md) | 生产技能 | 2026-10-06 |
| 20 | eriklee1895/writing-agent-harness | [.agents/skills/video-material-ingest/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/video-material-ingest/SKILL.md) | 生产技能 | 2026-10-06 |
| 21 | eriklee1895/writing-agent-harness | [.agents/skills/wechat-article-fetcher/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/wechat-article-fetcher/SKILL.md) | 生产技能 | 2026-10-06 |
| 22 | eriklee1895/writing-agent-harness | [.agents/skills/wechat-article-publisher/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/wechat-article-publisher/SKILL.md) | 生产技能 | 2026-10-06 |
| 23 | eriklee1895/writing-agent-harness | [.agents/skills/wechat-article-renderer/SKILL.md](https://github.com/eriklee1895/writing-agent-harness/blob/b80e32c33d903f6f0a79fa2d48735214ef25c060/.agents/skills/wechat-article-renderer/SKILL.md) | 生产技能 | 2026-10-06 |
| 24 | Errno722/image-text-layout-skill | [SKILL.md](https://github.com/Errno722/image-text-layout-skill/blob/98b065fd9de06730add337bb87eb7cfaeb610172/SKILL.md) | 生产技能 | 2026-10-06 |
| 25 | EwingYangs/social-media-cover | [SKILL.md](https://github.com/EwingYangs/social-media-cover/blob/835d3a3f054c861927960265f2a187861db2e2a7/SKILL.md) | 生产技能 | 2026-10-06 |
| 26 | franciscobmacedo/postreef-skills | [skills/yt-dlp-troubleshooting/SKILL.md](https://github.com/franciscobmacedo/postreef-skills/blob/3664fa2a80ac353a6dab2541a7210eb8d0dfe87c/skills/yt-dlp-troubleshooting/SKILL.md) | 生产技能 | 2026-10-06 |
| 27 | HeiGeAi/HeiGe-CommentRadar | [SKILL.md](https://github.com/HeiGeAi/HeiGe-CommentRadar/blob/main/SKILL.md) | 生产技能 | 2026-10-06 |
| 28 | jackwener/bilibili-cli | [SKILL.md](https://github.com/jackwener/bilibili-cli/blob/dbe28551930df43b633baa52e9639832aeada967/SKILL.md) | 生产技能 | 2026-10-06 |
| 29 | jackwener/OpenCLI | [skills/opencli-browser/SKILL.md](https://github.com/jackwener/OpenCLI/blob/24136945847afbfad266c6c46a8cd335377f9112/skills/opencli-browser/SKILL.md) | 生产技能 | 2026-10-06 |
| 30 | jackwener/OpenCLI | [skills/opencli-usage/SKILL.md](https://github.com/jackwener/OpenCLI/blob/24136945847afbfad266c6c46a8cd335377f9112/skills/opencli-usage/SKILL.md) | 生产技能 | 2026-10-06 |
| 31 | jackwener/OpenCLI | [skills/smart-search/SKILL.md](https://github.com/jackwener/OpenCLI/blob/24136945847afbfad266c6c46a8cd335377f9112/skills/smart-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 32 | jackwener/twitter-cli | [SKILL.md](https://github.com/jackwener/twitter-cli/blob/7c634e0d396b1e7af9f63315b414925fe4f29ae7/SKILL.md) | 生产技能 | 2026-10-06 |
| 33 | jackwener/weibo-cli | [SKILL.md](https://github.com/jackwener/weibo-cli/blob/ea2e86e0b3c9fb4120660529a60ed7a44b2b90bb/SKILL.md) | 生产技能 | 2026-10-06 |
| 34 | jackwener/xiaohongshu-cli | [SKILL.md](https://github.com/jackwener/xiaohongshu-cli/blob/4d63f3c0c85ccd9054fa8e96d7f761aaf2507449/SKILL.md) | 生产技能 | 2026-10-06 |
| 35 | Jiaranbb/content-reader | [bilibili-reader/SKILL.md](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/bilibili-reader/SKILL.md) | 生产技能 | 2026-10-06 |
| 36 | Jiaranbb/content-reader | [content-reader/SKILL.md](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/content-reader/SKILL.md) | 生产技能 | 2026-10-06 |
| 37 | Jiaranbb/content-reader | [twitter-reader/SKILL.md](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/twitter-reader/SKILL.md) | 生产技能 | 2026-10-06 |
| 38 | Jiaranbb/content-reader | [xhs-reader/SKILL.md](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/xhs-reader/SKILL.md) | 生产技能 | 2026-10-06 |
| 39 | Jiaranbb/content-reader | [youtube-reader/SKILL.md](https://github.com/Jiaranbb/content-reader/blob/5a8e26f4855f9aedb9f921e9a2700f00a6fc5091/youtube-reader/SKILL.md) | 生产技能 | 2026-10-06 |
| 40 | JimLiu/baocut | [skills/baocut/SKILL.md](https://github.com/JimLiu/baocut/blob/6caf38144d82008d80e53e5d8e2000b7c2d81710/skills/baocut/SKILL.md) | 生产技能 | 2026-10-05 |
| 41 | JimLiu/baoyu-skills | [skills/baoyu-danger-x-to-markdown/SKILL.md](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-danger-x-to-markdown/SKILL.md) | 生产技能 | 2026-10-06 |
| 42 | JimLiu/baoyu-skills | [skills/baoyu-url-to-markdown/SKILL.md](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-url-to-markdown/SKILL.md) | 生产技能 | 2026-10-06 |
| 43 | JimLiu/baoyu-skills | [skills/baoyu-youtube-transcript/SKILL.md](https://github.com/JimLiu/baoyu-skills/blob/main/skills/baoyu-youtube-transcript/SKILL.md) | 生产技能 | 2026-10-06 |
| 44 | kajisho5/ffmpeg-skill | [.claude/skills/build-artifacts/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/build-artifacts/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 45 | kajisho5/ffmpeg-skill | [.claude/skills/ci-pipeline-synthesizer/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/ci-pipeline-synthesizer/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 46 | kajisho5/ffmpeg-skill | [.claude/skills/code-review/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/code-review/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 47 | kajisho5/ffmpeg-skill | [.claude/skills/concurrent-branches/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/concurrent-branches/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 48 | kajisho5/ffmpeg-skill | [.claude/skills/cross-surface-changes/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/cross-surface-changes/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 49 | kajisho5/ffmpeg-skill | [.claude/skills/defect-reports/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/defect-reports/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 50 | kajisho5/ffmpeg-skill | [.claude/skills/destructive-operations/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/destructive-operations/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 51 | kajisho5/ffmpeg-skill | [.claude/skills/git-hygiene/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/git-hygiene/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 52 | kajisho5/ffmpeg-skill | [.claude/skills/github-actions/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/github-actions/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 53 | kajisho5/ffmpeg-skill | [.claude/skills/mcp-server-design/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/mcp-server-design/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 54 | kajisho5/ffmpeg-skill | [.claude/skills/release-management/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/release-management/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 55 | kajisho5/ffmpeg-skill | [.claude/skills/reproducing-ci-locally/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/reproducing-ci-locally/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 56 | kajisho5/ffmpeg-skill | [.claude/skills/verifying-external-behavior/SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/.claude/skills/verifying-external-behavior/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-05 |
| 57 | kajisho5/ffmpeg-skill | [SKILL.md](https://github.com/kajisho5/ffmpeg-skill/blob/008333aaf6722083392eb6bd8bd67b59884a2a26/SKILL.md) | 生产技能 | 2026-10-05 |
| 58 | lainshao/video-editor | [SKILL.md](https://github.com/lainshao/video-editor/blob/d74619d3cca98ae6a3ee9447e312905da39cb450/SKILL.md) | 生产技能 | 2026-10-06 |
| 59 | linyqh/speclip-skills | [ffmpeg-best-practice/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/ffmpeg-best-practice/SKILL.md) | 生产技能 | 2026-10-06 |
| 60 | linyqh/speclip-skills | [landscape-subtitle-layout/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/landscape-subtitle-layout/SKILL.md) | 生产技能 | 2026-10-06 |
| 61 | linyqh/speclip-skills | [portrait-subtitle-layout/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/portrait-subtitle-layout/SKILL.md) | 生产技能 | 2026-10-06 |
| 62 | linyqh/speclip-skills | [short-drama-video/drama-explainer/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/short-drama-video/drama-explainer/SKILL.md) | 生产技能 | 2026-10-06 |
| 63 | linyqh/speclip-skills | [short-drama-video/drama-script-writer/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/short-drama-video/drama-script-writer/SKILL.md) | 生产技能 | 2026-10-06 |
| 64 | linyqh/speclip-skills | [short-drama-video/short-drama-commentary/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/short-drama-video/short-drama-commentary/SKILL.md) | 生产技能 | 2026-10-06 |
| 65 | linyqh/speclip-skills | [skill-creator/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/skill-creator/SKILL.md) | 内部维护/开发；不计视频功能 | 2026-10-06 |
| 66 | linyqh/speclip-skills | [talking-head-editor/SKILL.md](https://github.com/linyqh/speclip-skills/blob/cb51e23c69254930858e489c4bcaae5bb10f54b3/talking-head-editor/SKILL.md) | 生产技能 | 2026-10-06 |
| 67 | liuliu-66-create/ll-video-decomposer | [codex/ll-video-decomposer/SKILL.md](https://github.com/liuliu-66-create/ll-video-decomposer/blob/5e00606ce3f1708d380cc6e3e337320cc5af2c80/codex/ll-video-decomposer/SKILL.md) | 生产技能 | 2026-10-06 |
| 68 | liuliu-66-create/ll-video-decomposer | [workbuddy/ll-video-decomposer/SKILL.md](https://github.com/liuliu-66-create/ll-video-decomposer/blob/5e00606ce3f1708d380cc6e3e337320cc5af2c80/workbuddy/ll-video-decomposer/SKILL.md) | 平台适配副本 | 2026-10-06 |
| 69 | lovensky1992-wk/content-collector | [SKILL.md](https://github.com/lovensky1992-wk/content-collector/blob/793e08be95b0a663ffe4576c5c258ff8920d60f2/SKILL.md) | 生产技能 | 2026-10-06 |
| 70 | macong0420/video-remix-workflow | [SKILL.md](https://github.com/macong0420/video-remix-workflow/blob/7b3103919a8a6e61fed68606125bea101594393a/SKILL.md) | 生产技能 | 2026-10-06 |
| 71 | maxazure/video-editing-skill | [SKILL.md](https://github.com/maxazure/video-editing-skill/blob/87798462eb0f946104da3d67d0f92cb4406e8c18/SKILL.md) | 生产技能 | 2026-10-05 |
| 72 | maxi-max-dev/xhs-research-conductor | [SKILL.md](https://github.com/maxi-max-dev/xhs-research-conductor/blob/main/SKILL.md) | 生产技能 | 2026-10-06 |
| 73 | mcncarl/yichen-skills | [yichen-asr/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-asr/SKILL.md) | 生产技能 | 2026-10-06 |
| 74 | mcncarl/yichen-skills | [yichen-content-archive/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-content-archive/SKILL.md) | 生产技能 | 2026-10-06 |
| 75 | mcncarl/yichen-skills | [yichen-jianying-edit/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-jianying-edit/SKILL.md) | 生产技能 | 2026-10-06 |
| 76 | mcncarl/yichen-skills | [yichen-unified-search/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-unified-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 77 | mcncarl/yichen-skills | [yichen-volc-asr/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-volc-asr/SKILL.md) | 生产技能 | 2026-10-06 |
| 78 | mcncarl/yichen-skills | [yichen-x-slicer/SKILL.md](https://github.com/mcncarl/yichen-skills/blob/9bd78982aa75aa179258bc9009fe4dcf2f2973b9/yichen-x-slicer/SKILL.md) | 生产技能 | 2026-10-06 |
| 79 | NomaDamas/slides-grab | [skills/slides-grab-card-news/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-card-news/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 80 | NomaDamas/slides-grab | [skills/slides-grab-design/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-design/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 81 | NomaDamas/slides-grab | [skills/slides-grab-export/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-export/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 82 | NomaDamas/slides-grab | [skills/slides-grab-html/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-html/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 83 | NomaDamas/slides-grab | [skills/slides-grab-image/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-image/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 84 | NomaDamas/slides-grab | [skills/slides-grab-plan/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab-plan/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 85 | NomaDamas/slides-grab | [skills/slides-grab/SKILL.md](https://github.com/NomaDamas/slides-grab/blob/49bdaed950584a46437fb2b80939a7f5e0c8e4d0/skills/slides-grab/SKILL.md) | 演示/卡片辅助；非视频剪辑核心 | 2026-10-06 |
| 86 | Panniantong/Agent-Reach | [agent_reach/skill/SKILL.md](https://github.com/Panniantong/Agent-Reach/blob/a19a171fa980a0785849596492e0af4db800c82f/agent_reach/skill/SKILL.md) | 生产技能 | 2026-10-06 |
| 87 | redfox-data/redfox-community-dsh | [skills/bilibili-keywords-accounts/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-keywords-accounts/SKILL.md) | 生产技能 | 2026-10-06 |
| 88 | redfox-data/redfox-community-dsh | [skills/bilibili-keywords-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-keywords-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 89 | redfox-data/redfox-community-dsh | [skills/bilibili-portfolio-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-portfolio-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 90 | redfox-data/redfox-community-dsh | [skills/bilibili-search-download/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-search-download/SKILL.md) | 生产技能 | 2026-10-06 |
| 91 | redfox-data/redfox-community-dsh | [skills/bilibili-video-downloader/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/bilibili-video-downloader/SKILL.md) | 生产技能 | 2026-10-06 |
| 92 | redfox-data/redfox-community-dsh | [skills/douyin-account-diagnosis/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/douyin-account-diagnosis/SKILL.md) | 生产技能 | 2026-10-06 |
| 93 | redfox-data/redfox-community-dsh | [skills/douyin-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/douyin-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 94 | redfox-data/redfox-community-dsh | [skills/douyin-similar-account/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/douyin-similar-account/SKILL.md) | 生产技能 | 2026-10-06 |
| 95 | redfox-data/redfox-community-dsh | [skills/douyin-top-account/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/douyin-top-account/SKILL.md) | 生产技能 | 2026-10-06 |
| 96 | redfox-data/redfox-community-dsh | [skills/douyin-video-downloader/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/douyin-video-downloader/SKILL.md) | 生产技能 | 2026-10-06 |
| 97 | redfox-data/redfox-community-dsh | [skills/kuaishou-account-works/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/kuaishou-account-works/SKILL.md) | 生产技能 | 2026-10-06 |
| 98 | redfox-data/redfox-community-dsh | [skills/kuaishou-accounts/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/kuaishou-accounts/SKILL.md) | 生产技能 | 2026-10-06 |
| 99 | redfox-data/redfox-community-dsh | [skills/kuaishou-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/kuaishou-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 100 | redfox-data/redfox-community-dsh | [skills/kuaishou-video-extract/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/kuaishou-video-extract/SKILL.md) | 生产技能 | 2026-10-06 |
| 101 | redfox-data/redfox-community-dsh | [skills/tiktok-video-downloader/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/tiktok-video-downloader/SKILL.md) | 生产技能 | 2026-10-06 |
| 102 | redfox-data/redfox-community-dsh | [skills/weibo-comment-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/weibo-comment-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 103 | redfox-data/redfox-community-dsh | [skills/weibo-hot-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/weibo-hot-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 104 | redfox-data/redfox-community-dsh | [skills/weibo-post-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/weibo-post-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 105 | redfox-data/redfox-community-dsh | [skills/weibo-realtime-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/weibo-realtime-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 106 | redfox-data/redfox-community-dsh | [skills/xiaohongshu-account-analyzer/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/xiaohongshu-account-analyzer/SKILL.md) | 生产技能 | 2026-10-06 |
| 107 | redfox-data/redfox-community-dsh | [skills/xiaohongshu-search/SKILL.md](https://github.com/redfox-data/redfox-community-dsh/blob/f60e49a55612d15b1906eb7bae7ed8fcc1400359/skills/xiaohongshu-search/SKILL.md) | 生产技能 | 2026-10-06 |
| 108 | Rimagination/dy-note | [SKILL.md](https://github.com/Rimagination/dy-note/blob/9a65f0d069cacdf5b0d7529f2ce1139d38072b47/SKILL.md) | 生产技能 | 2026-10-06 |
| 109 | sharon-laicc/viral-video-decomposer | [SKILL.md](https://github.com/sharon-laicc/viral-video-decomposer/blob/34093598d48bda6492f687c5eae3472b782d0637/SKILL.md) | 多个入口/版本，勿重复安装 | 2026-10-06 |
| 110 | sharon-laicc/viral-video-decomposer | [plugins/video-structure-analyzer/SKILL.md](https://github.com/sharon-laicc/viral-video-decomposer/blob/34093598d48bda6492f687c5eae3472b782d0637/plugins/video-structure-analyzer/SKILL.md) | 多个入口/版本，勿重复安装 | 2026-10-06 |
| 111 | sharon-laicc/viral-video-decomposer | [skill/SKILL.md](https://github.com/sharon-laicc/viral-video-decomposer/blob/34093598d48bda6492f687c5eae3472b782d0637/skill/SKILL.md) | 多个入口/版本，勿重复安装 | 2026-10-06 |
| 112 | social-media-skills/skills | [skills/viral-reverse-engineering/SKILL.md](https://github.com/social-media-skills/skills/blob/6e30eeb2f6736bda8683b6bbaa674af3641d7945/skills/viral-reverse-engineering/SKILL.md) | 生产技能 | 2026-10-06 |
| 113 | UditAkhourii/cdaf | [skills/claude-code/cdaf/SKILL.md](https://github.com/UditAkhourii/cdaf/blob/e5620646312753bda5eaa7a1305c32c20af0fd6d/skills/claude-code/cdaf/SKILL.md) | 生产技能 | 2026-10-06 |
| 114 | vercel-labs/agent-browser | [skills/agent-browser/SKILL.md](https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md) | 生产技能 | 2026-10-06 |
| 115 | video-db/skills | [python/SKILL.md](https://github.com/video-db/skills/blob/b47b587e282bc95a0ec4e8a25fc72a8600941341/python/SKILL.md) | 生产技能 | 2026-10-05 |
| 116 | WhiteTowerAI/cut-as-code | [skills/cut-as-code/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/cut-as-code/SKILL.md) | 生产技能 | 2026-10-05 |
| 117 | WhiteTowerAI/cut-as-code | [skills/video-add-b-roll/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-add-b-roll/SKILL.md) | 生产技能 | 2026-10-05 |
| 118 | WhiteTowerAI/cut-as-code | [skills/video-add-captions/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-add-captions/SKILL.md) | 生产技能 | 2026-10-05 |
| 119 | WhiteTowerAI/cut-as-code | [skills/video-add-content-cards/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-add-content-cards/SKILL.md) | 生产技能 | 2026-10-05 |
| 120 | WhiteTowerAI/cut-as-code | [skills/video-color-grade/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-color-grade/SKILL.md) | 生产技能 | 2026-10-05 |
| 121 | WhiteTowerAI/cut-as-code | [skills/video-cut/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-cut/SKILL.md) | 生产技能 | 2026-10-05 |
| 122 | WhiteTowerAI/cut-as-code | [skills/video-edit-compare/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-edit-compare/SKILL.md) | 生产技能 | 2026-10-05 |
| 123 | WhiteTowerAI/cut-as-code | [skills/video-to-shorts/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-to-shorts/SKILL.md) | 生产技能 | 2026-10-05 |
| 124 | WhiteTowerAI/cut-as-code | [skills/video-understand/SKILL.md](https://github.com/WhiteTowerAI/cut-as-code/blob/a3bf25bb59fcc202185ce8106cdc8e3a0652a01c/skills/video-understand/SKILL.md) | 生产技能 | 2026-10-05 |
| 125 | wocha-xiaoli/video-shot-analysis-feishu | [SKILL.md](https://github.com/wocha-xiaoli/video-shot-analysis-feishu/blob/943f960300111758023b2da2b6802e68642ce9a0/SKILL.md) | 生产技能 | 2026-10-06 |
| 126 | wyuzhi/qisi-video-remix | [SKILL.md](https://github.com/wyuzhi/qisi-video-remix/blob/91138b08e3d25dacaea75770e9722767c39d0f2b/SKILL.md) | 生产技能 | 2026-10-06 |
| 127 | YeJe-cpu/SeeCut | [skill/seecut/SKILL.md](https://github.com/YeJe-cpu/SeeCut/blob/75c6ca3c6ec00872ba03e8741b9a14df60dc6195/skill/seecut/SKILL.md) | 生产技能 | 2026-10-06 |
| 128 | yuwanpai2004-create/codex-skills | [skills/product-video-pipeline/SKILL.md](https://github.com/yuwanpai2004-create/codex-skills/blob/8cb6f9c700819d0c4fdbbdaee76f4d9e2eb1a1f7/skills/product-video-pipeline/SKILL.md) | 生产技能 | 2026-10-06 |
| 129 | yuwanpai2004-create/codex-skills | [skills/social-corpus-harvest/SKILL.md](https://github.com/yuwanpai2004-create/codex-skills/blob/8cb6f9c700819d0c4fdbbdaee76f4d9e2eb1a1f7/skills/social-corpus-harvest/SKILL.md) | 生产技能 | 2026-10-06 |
| 130 | zczxd1118/content-catcher | [SKILL.md](https://github.com/zczxd1118/content-catcher/blob/3705eddc07c068d93e0754ab83dfb3b2b9c9d1fb/SKILL.md) | 生产技能 | 2026-10-06 |
| 131 | zenstory-ai/video-recap-skills | [skills/video-assemble/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-assemble/SKILL.md) | 生产技能 | 2026-10-06 |
| 132 | zenstory-ai/video-recap-skills | [skills/video-cut/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-cut/SKILL.md) | 生产技能 | 2026-10-06 |
| 133 | zenstory-ai/video-recap-skills | [skills/video-recap/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-recap/SKILL.md) | 生产技能 | 2026-10-06 |
| 134 | zenstory-ai/video-recap-skills | [skills/video-reference/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-reference/SKILL.md) | 生产技能 | 2026-10-06 |
| 135 | zenstory-ai/video-recap-skills | [skills/video-script/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-script/SKILL.md) | 生产技能 | 2026-10-06 |
| 136 | zenstory-ai/video-recap-skills | [skills/video-understanding/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-understanding/SKILL.md) | 生产技能 | 2026-10-06 |
| 137 | zenstory-ai/video-recap-skills | [skills/video-voiceover/SKILL.md](https://github.com/zenstory-ai/video-recap-skills/blob/539168622918e058bd250c793b82f043eced31e0/skills/video-voiceover/SKILL.md) | 生产技能 | 2026-10-06 |

## 后续维护

更新研究时保留快照日期，记录新增、失效和判断变化；实施或实测结论另列日期和具体样本。工具能力优先核对 SKILL 引用的执行文件与输出产物，不能只依据技能名、聚合目录、接口数量或 README 的完整流程表述。

本目录只保留研究结论和原始来源链接，不复制第三方 SKILL 指令、下载器代码、媒体样本或凭据。新的专项研究从 [研究索引](README.md) 登记；实际产品行为变更另行更新权威功能文档。
