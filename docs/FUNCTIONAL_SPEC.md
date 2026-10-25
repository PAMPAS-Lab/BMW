# BMW 功能说明书

Browser is boundary, media is native, web is runtime.

适用实现：本仓库唯一应用 BMW（id `bmw`）。本说明书是当前功能、Schema、权限和测试的权威索引；文末能力、Studio 操作和测试清单由源码生成；运行时测试分支见 ARCHITECTURE 的生成表。文档与当前工作树核对日期为 2026-10-17；验证范围见 [VERIFICATION.md](VERIFICATION.md)，日期不代表全部运行时重新验收。

| 阅读范围 | 章节入口 |
|---|---|
| 应用与执行边界 | [产品与包](#产品与包边界)、[三驱动](#自有-assistant-装配三官方驱动)、[Project与会话](#桌面project-与会话)、[浏览器权限](#浏览器工具和权限) |
| 媒体与来源 | [原生媒体](#原生媒体)、[Project来源](#project-来源与引用)、[全片分析](#全片来源分析任务) |
| 视频数据与编辑 | [Studio](#video-studio)、[共享文档](#共享视频文档与编辑器兼容性)、[有界长篇](#有界长篇文档与制作) |
| 质量与恢复 | [手机审片](#关键状态画面检查与实际成片手机审片)、[制作取消与续做](#制作取消清理与明确续做)、[测试分类](#模块接口与测试分类) |

研究、规划和历史阶段的入口见 [文档导航](README.md)，不在本说明书发布尚未实现的能力。


- 自动获取的播放器预热清理在同一 Project 和页面内暂停固定选择器播放器并核实实际 paused 状态；身份或分发变化不得阻止清理，亦不得放行后续采集。暂停失败仍隔离到实际关页；预热/采集失败诊断附最多两条不含分发 URL 的下载原因与耗时，保留实际失败原因。

- 新闻准备逐帧分析不足时返回实际 referenceId、帧数、观察数、缺失及完整必需 frameIndex，附当前版本的只读 read-reference 恢复请求和 set-reference-analysis 操作名；不要求可选的 apply-reference-notes。引用绑定失败另附当前 Project 内按精确 sourceId 的只读 library.streams 恢复请求，仍不修正、接受或重放失败计划。

- `video.studio / set-reference-analyses` 一次接受1–8组 `{referenceId,referenceAnalysis}`，要求每组覆盖实际全部 frameIndex；逐一保护用户校正并核验源文件/PNG哈希，合计至多512MiB/128文件且提交前复核，以一个草稿 CAS 全部保存或全部拒绝。不生成语义观察、不替代新闻清单或独立审片；旧的单组操作仍可保存局部分析。批量返回简短逐组计数，避免回传整组帧及完整草稿。

- 普通竖屏 fullscreen 实拍画框按标题最大入场边界及整镜底部字幕最大实排包围盒预留12个720高逻辑像素的间距；同一镜的字幕切换不改变画框。复用公共段落换行避免标题自动孤字。新版渲染器指纹为 `native-research-diagrams/11`，不复用旧布局编码结果；既有 MP4 文件与历史审核保留。

## 产品与包边界

| 包 | 责任 |
|---|---|
| apps/bmw | 组合 BMW 产品，默认入口注入三驱动装配和自有 Assistant |
| product-bmw | 浏览器/媒体/视频产品定义，不依赖 DSH |
| agent-contract | 通用 AgentBackend、BMW Project/Session、任务提交、设置及上下文契约 |
| harness-dsh | DSH 进程、官方鉴权/传输、预设、模型配置、插件、私有 Workspace 映射及显式冷历史导出 |
| harness-qoder | 官方 Qoder CN SDK/Worker、有效工具目录准入、原生续聊和事件转换 |
| harness-codex | 官方 Codex App Server、模型目录预检、dynamic browser 回调与原生续聊 |
| agent-ui | BMW 自有 sandbox Assistant 界面，仅暴露可信 Host IPC |
| platform | 桌面 Shell、Project、设置、权限、会话协调、计划任务和应用生命周期 |
| browser-capability | 唯一 browser 工具、Action Catalog、Bridge、浏览器页面操作和图像结果准入 |
| media-native | 原生媒体采集、处理、旁白和合成 |
| feature-video | Project 视频草稿、Studio 手动操作与自然语言操作 |

默认入口装配 DSH `0.2.1-rc.2`、Codex App Server 和 Qoder CN SDK，由各官方运行时拥有 Agent Loop。自有 Assistant、统一设置、显式历史迁移和唯一默认入口已实现。GPT-6 封装时的完整离线快照及三驱动对应型号两轮真实验收通过；后续登录交互完成 32 项局部检查，未重新执行全量或付费模型。各报告的源码与适用范围见 [VERIFICATION.md](VERIFICATION.md)。Codex GPT-6 的独立工具封装与验收见 [实施状态](history/agent-drivers/IMPLEMENTATION.md)。核心只依赖契约，禁止直接依赖具体驱动的 RPC 名、页面存储、DOM 选择器、预设与凭据。DSH 使用官方启动 token/cookie 鉴权，日志脱敏；Workspace 和会话历史通过官方 WebSocket 快照读取，取得快照后取消订阅；修改操作留在驱动内。

驱动装配点为 `apps/bmw/product.ts`，具体创建逻辑在 `agent-assembly.ts`。所有驱动必须遵循相同归属契约，不能把 BMW 页面/媒体所有权、权限或任务队列转交给模型。现行设计见 [AGENT_DRIVER_DESIGN.md](AGENT_DRIVER_DESIGN.md)，阶段验收见 [历史实施记录](history/agent-drivers/IMPLEMENTATION.md)，未完成项见 [下一步设计](plans/NEXT_STEPS.md)。

DSH 预设装配官方 `compaction-basic` 与 `compaction-tool-result-pruner`，由每个官方 Agent 在上下文压力与溢出时生成摘要、裁减旧工具结果并持久记录；长篇抽帧审阅可在同一 BMW Session 和原生 resume anchor 下继续。工具结果裁减门限为8192字符，保留前4096及后1024字符；原始 Project 媒体、Studio 草稿和宿主审阅回执保持原文件。驱动核对相邻 `compaction/prune`、单个旧序号、`surfaceOp:replace` 和 `sourceEventSeqs` 后将替换回执视为历史投影；不生成新工具完成事件、不关闭当前工具占用。孤立／错配／冒充当前调用的替换拒绝。有效目录仍须恰好一个 `browser`，压缩不引入模型工具或 Host 推理循环。

## NEWS-01 新闻选题与制作

Agent草稿摘要的每镜`preparationInventory`显示已绑定引用数、来源数和主视频／图片段数，明确`motionVerification:not-performed`；它不认证素材运动、相关性、日期或事实。read-scene/timeline在既有分页内增加`layerSetAllowed`、`sceneStartSeconds`和`editTimeDomain:film-seconds`，区分独立对象与主素材、局部与全片时钟。非法编辑／原生图层字段的拒绝回包提供有界字段名及合法字段，仍严格拒绝、不静默改值。

`news-preparation` 是唯一 browser 的既有 `video.studio` 内新增封闭操作，要求当前 draftId/expectedRevision；preparationRequest 为 read/preflight/enable/record-scene/record-scenes/prepare-shots/prepare-scene-references。read 返回保存声明，preflight 只读检查当前实际媒体 SHA、可解码轨道和源区间、精确来源引用、实际日期文字及逐镜声明。每镜返回 fingerprint、durationSeconds、sourceIntervals、assets、missing/stale/unverified/verified-by-agent/verified-by-user 状态及缺口；模型按最多20镜／16KiB分页读取。read/preflight 不保存草稿或清单。

逐镜清单独立保存在 Project `video-studio/news-preparation/<draftId>.json` version1，绑定 Project/Session/draft，至多96镜／1MiB，使用独立 checklist revision CAS；不能通过导入／更新／恢复草稿冒充。record-scenes 接受1–8个不重复镜头的实际观察声明，单次全片事实／指纹预检、全部核验后一次清单 CAS；任何过期、证据缺失、人工声明保护、取消或 GUI 并发编辑均整批拒绝，不保存部分声明、不自动重试，也不自动生成观察。record-scene 兼容单镜入口。两者需当前 preflight fingerprint、编辑目的、实际 artifact/reference ID、观察动作与相关性、来源日期标签、完整原声和中译或明确未使用原因。复用实际 prepare-reference 的源SHA、PNG哈希与全部逐帧分析；真实视频声明至少三个样本、两种不同PNG且覆盖选用区间两端。源素材、PNG、稿件、引用、取景、时长、顺序或全片图层变化使记录失效；可见全片媒体也核文件哈希。原声声明需主画面实际启用且有可解码音轨覆盖，日期声明须在实际镜头标签／脚注或覆盖全镜的可见文字层中存在。scene.set 的封闭 patch.label 可编辑至多44字符的原生标签。检查累计源/参考文件限512MiB／128项，结束前重核SHA及草稿revision；超预算须先整理本地分段。

准备指纹使用实际可编辑的主素材区间、播放速度、取景、动态效果、源声开关及音量等视觉语义；容器与轨道检查产生的派生时长、生成旁白和字幕证据不伪装成视觉编辑。无 visualSegments 的主素材也使用同一字段投影，不散列整个 scene。资产时间按真实视频轨end规范化，容器尾长不改变同一轨道事实。字幕投影只含实际文字／中译／时间，不因translationOrigin变化失效；先使用与预览／导出相同的speechScene解析锚点字幕、焦点和板书时序，真实映射变化仍失效。源文件 SHA、实测音视频轨范围、引用与观察仍独立强校验；真实裁剪、字幕／译文内容与版式、脚本或源字节变化依旧使准备失效。

`news-preparation/prepare-scene-references` 接受当前 draftId/expectedRevision 与1–8个已有 sceneIds；不接受模型指定源区间或取帧时刻。Host 从当前真实主视频推导至多8个局部半开区间，同源优先保留每段起点与末点前50ms的候选，再按区间由长到短填充中点，单源仍至多8帧；sampling明确列出boundaryCandidates、timestampsSeconds及omittedMidpointCandidates，省略的中点不能冒充已观察证据。核验实际返回PTS处于起点窗口[start-.1,start+.2]与末点窗口[end-.25,end)，绝不把请求时间或端点后的帧当作覆盖。精确源SHA、PNG与当前区间已覆盖的原生记录直接复用；新增资料全部准备与复核后一次CAS追加参考，保持镜头、旧记录、旧分析和PNG不变。总预算统一32份不可变历史记录／8个artifact+SHA源组；保留原1MiB文档与256MiB原生素材、512MiB/128项清单检查预算。满额、歧义、单源必需边界候选超8、实际PTS不覆盖、源/PNG改变、取消或CAS失败均显式拒绝，不自动重试、删历史或新建壳稿。首组三帧与全部referenceIds返回供实际观察，不自动填写analysis/真实动态/相关新闻结论。preflight逐镜referenceGaps及NEWS_PREPARATION_EVIDENCE带artifact、所选start/endExclusive、实际frame秒数、必需窗口及建议时刻；修正完具体缺口才继续。

正常选题自动启用清单；news-brief 类型以及显式 enable 的草稿也受限，同一未关闭选题 Session 不能通过新普通草稿或直接 video.compose/video.narrate 绕过。enable 只能强化要求，演讲／采访选题要求原声。narrate、narrate-pending、narrate-local 和 render 在执行前拒绝未补齐／过期清单，check 同步返回 news-preparation 错误；批量配音一次准入，实际音频调整镜头时长后导出需更新受影响准备。通用 Studio 未启用新闻要求时沿既有准入。Agent不能覆盖用户准备声明；取消、Project 切换和 GUI 并发修改继续拒绝过期结果。

前0–3秒连续及最后两镜全长须主素材真实视频声明与实测范围齐备；静态卡、定格和相同参考帧拒绝。不同PNG、日期文字存在或 Agent 自述仍不证明连续真实运动、相关性、语义完整、手机可读或日期准确；这些由官方模型基于实际素材判断，并在当前MP4独立逐镜和整片复核。preflight ready 只表示准备门槛齐备，不等于成片通过或人工听感。首次制作与验收边界见[优化计划](plans/NEWS_FIRST_PASS_PRODUCTION.md)。

NEWS-02将候选上限从三项扩大到十项，版本1记录和已有三题批次仍可读取。素材库提供“推荐新闻选题”，由当前官方Assistant通过唯一browser检索与核对，不使用Host模型循环。默认覆盖中美及全球的重要个人、公司、大学／研究团队、公共机构，以及非AI职业重要人物关于AI的实质消息；名字不使用白名单，不按国籍或身份凑配额。按信息增量、公共影响、原始证据及视频表达价值推荐至多十个不同事件，允许零个。新闻价值、同一事件判断和推荐理由属于Agent编辑判断，Host不认证事实或热度。研究中可按最新revision逐批保存完整已合格列表，不以零散网页线索冒充可选卡片；本轮已发现动作字段复用，仅新动作或参数错误时补查帮助。propose-news-topics的操作帮助完整展开候选字段、必填项、枚举与十项预算，不再把候选契约裁掉后指回通用guide。

NEWS-02推荐的Agent编辑要求：优先广泛寻找有真实原声的采访与演讲，再考虑动态演示和同题作品对照，理由需交代观众能从画面直接观察到什么；单纯公告可说明更适合图文，不因易截图而优先。比较案例需实际看预览、核对模型标签和画面布局；作者单次生成花费不能表述为模型单价或总体成本，展示不认证总体胜负。日期前本地时钟不视为片长，媒体参数以实际检查为准。结尾回扣这次消息的新变化与已展示结果，不默认套用通用用途清单、口号或免责声明；需要限定时简短归因，不能用边界说明替代新闻重点。当前54.61秒Codex／龙安朗样片已获用户接受，独立结果见[新闻验收](research/CODEX_NEWS_REWORK.json)，不改变NEWS-01缺省参数或三驱动权限。NEWS-02的43.03秒Chuck Lorre采访新闻另获用户接受，使用龙安朗、原声节选及可编辑大号双语字幕，见[独立交付](research/NEWS_02_LORRE_DELIVERY.json)；不据此认证声学精度或声称跨导出审阅复用已实现。这些为官方Agent的编辑职责，Host不实现新闻价值模型或自动胜负判定。

NEWS-03发布日期识别覆盖发布方常见写法：星期前缀、月份缩写带点（`Oct.`）、序数（`17th`）、紧随日期的本地时钟与 AM/PM、时区缩写（`EDT`、`GMT+8`）以及「`3:04 PM · Oct 17, 2026`」式社交标签，均只证明到民用日期（`precision=day`），仍按 UTC-14 至 UTC+12 的最保守区间检查 72 小时，不编造午夜时刻或时区。更新、修改、录制、抓取类标签（Updated／Modified／Recorded）以及同处出现两个日期、`10/17/2026` 这类歧义写法继续拒绝，避免把更新时间或抓取时间当成原始发布日期；元素含多个日期或被截断时仍判为不可用。只有 `<time datetime>` 明确带时区时才记为即时时间。



研究阶段允许materials list/search读取已有证据，以及index对实际不超过30秒的Project预览执行至多一个本地ASR区间。长素材（包括已索引长素材）在ASR或新增索引写入前拒绝；时长以原生检查与文件SHA为准，不以调用方区间冒充短素材。set-metadata、建稿、TTS、合成及既有草稿编辑仍受用户选题门禁约束；不新增工具、供应商或自动时间批准。

新闻制作引导要求采访主视频显式保留原声：类型编辑读取真实主画面clipId后使用clip.mute muted=false，不把独立画面图层解除隐藏视作恢复声音，也不向scene.set提交未支持字段。最终MP4需按采访实际时间窗media.audio.sample，并通过materials原生ASR检查该导出样本；源片ASR、存在AAC音轨及全片非零峰值不能替代此检查，背景音乐本身也会非零。指标／转写与人工听感仍分别登记。

AI新闻系列面向对AI科技及全球最新变化感兴趣、接受少量英文和术语、关注重要公司／机构／人物的观众。普通快讯约45秒，重点事件约120秒，以事实与本人原声为主、少量有据解读，必要术语简释且不进入实现细节。前0–3秒连续真实动态视频，后续相关真实视频承担主体信息；图解、数据可视化和聚焦截屏／录屏用于解释与证据，不能以单纯静态文字展示组成独立段落。资料画面持续标注可核验的录制日期，不能核验时明确标为发布日期并保留精度。图片运动、页面滚动、生成画面和旧成片不满足真实视频要求。随片交付逐段文字稿、实际原声及译文、来源日期与待核事项，核实重要当事人回应并区分承诺、渠道、细则与到账。完整定位、选材写稿制作规范和审片量表见 [新闻制作流程](NEWS_DAILY.md)。准备准入不自动认证真实运动、日期或报道完整性，也不把未满足要求的历史作品改标合格。

`propose-news-topics {expectedTopicRevision,newsCandidates}`保存版本1候选；`news-topics`读取当前卡片及有效性；`select-news-topic {expectedTopicRevision,topicId,baseFingerprint,options?}`仅可信BMW用户界面可调用；`news-guide {draftId,expectedRevision}`读取当前选定草稿的逐镜头引导。候选是闭合结构，含主体／个人或组织／类别／地区、标题／新闻点／理由／角度、形式（采访／演讲／公告／原帖／图文）／新事件或新发布、录制日期／缺口、同Project的sourceId／acquisitionId、精确UTF16 quote／quoteStart及previewArtifactId／image或video模式。来源必须有完整observed正文、作者、可靠的原始发布时间与精确引用；预览必须属于该次获取、原文件与原生解码证明均可核对。图片至多32MiB；视频预览须实际可解码且至多30秒，显示原片区间。采访／演讲形式必须有真实视频及可解码音轨；source acquire method=capture可显式fromStart=false，从实际播放器当前位置采集关键发言，缺省仍从头。原播放器位置／速率／loop恢复且保持暂停，原生证明记录实际源区间；download／preserve拒绝fromStart等录制参数。只取得图片或静音素材时需要明确提出图文候选，不能把海报当采访或在选定后静默降级。可见`time`元素的`datetime`仅在显式publishedSelector下有界读取，须带时区，其他情况保留可见日期；显式日期范围中混有署名或文号时，仅可提取唯一、完整的发布日期行或明确Release／Original Issue Date标签的日期，保留原始日／时区精度，多日期或截断范围不做提取，不拿抓取时间补发布时间。

纯文字公告／原帖可先source collect，再调用`media.screenshot {selector,index?,sourceBinding:{sourceId,acquisitionId,expectedRevision}}`。selector/index必须等于已收集正文范围。原生层在截图前后核对URL、范围与正文SHA；全程主Frame导航（含in-place）或Renderer丢失即取消，版本冲突不接纳。来源截图保留长页细节，边界为1024像素宽／8192像素高及32MiB／16MP，较长页面不会仅因超过1536像素高被压成窄条；实际PNG按图片预算核对，Host原子加入同一acquisition的已确认image-decoded素材及不可由Agent提交的页面截图来源证明。它是原页渲染截图，不冒充网站原始下载图片；失败只清理本次新PNG／证明，不改变草稿。返回有界IDs和sourceRevision，不返回整份来源目录。

Host按当前UTC检查原始发布时间严格在近72小时，未来／日期不明或歧义的内容拒绝，选择时重新检查；仅有无歧义年月日的来源保留日精度，不伪造午夜或时区，按UTC−12至UTC+14的最保守发布区间核验，区间跨出72小时即拒绝。原始发布日期范围中的`1:42 · 2026年10月18日`一类本地时钟＋完整中文日期，只提取日期，保留同一保守区间；无效时分、多日期、相对日期和未来日期仍拒绝，时钟前缀不成为带时区的精确发布时间。原始直播／首播页的“直播开始日期”“Streamed live on”“首播日期”“Premiered”可作为首次发布标签解析，保留原文和日精度，仍按同一保守72小时窗口；相对日期和旧内容重发不会因此合格。新发布旧采访另标录制日期，旧片转发不能当新消息。相同事件键／获取ID／原始URL或正文SHA不重复入卡，其他语义去重仍由Agent负责。卡片显示原始来源、作者、发布时间、核验时间、真实预览及待补内容；搜索摘要和TTS不能冒充采访。候选资料及网页文字均为不可信内容。模型读取为有界预览，精确原文继续走source/read，不复制截断回包写入证据。

候选及用户选择存于Project内`video-studio/news`的独立version1记录，固定Project／Session、独立revision与指纹、256KiB单记录上限，拒绝损坏／链接文件并保留原件；新任务保留此前已选记录和草稿。确认先持久化Host分配的草稿ID，再创建同Session草稿；重复确认不会重复建稿。默认9:16／720p／24fps、目标45秒、Qwen安明远男声／0%，select的显式options可覆盖；设置开关及凭据仍独立验证，无静默回退。用户点击后通过已有Assistant投递机制继续，先保存uncertain投递状态，返回runId才记sent；失败或重启不自动重发。Agent不能自行确认、改选或关闭用户已选任务。

素材库选题交接提供本次新闻Qwen音色选择，初始仍为安明远，选择时通过已有options显式写入新草稿；不改变全局默认或已有音频。素材库候选卡片点击“加载真实预览”后才读取原文件，避免同时读取十份媒体；候选核验仍逐项实际解码。确认前该Session的Agent仅可研究取材，Studio创建／写稿／配音／合成以及直接video.narrate／video.compose被拒绝。可信用户可“退出新闻选题”：先取消并等待实际任务清理，再关闭等待限制；没有可确认的取消控制器时保留限制并报错，保留来源和记录；对应closeNewsTask仅可信用户可提交。确认后写稿、证据画面、实际旁白与字幕、成片审阅使用已有草稿与时间线，不升级Video Document格式。配音／渲染前重核选中来源，Agent渲染须可见使用所选预览，或通过原生来源身份与文件SHA核对的同一原片高清素材／裁切转换片；不再强制把低清选题预览烧入成片。选题预览仍保留为选题证据并照常复核。原生录制／保全保存版本1 origin旁证，转换保存版本1 derivation旁证（父子artifact及SHA、请求源区间）；只在Project内沿最多8层、无环且未变更的链回溯到与选定预览完全相同的VideoIdentity，或同Project可用来源获取记录。不以同站、同标题、同扩展名或Agent说明认定同源；缺少可信链、文件篡改、异片、图文降级及来源变化均明确失败。历史无新origin旁证时，Host可只读核对本Project/Session已接受run内配对的browser media.video.capture成功记录、明确VideoIdentity、既有原生capture索引及当前视频SHA；验证通过则复用旧高清，后续正常转换建立新SHA链。仅消息文字、失败或无配对调用、异Project/Session、缺索引及文件变化不能作为历史凭证；不修改旧历史或回填伪造旁证。没有这类可信记录才需正常重新获取。新闻只读刷新经Browser FIFO执行、合并重复请求，关闭时等待实际读取清理。技术阶段状态不代表内容、听感或最终用户接受。制作背景默认填可读选题摘要，技术身份保留在独立记录；引导统计有效独立字幕或句锚投影字幕，锚点失效单列问题。标题卡及有效图层按既有就绪检查判断，不把无素材标题卡误报为画面缺口。

“查看原始来源”先保存当前GUI编辑，优先显示同Project中URL完全相同的已开页面；没有时才新建前台页面，并切到浏览器。打开期间禁止重复提交并沿用Studio取消／Session转换保护；不重定向其他同源用户页面，不因重复查看来源而反复新增后台tab。

尚未开始投递的ready状态可由用户明确点击“继续所选题并制作”恢复，复用同一草稿ID；达到草稿数量上限也不阻止读取已经创建的同一草稿。uncertain／failed状态只查看已有草稿及任务事实，不借此自动重发。配音字幕阶段同时检查旁白有效性与字幕存在，逐镜头显示引用、原片起点和待修问题。无旁白的原声镜头在素材音轨开启、音量大于零、已测源区间覆盖和有效字幕齐全时可就绪，不强制生成TTS；静音或源区间不足仍未就绪。news-guide逐镜返回scriptReady、audioMode（source／narration／missing）及audioReady，GUI原声行不再显示“旁白待生成”；这些是配置与时间范围检查，不替代成片解码、音轨核听或用户接受。

直接保障：video.news契约、browser.sources日期采集及studio.news隔离原生GUI；真实DSH检索、用户选题、Qwen配音和最新新闻成片另验，不并入离线通过数。

新闻研究引导要求先用news-topics的时效窗口预检日期／原片，再局部读取搜索结果，首条合格候选立即提交并逐批补充至最多十项，不先遍历历史成片／旁白。多个同源查询需显式不复用或串行读取。Qoder转存大结果时只回到原网页局部读取，不开放宿主文件工具。引导要求约每20次调用自查、接近80次仍无卡时收束说明；这是官方Agent任务节奏建议，不是Host强制计数、定时取消或自动重投，用户可明确延长。研究结束暂停并关闭本轮Agent页、等待实际关闭并核对列表，保留用户页与Project文件。用户选题入口与确认门禁保持原契约。

## 类型制作与 AK 增量（Video Document 2.10）

`preparation.production`（规范文档 `content.brief.production`）是可选的闭合版本1工作表，固定 `profileId/profileVersion`，支持 `news-brief`、`science-explainer`、`research-explainer`。保存受众、主问题、目标时长意图、段落角色／目标／观察任务、稳定镜头引用与材料角色；实际时间仍只有现有时间线。`production-profiles` 读取版本化类型指导及六种有限配方；不改变模型目录、权限或预算，不安装外部 skill。`propose-type` 给保留／填充列表和候选 VideoEdit，`adopt-type` 要求同一 revision 与精确提案指纹；重新读取实际来源／设置，拒绝过期提案。配方仅填空画面说明及符合条件的空卡片槽，已有 GUI 编辑不被覆盖；测量配方明确要求填写真实数据。`production-read` 对工作表各部分按至多20项／32KiB分页（句目标省略Host绑定原文），`production-review` 给当前版本的缺口、人工量表、当前内容／MP4指纹及独立 assessmentRevision。`record-production-review` 记录五项类型检查、试听状态、观众复述／条件预测和说明；actor 由Host决定，Agent不能声明人工试听、观众回答或通过人工必需的check-5。GUI提供显式人工记录；只有当前指纹下的用户五项通过、实际试听声明、复述（T2/T3另需条件预测）且结构无缺口，才显示“已验收”。这是用户声明，不是Host科学或听感认证。Host记录保存在Project内version1类型审阅账本，固定Project／Session／draft，独立CAS，至多40项／256KiB，保留最近用户与Agent记录；普通文档更新不写此账本。内容、源文件、实际MP4或渲染版本改变后旧结论失效，技术可制作、Agent意见、人工试听、观众复述分开。

研究来源工作 `works` 明确作品类型、题名、作者、版本及已有 source/acquisition；`relations` 只接受引文、点评、主张、复现、转帖和版本关系，要求明确端点并拒绝版本／转帖环。`claims` 区分 fact、quote、author-claim、reported-result、replication、commentary、inference、limitation，并关联现有镜头与引文槽；服务校验同 Project 原文身份和既有引文，但不认证科学正确性或已独立复现。`goals` 引用段落与已有 card/focus 的句绑定；Host 保存首次明确采用的音频／脚本／句／目标身份，旧 goal ID 的记录不可由普通更新改写。改音频、重复句、删除或更改目标后显示重绑；明确新身份才重新采用，不保存另一套秒数。

新闻类型保留工作表v1及默认45秒目标；`production-profiles` 提供普通／重点时长指导。`production-review` 按显式 `targetDurationSeconds` 区分普通（≤60秒目标，实际30–60秒制作余量）与重点（>60秒目标，实际90–150秒制作余量），不再把约120秒重点新闻一律报成超时。时长结构检查不能替代实际节奏和受众审核。

六种段落配方当前为v2：原始素材与引用主导画面、短标签、观察→变化→解释节拍，避免把长旁白铺在静态要点卡上；提案返回recipeVersion，指纹包含该版本。它们是创作指导，不是Host自动认证叙事质量或替用户改稿。测量图例在实际可读字号下测量总宽度，足够时横排，否则逐行；不缩小字体以塞入字幕带。原生检查覆盖约84%高图表下方的真实字幕像素，renderer版本10使旧版导出失去当前复用身份，原MP4不删除。

`plan-impact` 是只读派生查询，可试算既有 VideoEdit及可选`cover`候选（沿用export-cover闭合选项，只替换候选封面，不保存、不编码），逐页返回至多20项 keep/rebuild/rebind/review 与原因。基准绑定 revision、内容、实际素材 SHA、来源 acquisition、设置与渲染版本。来源事实读取限256个选定artifact／512MiB，超限明确失败，不截断证据。改一句旁白要求重做该镜头音频及重绑依赖，独立字幕／译文保留；换图保留旁白，相关阅读／聚焦需检查；独立字幕修改要求版式复查和整片重编；只改封面沿既有规则复用已验证 MP4。计划不是权限、队列预约或执行回执，各执行动作继续独立校验 owner/CAS/FIFO/Project 排除和取消清理。

科学图解 `science.version:2` 新增 `events` 与 `measurement`；旧四种 version1 图解继续使用2.9。events 最多32元素／128事件，每事件最多32个有限 active/value/text/highlightLine 变化，稳定ID、目标、时间顺序与预算均校验，状态每次从保留时钟重新派生。node/phase/memory/code/chat/group 支持节点、阶段、记忆条、代码行和聊天面板；code可含最多8行、每行80字符的只读codeLines，highlightLine为0（无高亮）或现有行号，事件可改变高亮行但不执行代码。父容器深度最多2；整体变换／裁切沿用所属原生图层，分组可自由布局或有界文字堆叠，超出可读面积拒绝并指出标签尺寸。measurement 支持零基线线性轴的独立绝对值分组柱图，以及线性／对数轴散点；最多4序列／128总点，单位、域、基线、分类与明确来源是同一数据。拒绝非正对数域、越界、空来源和重复分类，不改数或伪造空值。Studio 表格、共享 Canvas 预览和原生导出消费同一契约。

`precompose` 的 `gridRecipe` 是 version1 grid，rows/columns 相等且取1、2或4，输入填满方格（最多16），1–30秒，12–30fps，320–1280宽／180–720高；输出仍只接受既有受限宽高比。输入仅 Project artifact、源起点、速率及可选受限源裁切，音频显式 `mute` 或 `first`。media-native 按2×2分块使用最多4个叠加解码器输出中间片，再组合最多4片代理，不提高全局4解码器／8层／64对象预算。源资产与累计输出各限256MiB，整个任务十分钟；报告保留配方、源／结果SHA、布局／尺寸／帧率／渲染版本、用时、应用进程组每100ms采样峰值RSS、Host进程高水位与磁盘指标。采样峰值覆盖整个BMW实例，Host高水位也不伪称只测此任务。结果与配方报告关联当前草稿；`precomposition-status` 只读取属于该草稿的报告并重核哈希，变化标 stale，无自动缓存复用。代理内部对象不能在最终片直接编辑，可用原配方显式重建。取消或失败等待真实原生任务和IO清理，只移除本次产物；清理失败保留隔离，由 `media.record.stop` 显式恢复。CompositionProcessor 与 ArtifactJobIO 的失败清理允许恢复，不用吞掉关闭错误释放媒体准入。

`assetVersions` 保存至多64个外部结果的显式父链、输入、服务／模型标记、参数、指令、视角、保留区域和来源作品。Host 对首次采用结果及输入记录实际SHA，同次采用去重且限256个身份／512MiB，旧ID不刷新身份；改变文件、输入或父链须显式新版本，当前审阅提示失效。支持保全已有外部研究素材，不表示 BMW 已实现三维生成、外部服务登录或付费服务端到端。实际调用与许可／质量验收另记。

音频准入支持矩阵见 [官方运行时音频准入核验](research/AGENT_AUDIO_ADMISSION.md)。当前三个BMW适配路径均无已验证音频内容准入；WAV、ASR、指标与图像审阅不能被记为模型核听。

## 自有 Assistant 装配（四官方驱动）

- BMW Session 固定 Project 与 driver，provider Session 是不可替换的原生恢复锚点。空会话先于后端连接出现；切换 driver 选择该驱动的既有活动会话，没有才创建空会话，不复制其他引擎的原生历史。
- Assistant 保存显示消息、事件和输入回执；显示历史不是模型恢复协议。未知投递不自动重发，重启把未完成回执标为 unknown，并显示断连原因。会话索引、偏好和历史全部读取验证后再执行恢复写入；损坏文件保留，启动提供重试/退出。
- Agent 相关 Project/Settings/Conversation/History/Preferences/Schedule 文件统一采用 v2，迁移提交标记为 `agent-data-version.json`。日常启动只接受当前格式；历史 Profile 明确拒绝并提示独立命令，不再执行历史导入、自动字段修补或 legacyImportPending 重试。
- 显式迁移通过 harness-dsh 的独立导出入口，在临时复制的原生 Home 上调用官方 cold session/list、workspace/follow、session/follow/page，冻结 cursor 并完整读取。保留已有 BMW Session ID、原生恢复锚点和显示历史；尚未纳入索引的旧会话按原 ID 导入。已归档且原 Workspace 已移除的 Project 必须由 Session header cwd 证明归属；缺失或跨 Project 身份失败。只导入人类/模型文本，原生 context、私有推理和图片不复制为显示消息，不伪造输入回执。
- History 保存统一 owner `{projectId, driverId, externalSessionId}`，启动验证与索引完全一致后才执行通用崩溃恢复。DSH Workspace 从 Project 文件迁移至 `dsh-home/bmw-project-bindings.json`，新目录或 Workspace 不得静默替换既有映射。迁移命令备份受影响元数据、检查输入/输出与草稿哈希、最后提交标记；写入失败回滚本事务文件，并保留并发修改。操作及恢复见 [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md)。
- apps/bmw 的 createBmwAgentAssembly 装配 DSH、Codex、Qoder CN、WorkBuddy，默认从实际 BMW userData 派生 `agent-drivers/codex`、`agent-drivers/qoder-cn`、`agent-drivers/workbuddy`，保留 DSH 的 `dsh-home`；物理路径别名及父子目录重叠被拒绝。Codex 公共 CLI 安装可通过正常 PATH、固定应用 CLI 路径或明确的 BMW_CODEX_EXECUTABLE 发现，缺失时设置仍可显示安装状态，不启动模型。每个引擎仍需在输入前通过实际目录门槛。默认入口只使用此装配；旧 DSH Client、Runtime port、DOM context poller 和专用 preload 已移除，全部 Shell/Feature 会话操作进入 BMW Session service。最终真实模型复验与目标工作区验收以实施状态中的实际证据为准。
- 自有 Assistant 设置通过可信闭合 IPC 调用各引擎官方控制 API，不产生模型输入、持久化测试会话或 browser 执行。账号投影与表单 Schema 不含秘密值；密码框在提交、关闭按钮及 Escape 时清空。Codex 浏览器登录、Qoder 官方 CLI 登录、DSH 凭据设置/退出留在适配器内。Qoder CLI 未验证非交互退出，UI 保持该操作禁用。新 Profile 的默认 driver 为 DSH，之后按 Project 保存选择；应用启动不自动发起登录，GUI 首次切换到未读取的 driver 后懒加载登录状态；打开设置只在该 driver 从未尝试读取且 Host 空闲时首次加载，后续查看与切回复用 Profile 内分 driver 内存缓存；缺少凭据时弹出登录方式，登录对话框可切换其他 driver，先取消并等待当前登录实际清理。登录成功后显示可选模型并由用户点选“确认选择”；无需用户发起工具目录验证或模型推理。模型偏好按 driver 保存，认证、支持名单与账号目录匹配并等待原生控制清理完成后才提交；确认后关闭弹窗。状态读取完成后关闭登录框不会反复自动弹出，切回已读取 driver 不重复检查；已读取状态缺少认证或有效模型时禁止发送。同一 Agent 的设置读取在已有设置操作期间合并，不重复启动原生读取；打开设置窗口不与驱动切换再次竞争刷新。认证和模型修改仍保持独占，切换等待取消和实际清理完成；对话状态明确显示设置读取或连接清理，清理隔离时不能合并读取。设置/取消/原生清理持有 Host 排除，清理失败进入隔离，恢复仅重试清理；小窗口保留底部操作，Assistant 跟随 BMW 明暗主题。
- 设置缓存只存经过验证的无秘密显示投影，不持久化或跨 Profile/控制器共享，也不按 Project 重复读取。登录状态参考有效期 5 分钟、模型目录 30 分钟，分开显示最后检查时间与待检查标记；过期仍展示上次结果，不自动轮询、后台启动控制连接或绕过实际任务准入。手动「刷新状态」「刷新模型」均调用现有官方联合读取，成功且实际清理结束后同步更新两个时间。认证/模型修改先使旧投影失效，失败或取消不会恢复旧就绪状态；刷新失败保留旧显示与原时间，首次失败不因反复查看而自动重试。宿主模型偏好或驱动 baseline 变化会丢弃对应缓存。真实任务失败（包括认证/模型准备拒绝和连接失败）保守标记对应 driver 的两部分待检查，不猜测诊断文本、不自动发送/刷新；取消不作为失效事件。外部账号/配置变化不监控磁盘或凭据，仅通过手动刷新或后续官方任务验证发现，重启清空内存缓存。缓存查看不获取 Host 排除；原生读取、登录、模型写入与清理仍保持排除/隔离。
- 每个适配器维护明确的支持名单，并与官方目录取交集；Codex/Qoder 读取账号状态及原生模型目录，DSH 只检查本地 DeepSeek Key 是否配置并读取官方 Provider 目录，不进行 API Key 有效性或余额验证；未知模型及 Qoder 标记禁用项不显示。Codex 支持 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna`、`gpt-5.5`；DSH 支持 `deepseek-official` 下的 `deepseek-flash`、`deepseek-v4-pro`，认证只使用 `DEEPSEEK_API_KEY`，其他 Provider 凭据不构成就绪条件且退出时保留；Qoder CN 支持 `auto`、`qmodel_38max`、`qfmodel`、`qmodel_latest`、`qmodel`、`q37fmodel`、`dmodel`、`dfmodel`、`gmodel`、`gfmodel`、`gm51model`、`kmodel_latest`、`kmodel`、`mmodel`。设置投影中的 `verified` 表示维护名单支持，不表示用户运行过预检或账号拥有推理额度；Qoder 的真实模型验收目前只覆盖 `auto`。
- 设置不要求用户执行专项验证。Codex 设置选择不调用工具预检；Qoder 冷控制会话仍内部检查 SDK init 的有效工具目录并禁止任何模型消息，DSH 使用官方 cold 设置／目录控制。三者设置均不发送模型输入。
- 官方引擎拥有 Agent 循环，Host 只协调输入和资源。输入前有效目录必须只有 `browser`；DSH 0.2.1 在官方 `agent/created` 初始化中限制该 Agent 的继承工具为 `browser`，预设指定 native 工具呈现，Host 准入及每次 request assembly 检查实际 `wireSchemas`（含呈现方式），并核对请求事件目录。该限制随官方 Agent 作用域清理，不能以提示或执行拒绝代替。未配置 Key 时新版官方目录隐藏模型，配置后才与 BMW 支持名单取交集；冷设置不发送模型输入。Qoder 禁止继承 plugins/skills/settings，Codex 检查 Responses 及 Lite additional_tools。Qoder 对意外非 browser 权限请求返回拒绝但不主动中断当前轮，实际工具目录及后续事件仍执行原有严格准入。内置 BMW 指导遵循当前 Project 设置和可信新闻选题，不写死项目品牌、音色或某台机器的服务故障。目录成员不证明账号推理额度或实际请求可用。
- WorkBuddy 使用固定官方 `@tencent-ai/codebuddy-code@2.169.0` / ACP v1，每次 prepare 先运行隔离目录探测：禁用所有 settings sources、使用 strict MCP 和 `NoDefer(mcp__bmw__browser)`；catalog-only BMW MCP 从认证 Bridge 读取当前完整 browser，禁止执行。固定探测文本仅发送至本机 HTTP sink，sink 只观察官方实际模型请求并始终返回 503，不转发或生成模型响应，不使用真实 Key。只有请求恰好含一个 `mcp__bmw__browser`，模型、说明和 schema 全部相符才准入；官方仅将顶层 additionalProperties 投影为 true，此已知投影严格匹配，Bridge 仍独立执行原闭合请求校验。无工具的辅助请求不构成证明；额外工具、身份／schema／版本不符、Project 或祖先 `.codebuddy/models.json` 覆盖均失败关闭。实际任务与探测共用固定启动策略；CLI／Node／MCP 文件、模型、区域、凭据密文及原生历史指纹变化拒绝输入，每轮重新检查，不缓存可变 profile 的目录证明。
- WorkBuddy Key 由桌面 composition 注入系统加密服务，密文原子写入宿主独立 profile，禁止 basic_text 和明文回退；无法解密或旧明文文件保留，须显式退出后重配。设置刷新仅检查本地配置，不发送模型输入、不证明 Key 有效性或额度。通用设置新增 `configured` 表示 Key 已配置；此状态可选兼容的 unverified 模型并发送实际任务，其他驱动 ready 状态仍只允许 verified 模型。当前兼容名单为 `deepseek-v4.1-flash`、`glm-5.3`、`glm-5.3-flash`、`kimi-k2.8-preview`，任务准备再与官方 Session 模型目录取交集并核对当前模型。仅真实任务成功后，当前 Key／区域／模型组合显示已验证；新任务开始前撤销该证明，失败不会误报认证通过。与另外三驱动的 verified 名单语义分别保留，不自动产生付费探测。
- WorkBuddy 实际运行使用一次性 Home，真实 Key 仅经受控环境传入；关闭并确认官方进程及其 MCP 进程组退出后，仅原子保存该原生 Session 的有界 JSONL 和 BMW Session／Project 归属映射，删除其他临时认证缓存。续聊和目录探测各复制同一个原生历史快照，不能替换恢复锚点；探测不修改原历史。准备、实际任务与清理均持有驱动排除，失败清理保留所有权，显式 drain 只重试清理。当前原生进程树清理验证覆盖 macOS；Windows 在输入前保持不可用。上下文随实际输入注入，事件串行写入；只有官方 prompt response 的 userMessageId 是输入回执，传输写入不冒充送达。模型失败的 ACP outcome 不按 end_turn 成功处理；未知投递不重放。WorkBuddy 的 deepseek-v4.1-flash 已通过用户授权 Key 的单次 browser 实际调用，Host 工具完成／官方回执／清理状态及刷新后的任务验证状态见 [脱敏记录](research/WORKBUDDY_BROWSER_DELIVERY.json)。图像／音频准入、原生桌面可见历史和其他模型真实服务仍未验收；单次实际调用、官方 CLI＋本机模型夹具与另外三引擎的真实模型证据分开记录。
- Codex 有效工具目录验证通过后，在独立 CLI Profile 的宿主私有 `bmw-executable.json` 保留已验证执行文件路径。显式 `BMW_CODEX_EXECUTABLE` 优先，否则已保存路径优先于 PATH；不可用或非法记录失败拒绝并提示显式恢复，不退回其他版本。保存路径不代替每轮版本、文件内容及实际工具目录验证。成功工具回执保留 JSON 文本（最多 16384 字符）；大结果保存明确标记的有界预览，模型仍收到完整准入结果，历史不保存图像 base64。
- 原生卡片预览与导出共用中文换行：自动末行仅剩一个汉字时，在不超宽、不破坏数字／英文单词或显式换行的条件下重新分配上一行。字幕底框和描边根据实际前景色明暗选择白色或黑色，保留用户字体和位置。模板内容契约发布 focus 必需区间、slow-push 与 zoom/focus 互斥、attach 清除旧聚焦及固定逐项展示不代表语音同步的条件。
- Codex App Server 执行协议仍仅接受 `0.160.0`、`0.160.1`，错误明确显示实际及已支持版本。模型缓存作为数据单独接受上述版本及已核兼容的 `0.164.0` 格式，以支持用户显式选用由桌面端刷新过的原有 Codex 配置；接受缓存格式不授权运行 `0.164.0` CLI，未知缓存版本仍拒绝并显示实际版本。对 `gpt-6.1-sol`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6-luna` 使用官方启动配置 `model_catalog_json`。输入准入先由明确选定且版本已验证的官方 CLI 执行 `debug models` 读取完整原始目录（有界输出、取消与超时，不创建模型 turn），避免并行旧 CLI 覆写共享 cache 或 `model/list` 不落盘导致缺型号；共享 cache 不作为该路径的权威。再从该官方目录生成内容寻址的只读策略副本，移除强制 code mode/多 Agent 元数据并清空额外实验工具，保留模型 ID、原生 Lite 传输、推理等级、上下文、图像能力和模型指导。不改写官方 cache/config、不复制凭据；官方运行时仍可正常刷新其缓存。副本必须是宿主私有的普通文件，模型缺失、路径碰撞/篡改和实际额外工具均失败拒绝。官方config/read仅提取继承MCP服务器名称；空表会合并旧配置，因此预检和实际start/resume都逐项传enabled:false，不复制服务器命令、URL或凭据，不修改用户配置。目录预检与实际启动使用同一个副本；实际模型请求恰含 BMW browser 的准入仍在输入释放前执行，用户模型选择不触发预检。GPT-5.5 保持原有路径，未知 GPT-6 型号不自动套用策略。BMW 不增加模型循环、代码执行工具或其他宿主权限。
- Host 私有租约绑定 canonical BMW Session；provider 注册只能解析已明确附着的有效 Host 租约。MCP 执行 scope 通过私有环境传递，显式 catalog-only 模式只提供目录且禁止工具执行，模型传入 `__bmwSession` 始终拒绝。撤销等待真实 kernel/worker 清理。完成事件在实际清理前不结束回执或释放 FIFO；原生清理失败同样隔离资源，恢复仅重试清理。
- 自有 Assistant UI 按发生顺序穿插显示消息和最近 100 条事件中的工具进度；流式消息保留首次出现的位置，同毫秒按 Host 事件顺序显示。工具显示已完成、失败、执行中或结果未确认，停止与断连不伪装成功；最终回复后显示本轮完成／停止／失败状态，历史重载保持相同顺序。界面提供运行状态、停止和资源恢复，支持 Browser/Studio 模式与上下文。基础 Markdown 用 DOM text nodes 渲染，模型 HTML 不执行。fork 未验证时在会话中心禁用。新的退出路径等待 Assistant 原生进程、Bridge 和 Feature 实际清理。
- 三个真实引擎已分别通过隔离 BMW 的页面、截图读图、canonical Studio owner 和同一 provider 续聊。DSH/Qoder/Codex 在每轮完成后关闭原生运行进程，以原生存储恢复后续输入；这不证明原生桌面侧边栏同步。测试不用生产桌面 Profile；正常官方 CLI 登录配置与 desktop 私有凭据分离。
- `qoder-bmw` 作为 harness-qoder 的复用 skill 指导随包分发，SDK 装配直接使用固定指导并保持空 skills 目录；skill 不建立连接和权限边界。接入说明见 [QODER_BMW.md](QODER_BMW.md)。

Shell 运行时徽章从自有 Assistant 状态发布，显示等待、执行和资源断连，不依赖原生桌面页面。

直接覆盖：Conversation/History/Host/Assistant Controller、四个驱动契约与 `agent.data-migration`，`assistant.application`、六项 `assistant.startup.*`，以及显式 opt-in 的三个 `external.assistant.*`。



普通 `video.compose` 在有宿主验证的 BMW 会话时，成功后原子保存该会话所属的新 Studio 草稿、原始分镜及已有 MP4；返回 `studioDraft` 并通知已打开的工作区，不覆盖已有草稿。已有音频保留为导入素材，不推断 TTS 生成参数。直接 `bulletRevealSeconds` 无法无损表示为 Studio 语音锚点时，保留独立成片并明确返回 `studioWarning`；没有会话的宿主调用仍只合成媒体。失败、取消、所属 Project 变化不登记新草稿。Studio 无草稿时显示明确空状态，加载完成后不继续显示“加载中”。

## 全局素材库与三个工作区

BMW 顶层并列提供浏览器、素材库、Video Studio。Host 激活各功能运行时并统一协调模式、布局、上下文和关闭；素材库由 feature-library 提供，Studio 保留制作、时间线、配音和导出。三个入口共用当前 Project/Session，切换模式不创建第二个模型循环或对话。

素材库默认聚合全部未归档 Project 的已保存来源和 artifacts，不要求先建立转写索引；归档资料可通过筛选查看。目录支持标题、标签、已保存正文及已有转写检索，类型/Project/收藏/日期/可用性筛选、排序与分页及至多50项批量标签/收藏整理；每页至多50项，正文/转写搜索有界，不隐式启动全库ASR。素材及原文仍归所属Project，收藏、标题、说明和标签保存在该Project的 library/catalog.json（version1、revision、records），支持CAS；损坏记录保留并显示问题，归档Project仅可读取。普通浏览历史不自动保存。辅助审阅帧与证明文件默认不挤占资料列表，可显式包含；批量整理逐项CAS保存，取消保留已完成项并停止后续项。

原文截图登记在既有32MiB图片/像素预算内按最多1MiB分块读取，校验完整静态PNG结构、解码尺寸、所读字节SHA与实时文件指纹，取消逐块检查并关闭输入；不放宽ArtifactJobIO单次读取上限。推荐准备指引要求复用事件已关联获取、实际核对预览属于正文而非推荐侧栏，并将未核实录制日保留null，不以发表日代替。

来源collect优先显式authorSelector/publishedSelector；局部元素难以定位时可用可选metadataRanges.author/publishedAt绑定同一本次完整observed正文内的UTF16 startCharacter/endCharacter/quote。每字段与其selector互斥，引用与实时可见正文逐字核对，日期必须完整原始发布日期行，不得从Updated／录制／转载文字中裁出日期；只保留原始精度，不新增时区或推测时间。位置证据随新acquisition持久保存，read/import重新校验正文SHA及位置，旧获取无此字段保持原样，不自动回填。该绑定证明文字来源，不自动证明署名语义、来源权威或内容正确；推荐仍执行原有日期、身份、原文及真实预览检查。新获取、旧原文与其修订并存，不修改旧正文。

library.materials 提供 search/read/set-metadata/copy；library.sources 提供既有有界 list/read/collect/confirm/acquire 来源能力，模型回复经 librarySourcePage 对列表、原文、候选和媒体分页：正文每页4000个UTF16单元，数组至多20项，nextOffset续读；library.news 提供 news-topics/propose-news-topics 新闻研究。它们均为唯一browser工具的已验证动作，沿Browser FIFO、当前Project/Session、取消及原生边界执行。模型可全库查询有界摘要，跨Project原文/媒体读取需先复制到活动Project；GUI可通过固定本地素材库主框架授权预览其他已登记Project。内联预览上限32MiB、每块512KiB，不接收路径或远程媒体URL。素材库页面禁止联网、任意导航和弹窗。

跨Project复制连同所选来源获取记录、原文、媒体、证明及其保存的依赖一并验证哈希并复制，单次总量512MiB、至多4096个文件；保留原始采集时间、引用区间与证明，目标Project内保持对应ID并记录来源Project身份。目标同名同内容复用，同名不同内容明确拒绝且保留旧文件。事务保存至目标Project library/transfers：preparing/committed/failed/quarantined。源/目标身份、源目录revision和目标来源CAS均重核；中断前已提交来源可识别完成，未提交事务只按本次输出inode清理，清理失败隔离后拒绝新复制；仅可信GUI用户可通过 recover-copies 明确恢复清理。索引/整理副本独立，源Project后续变化不覆盖目标草稿。目标视频可脱离源Project使用。

新闻收集与选题在素材库进行，研究批次保持现有 video-studio/news 的Project/Session归属与旧记录兼容，不搬动历史文件。历史批次可查看并再次选用；过期新闻保留资料，制作时重核时效和来源。确认选题后选择制作Project，跨Project先复制完整证据，再在目标Session保存选题与草稿并进入Studio；先持久化投递状态后发给官方Assistant，uncertain/failed不自动重发。Studio保留新闻制作进度与来源入口，并提供从全库选择素材：返回时按所捕获草稿revision加入preparation，冲突时保留副本并拒绝覆盖GUI编辑。video.studio的旧来源/研究动作仍兼容，研究契约、存储与来源执行已归feature-library。

项目专题与全局方向第一阶段：素材库提供“项目专题”“关注方向”和“成品”。专题在 Project/library/research.json version1 持久化，跨 Session 共享；Profile/library/directions.json version1 保存独立全局方向、采集目标 Project 和专题引用。专题可提升为方向、关联/解除关联已有方向；直接创建方向亦可，原素材、news批次、草稿和导出文件不移动、不改写。创建方向本身不创建计划任务或启动采集；来源订阅可由用户另行启动一次有界手动巡检；保存项目归档/失效显示问题。完整设计及后续滚动事件、推荐和调度阶段见 [LIBRARY_STREAMS.md](plans/LIBRARY_STREAMS.md)。

library.research 是唯一 browser 下的闭合动作，topics/directions/direction-topics/links 为至多50项分页摘要；全局方向摘要每项至多20个专题引用，明确总数。所有新增组织写入仅可信GUI用户可提交，Agent不能分类成品、提升专题、写入关系或启动长期方向。GUI可整理未归档Project资料；Agent跨Project原文/媒体仍须完整证据复制。新增存储使用固定Host目录、4MiB预算、CAS原子写入及链接/目录身份检查；Project每份至多500专题、5000资料关联、5000关系，Profile至多500方向，关系/分组损坏保留原件，原始素材检索继续显示并报告问题。

用途独立于媒体类型：未分类、来源素材、加工素材、预览/中间版本、成品、辅助记录。可信用户可给素材关联本Project专题及多个全局方向，全库可按用途/topicId/directionId组合筛选；方向资料包含直接关联及所关联专题的材料；来源获取记录的专题关联可由其原文/媒体继承，独立整理记录可显式覆盖。旧文件名不构成正式成品证明；用户可显式分类文字/图片/音频等成品，已记录的视频导出自动投影为成品，分类不声明人工接受。参考/reference和计划使用/planned关系可双向分页查询，不声明实际采用。草稿字符串搜索的usage仅为引用线索，不代替导出采用账本。新组织操作沿Browser FIFO及可信素材库主Frame准入执行；Project/Session转换取消过期读取，编辑表单不因普通Assistant进度刷新被覆盖。

## 桌面、Project 与会话

导出溯源第二阶段：Studio render 与直接 video.compose 在真实导出时自动保存 Project/library/exports/<sha256>.json version1 不可变记录；含作品/Session/草稿revision、原生渲染版本、规范化合成快照SHA、输出SHA及采用材料SHA、角色、镜头/片段身份、输出区间与素材文件时钟区间。启用的主画面/原声/旁白（含分段变速）/卡片图片/独立图层/音轨分别记录，隐藏、整段透明、静音、零音量、准备清单与仅参考内容不算实际采用。末帧停留与源原声截止分别标示；此记录表示合成输入采用，不证明被遮挡后的每个像素或人工听感。来源获取和已提交跨Project复制身份随材料指纹保存，采集范围不冒充录制文件到原片的精确时钟映射。

每次真实输出独立一条记录，缓存复用不新增；已提交账本独立于草稿最近30次导出窗口及后续改稿/删除。新增记录先暂存，草稿回执提交后转为完成；遗留暂存须核对同owner/草稿/输出/revision回执才可读取，读取不改写旧文件。账本错误保留成功的既有制作结果并返回libraryWarning，GUI明确显示；取消/CAS失败沿原输出清理路径执行，不生成虚假已提交版本。旧成品只读投影已有导出回执，采用详情标为未知，不从当前草稿反推、不改文档格式或原文件。每Project账本最多4096份有界文件，单份4MiB；全局单次元数据读取32MiB，达到预算报告结果可能不完整，诊断列表亦有界并注明省略，原作品保留。

library.exports 是唯一browser内的闭合只读动作：works（分组作品）、versions（作品或输出文件的版本）、uses（版本采用素材和区间）、adoptions（材料/来源反查采用版本），每页最多20项，按返回页核对当前文件SHA，区分一致/变化/缺失/不可核对/旧未知。跨Project仅返回摘要、身份与区间；正文/媒体仍须复制后读取，归档项目可显式查询。GUI成品按作品分组，可查看全部版本、采用区间和当前文件状态，素材详情可反查成品；缺失成品仍可查看历史记录。Host自动准入是唯一新增记录入口，无模型或普通GUI写账本操作，既有参考/planned关系保持独立。

来源/事件容量第三阶段：新来源记录写入 Project/sources/stream/commits，事件观察写入 Project/library/events/commits；每千次提交一个序号目录，单提交至多4个实体/4MiB，固定命名空间最多一百万次提交。文件为不可变版本1信封，含Project、稳定key、基底指纹、递增序号和前序SHA，原子不覆盖发布为提交点。旧 sources/catalog.json 保留为只读基底，继续按旧200来源/1000获取/4MiB契约验证；新记录不受该单JSON数组限制，同一来源各次获取独立保存。基底指纹改变拒绝混用。来源正文、原候选/媒体证明身份、新闻批次、草稿和导出文件不改写、不搬动；定点来源读取、制作校验、复制及导出绑定使用身份/材料索引，不再依赖整库快照。旧目录/collect回包只提供有界兼容窗口，complete=false附续读指引，不能当作全库。

派生索引使用Node内置SQLite，固定Host路径、禁用扩展，不暴露SQL或路径。增量事务保存实体版本、FTS5 trigram检索文本、精确来源/材料/主题/方向过滤词和已应用提交SHA；原文索引来自实际保存且SHA核对的文件，不联网、不启动ASR。索引缺失/落后/损坏显式报维护状态；重建在新一代文件中分批重放基底和提交链，每次最多100条基底记录/提交、8MiB元数据软预算（完成当前单份有界记录后停止），取消回滚当前索引事务，已完成检查点可继续。原损坏缓存/指针保留；已发布的来源记录不因目录耐久性警告或索引失败撤销，回包给出indexWarning，原始正文保持。缺失/变化正文不重写，检索提示正文覆盖不完整。跨Project只读浏览不初始化或修复索引；旧小目录可只读有界回退（每次至多检查100次获取，原文单份至多256KiB），不为跨Project浏览写缓存。

library.streams 为唯一browser内的新闭合动作：sources/events 按已登记Project返回至多50项摘要，支持关键词与来源过滤，events另支持专题/方向身份过滤。游标固定Project/命名空间、基底、提交快照、查询/过滤/页大小和上一实体key，返回pageCursor可稳定返回首屏；采集新增或修订不会重排已展示分页，刷新才纳入新资料，首次从旧基底进入分片写入也保持旧游标。默认按稳定实体key排序，不声明热点排名。三字符及以上关键词走全文索引，短词走有界扫描；每页至多检查512个索引候选，检索/返回数据使用8MiB软预算及单记录上界；零匹配也可能有nextCursor，只有complete=true且无游标才表示扫描结束。不为有界扫描虚报全库总数。GUI提供“来源流”“事件记录”、Project选择、检索、前后翻页及维护区；后台Assistant进度不重排当前流，隐藏时取消过期更新，返回保留分页。旧全库offset概览/媒体-ASR索引仍有各自预算，来源超出兼容窗口时返回complete=false及sourceContinuations并提示使用来源流；长期来源检索不依赖200件ASR索引。

rebuild和sync-news仅可信GUI用户可在当前未归档Project调用，模型没有维护或事件写入入口。历史新闻显式分批同步为legacy-batch观察，不改原批次；新合格提案自动沉淀verified-proposal观察，保留原Session/批次/候选及证据SHA，同批次稳定身份幂等、不同Session/批次不猜测合并。通用Host collection观察另有runId/recordId/sourceRevision，支持多方向而不要求AI新闻类型；当前无通用Agent写入或自动采集。事件底层不受十条推荐限制，既有新闻可信选择、投递状态和Studio制作门禁保持。原始观察不承担语义归并；第四阶段独立编辑事件提供归并/拆分。十题快照适配由第五阶段独立推荐层提供；周期采集见下述第六阶段。

滚动采集第四阶段：`library.collecting` 为唯一 browser 内闭合动作，提供只读presets/list/read、可信GUI subscribe-preset/put-subscription/start/cancel/revise-lead/put-event/merge/split/rebuild，以及受用户启动任务约束的 Agent save-lead/finish。新增 Project/library/rolling/commits 固定命名空间，沿用版本1不可变信封、每提交最多4实体/4MiB、增量SQLite与稳定游标；订阅、任务、线索、编辑事件及独立audit记录各自有稳定ID和递增修订，操作后快照保存在audit，historyId分页查询历史。只读跨Project查询不建目录，隐藏证据引文和社媒指标原文；原文/媒体仍经既有复制门禁。索引重建每批最多100提交且仅当前可写Project可信用户可调用。旧来源、独立事件观察、news批次、草稿、作品与采用关系零迁移、零写回。

订阅包含平台web/x/youtube、固定HTTPS入口、最多3个备用入口、身份核对依据、地区/语言、至多50专题及方向、following/paused、游标、健康和最近结束检查的回执。Project专题必须存在且开放，方向必须跟踪且采集目标为当前Project；改绑/暂停后拒绝旧任务提交，订阅配置不自动迁移。GUI提供“来源订阅”“采集记录”“滚动线索”“滚动事件”，可在已登记Project之间查看摘要，当前Project可配置、启动及整理；表单列出前50专题/方向并保留已有选择。创建订阅或方向不会启动任务。每Project至多一个未终结采集任务，启动使用当前Session的官方Assistant队列，先持久化uncertain输入收据，返回后记sent；异常/不确定投递永不自动重发，需用户查看并停止/恢复。

固定来源目录提供24个建议入口（机构公告、研究、科技报道及X/YouTube账号、主题和趋势观察）。只读presets不建立订阅或初始化资料；可信GUI“添加 AI 新闻固定来源”显式勾选1–20项，可关联当前Project的跟踪方向，默认paused。subscribe-preset使用Project+预设键的稳定ID与CAS；重复添加只返回原订阅，保留用户修改、状态、游标及历史，不增提交、不启用计划。预设含HTTPS入口、显式备用入口、语言/配置范围及身份核对链接；不代表实时可访问或热点认证。目录是新源文件，不迁移旧订阅或任何已有素材。

每次手动任务十分钟、最多20次保存观察；已到期拒绝后续提交。运行中的截止计时器只取消匹配本次dispatchId的Assistant并等待真实清理，清理工作纳入Project/Session转换等待；无法确认、跨Project、应用重启或清理失败时保留锁与旧游标，用户回原Session恢复，不启动后台补跑。可信GUI停止在浏览器FIFO之外先等实际cancelAssistant（避免等待自身队列），再CAS终结回执，未知活动或其他任务不会被误取消。来源抓取继续用tabs及library.sources的真实可见DOM、单份256KiB及原有浏览器/媒体预算，Host不实现模型循环、直接爬虫或绕过登录。

save-lead要求本轮新获取原文的Project来源身份、真实SHA及精确UTF16引文，稳定身份为订阅+规范URL哈希，同任务相同证据/描述/指标幂等；后续观察和用户核对状态/缺口修订留历史。原始结论不声明事实核验完成。X/YouTube入口和原文URL须匹配平台域名；平台标识须为已存原文URL中一个大小写一致的路径段或视频v参数，例如X趋势入口填trending、YouTube频道填@OpenAI、搜索入口填results；不得填完整URL或趋势标签。闭合Schema及巡检提示给出这些示例；身份与指标错误分开返回，身份拒绝列出该原文URL的可用段，指标缺失可为空且不降级校验。入口快照不是其中每条趋势/帖子的独立身份，模型不应为无关体育娱乐条目创建AI新闻线索。可见指标必须逐字存在于已存文本；保存入口、地区/语言范围、来源采集时间和指标原文，无指标明确为空，不推断增长或全站趋势，新社媒线索按原始URL确定post/video/account/topic/trend观察类型，请求类型不符拒绝；旧social缺少可选observationKind时保持原样，不回填。账号公开资料不冒认帖子或趋势，配置地区不冒认实际观察地区。已识别登录跳转、反机器人和错误页只保留来源及受限检查，不生成内容线索，也不得completed/no-new推进游标；可见的局部账号资料可作为注明缺口的观察。finish如提供任一证据字段，必须同时提供sourceId/acquisitionId/quote/quoteStart，缺字段明确拒绝且不写回；partial/restricted/failed可全部省略。完成检查的证据必须是本轮固定或备用入口；仅完整observed、非登录受限、非截断的completed/no-new可与订阅游标原子提交。无新增不得含本轮新增观察，partial/restricted/failed/cancelled/过期/证据或CAS失败均不推进游标，已提交线索保留。

批量增量采集：`library.collection-batch` 是同一个 BMW browser 内的闭合动作，start/cancel/recover 只允许可信素材库界面，Agent 只可 collect 一次、read 已保存结果并 submit／review 批量线索判断。GUI 在当前Project勾选1–9个关注中来源，显式选择2或3路，绑定当前Session、官方driver和已建立的原生恢复锚点；先持久化uncertain批次再派发唯一官方输入，异常投递不重发。旧单源入口和周期计划不改写、不自动切换为批量或启用。可信主框架的批次启动先等待旧后台输入真实清理并重核主框架／Session／取消状态，再直接执行同步准入、持久化和官方输入入队；不先占用浏览器FIFO而把自身判作忙碌。其他浏览器FIFO、用户任务、Project过渡及隔离资源仍阻止启动，实际采集动作继续走原FIFO和后台租约。未核对的批次与旧单源live任务互斥。Project/library/collection-batches/commits 为独立不可变分片命名空间，保存批次、来源修订、入口证据、pending、规范URL检查点与逐项核对SHA；历史新闻、素材、快照、稿件、作品、采用关系及旧run格式不变。list用固定索引游标分页，Agent的collect／read／submit返回使用精简来源头、每页至多4条且每条至多600字符的原文摘录，标明excerptOnly并按nextOffset翻页后一次submit；不让整批长正文被官方运行时折叠为browser无法读取的本地文件。可信GUI仍每页至多20篇及完整来源缺口，原始全文／2400字符快照／SHA与已存检查点不裁剪、不改写。 新批次官方输入使用 collect 的 reviewFormat=compact：一次返回全部至多20篇候选的序号、身份、标题、日期与至多220字符摘录（整包UTF-8上限20KiB，必要时统一缩短摘录），以及每条确定规则筛选结论，不再要求四条分页。固定窗口仍为创建时近72小时；原生核对已存全文SHA，显式带时区原始日期保持偏移，公历日期按UTC±14小时保守区间且要求正文见证；无年份／相对／缺失日期、时区边界或不完整正文保留pending，仅可证明完全在窗口外的原文自动skip。趋势保持未核实观察。后台批次绑定的操作白名单同时允许review，且必须保留完全相同的Project／Session／batch及Agent身份；可信start／cancel／recover不能借此进入后台。review只接收唯一候选index与save+summary或skip；省略项保持pending，原生按冻结原文补齐身份、标题和精确引文，再走既有逐项SHA／证据／检查点提交；不可覆盖规则保留项，不创建事件或新闻推荐。submit旧格式的JSON Schema按save／skip／pending闭合分支，与运行时必需字段及禁用字段一致，防止模型提交skip时夹带标题等字段。旧collect／read分页、旧记录与GUI保持兼容。

一次原生批量动作内部用2–3个独立隐藏、静音、无前景挂载的页面lane并行导航和可见DOM读取，不增加模型工具或Host模型循环，不重用用户页面。九个入口全部检查后，至多20篇正文按来源轮流分配（每源含入口至多20次观察，总页面预算60、截止10分钟）；只有该动作的collect操作使用600秒MCP传输期限（包含排队时间），read／submit／start等沿用60秒缺省；业务截止、用户取消与真实清理仍独立生效，不重放超时输入。原文和检查点经串行提交器读取最新revision后CAS写入。正文/署名/原始日期与scope如实保存，未知日期为缺口；冻结近72小时新闻核对范围取批次createdAt，不扩展七天。列表指标变化不改变文章身份；X趋势入口同次原文作为可审阅original供一次submit保存相关观察线索，platformId=trending，强制注明词条与事件关联尚未核实且保持partial/旧游标；它占用20条结果预算，不能自动产生事件。链接提取仅限同次可见正文范围，原文与链接读取期间变化则拒绝混用。批量专用隐藏lane的导航仍保留25秒硬截止，但主文档提交后，以固定主frame的有界读取等待文档解析完成（interactive／complete）、固定正文范围、样式表就绪及至少250毫秒文本稳定，不等待无关defer或load事件；正文已就绪则停止无关资源加载，并等待原生loadURL实际结束，停止不排空时必须真实关闭页面，不以Promise竞速提前释放FIFO。普通用户页面与其他导航路径保持原加载语义。明确HTTP401/403/429或可见访问墙可提前转受限证据；没有main的访问墙使用固定body范围保存，并不冒充文章正文。同批以订阅ID隔离受限熔断，只拒绝该订阅尚未开始的排队URL，所有pending与旧游标保留，已在途任务仍真实清理；普通网络超时不自动推断整源受限，新批次重新观察，不永久封禁。正文采集前对固定选择器做最多4秒的有界DOM就绪观察，至多200次检查、每次200个文本节点；未就绪保留缺失范围结果，不扩大正文或自动登录。已知同次themeRefresh替换仅允许保持原始页面域名、路径、视频ID及其他查询参数，最多等待5秒稳定后读取现存页面，不重新navigate或派发输入；其他替换拒绝。量子位没有time标签时，只接受完整正文头部前10行中与独立已获取署名相邻、后接时钟的唯一有效公历日期，保存精确UTF16日期见证，不推断时区或使用抓取时间。固定DOM适配无法读取时保留失败/受限与旧游标，仍可用旧手动入口核对。

每源pending最多200个URL；超过100个积压时下一批只补读已存pending、不读取新入口，以免有界队列静默丢弃未读。只在入口完整、链接范围未截断、全部候选已保存或明确跳过后推进有界范围检查点；空白、无链接、partial/restricted/failed/cancelled均不表示no-new。Agent一次submit多条save/skip/pending，逐项复核原文SHA与精确引文、社媒URL及可见指标；核对SHA按固定字段顺序和可选空值规范化，相同内容不因JSON字段顺序重排产生重复提交；新的决策不能覆盖已提交核对。事件整理、归并拆分、推荐及可信选题权限保持。用户任务沿原后台yield取消输入并等待所有页面/读写实际排空；页面清理失败保留隔离和精确dispatch对应的执行域，可信recover只清理旧资源，不重新派发。无dispatch回执而运行时仍忙或存在unknown输入时拒绝恢复，不能把关闭页面视为官方输入已结束。

编辑事件为用户明确整理的版本化对象，引用最多100条已存线索或第三阶段新闻观察；现有“事件记录”可单条整理为滚动事件。修订标题/摘要/依据和证据集合保留历史；两事件归并原子产生一个有父关系的新事件并把原事件标为merged；拆分要求原证据完整、无重复划为两个非空集合，原事件标split并记录两个后继。每次操作最多3实体+1audit原子提交，保留原事件及每个版本，退休事件不可覆盖。GUI支持证据详情、线索核对、归并/拆分及历史分页。它们不重定向旧批次/作品引用，不自动推荐、创建草稿或解除可信选题门禁；事件推荐十题适配已由下述第五阶段提供；周期调度见下述第六阶段。

事件推荐第五阶段：`library.recommendations` 为唯一browser内的闭合动作，policy/list/read为有界摘要，prepare允许当前Project/Session的Agent为已关联原始证据的有效滚动事件补齐选题资料；put-policy/begin/advance/mark/rebuild只许当前未归档Project可信GUI，accept-shortage/activate另需可信用户的目标Session。Project/library/recommendations/commits为新固定分片命名空间，沿用每次最多4实体/4MiB的不可变提交、CAS、可重建SQLite与稳定分页；新增Host-only getAt按固定提交序号定点读取历史实体，不接收模型SQL或路径。策略、事件资料edition、构建快照、排序候选、范围标记、明确接受不足、旧news侧车准入和实际选题关系分别闭合版本化。旧sources、rolling、观察、news version1、草稿与成品格式不变，不迁移或清理。

策略按Project默认或当前采集Project的方向独立保存，冻结策略ID/版本及1–168小时原始发布时间窗口（默认72）、recent/evidence排序、分类/地区/文字关键词与是否排除已看。项目专题按事件保存的topicId关联筛选；策略词是明确的文字包含，不声明语义分类或社媒热度认证。快照保存方向/专题身份及名称/说明，策略修改不重排旧卡；方向改绑不移动旧策略。seen/excluded/clear独立按Project或方向记录，Project排除对该Project全部方向有效；已看/已选不冒认成品，实际制作仍以导出账本为准。GUI按每页50个方向/专题翻页并保留已选范围，策略可编辑并显式保存。

prepare绑定事件revision/SHA及全部所引线索/观察指纹，必须引用这些证据中的source/acquisition，Host重新校验原文精确UTF16引用、真实原作者/发布日期、同源图片或至多30秒视频预览的SHA及原生解码；采访/演讲仍需有声短预览，社媒指标不替代原文/日期/预览。既有新闻观察仅在原批次revision与观察一致时可复用候选并重核；有后续批次修订则需要显式补齐资料。资料不满足或事件修订后不自动假造选题。GUI可一次把明确方向/专题交给现有官方Assistant补齐至多十个事件，Host沿现有持久输入队列投递，不实现模型循环或自动制作。

begin固定服务器截止时间、rolling/观察/edition/范围标记序号、策略和稳定事件游标；每次advance发现最多3事件（不超过设计5的上限），逐个保存经核验候选和排序key，与构建进度同一原子提交。原文日期按现有保守时区/日精度规则过滤；图片与动态预览不互相冒认。发现完整扫描后，第二遍按动态证据/原始发布优先的确定顺序分页（每批最多20），以事件ID、原始事件键、来源URL、正文SHA及共享证据去重，选取十条；不以名气、国籍配额或社媒计数排序。后台新增/修订、后写edition/排除标记不进入旧构建，索引重建后可恢复；已过期或不符合策略的已存元数据先过滤，不对这些记录重新启动原生预览检查；其余每次原生核验和提交支持取消，已完成进度保留。达到前端每轮10步预算只暂停，显示继续构建，不伪称全库不足。

只有扫描完整且选出十个独立合格事件才标complete；少于十个标shortage，保存实际就绪数量与退役/排除/未补齐/修订过期/证据无法核验/时间窗口/策略不符/重复/证据预算等计数。完整/不足的终态快照不再写入，内容指纹覆盖策略、截止时间、索引版本、事件及证据版本、顺序、原文/预览SHA、理由与缺口。补采或改策略生成新快照。1–9题仅可经用户明确接受后使用，接受为独立目标Session记录，原快照仍标不足；零题不能接受或制作。GUI提供“事件推荐快照”、分批进度/继续、策略和专题、历史、原文/预览入口、明确接受不足以及接入新闻选题；后台进度不重建当前快照或未提交策略表单。

activate在同Project整批打开，跨Project只复制用户所选一题的完整证据，再建立目标Session独立news批次及侧车admission；新批次沿既有新闻历史规则保留旧批次字节，失败不覆盖旧批次。侧车精确绑定snapshot、候选/facts指纹和冻结窗口，模型不能通过Studio参数放宽时效。新闻服务固定既有Host Project的规范目录并拒绝目录别名改绑，底层分片目录/文件身份边界保持。普通旧批次仍72小时且保持NEWS_EXPIRED等原错误码；绑定候选禁止Agent替换。既有新闻可信用户选择入口在创建唯一草稿之前重核快照/当前事件及证据、排除状态、时效和真实预览；已选草稿后续只重核其原证据，不因滚动事件后续修订替换或阻断固定草稿。跨Session/Project选题保留侧车和窗口身份，新快照草稿使用通用专题受众，普通旧新闻保留AI受众缺省；单次制作投递仍ready/uncertain/sent/failed，不自动重投；实际选题关系另存，不冒认导出。周期调度独立于推荐，见下述第六阶段；不自动发布。

新闻准备新增确定性的批量快路：`materials/search` 可用 `query:""` 加 `queries`（1–8个非空词）作单次有界 OR 扫描，返回实际 artifactId/SHA、本文件 ASR 时间和已记录的父原片偏移；不发起新 ASR、不自动判断新闻或画面语义。超出文件处理/检索预算时保持明确 unavailable 并推进扫描；回归覆盖不返回永久不变的继续位置。

`news-preparation/prepare-shots` 接受模型明确选择的1–8镜（每镜1–60秒、批次至多120秒）及原片 ID/SHA、局部起止、脚本、日期标签、原声开关和精确引用。先校验全部源与引用，再由 media-native 顺序复制短片段、核256MiB参考预算并抽实际帧；源偏移转换为短片的局部时钟。全部完成且重核源/片段/帧哈希、Project/Session/draft CAS 后，一次追加实际 fullscreen 镜头与原生参考记录。旧镜头/用户编辑不可覆盖；取消/失败不提交半成品镜头，保留已完成原生资料。Host私有 `video-studio/shot-checkpoints` 用 UUID、归属、版本、无链接文件和原子CAS固定进度；Project可读JSON仅诊断，不作为参考/时间映射权限。显式 resumeId 只在完全相同计划、当前草稿及已清理阶段下复用实际哈希匹配的已完成片段/帧；inFlight/已提交拒绝自动重做，不确定输入绝不自动重放。返回 current revision、checkpointId、阶段耗时、已提交镜头和真实参考 ID；首组三帧可直接观察，余下按 referenceId 读取。参考仍没有语义分析和审片通过，须模型实际观察后照旧完成 reference analysis、逐镜清单、原声中译/字幕、导出及独立审片。

结构化 `[BMW production]` 日志按 operationId/Project/Session、operation/suboperation、stage/sceneId 输出单调时钟 elapsedMs、completed/failed 与复用标记；批量结果和检查点携带同一阶段摘要。`[BMW tool timing]` 按 runId/callId 保存调用起止、时长、成功与无其他在途工具时的 outsideToolGapMs；原有持久 Host 事件仍保留。日志不输出脚本、原文、完整请求/响应、路径或凭据。工具时长包括队列/传输；调用外空档包含官方模型、网络、上下文和调度，不冒称服务器纯推理时间。只有实际分镜提交/清单齐备/导出/内审里程碑能表示制作阶段推进，读/help/抽帧次数不表示完成率。

可信定时任务 GUI 可将已绑定任务切换为每小时或原每日时间。每小时 cadence 持久为可选 intervalMinutes=60，仅支持60分钟；保留每日时区/时刻及历史。小时任务每次只合并为一个待执行轮次，不无限补跑停机周期；不重放 running 中断输入。Host/Bridge/FIFO/媒体或清理忙、Project转换／不在当前Project、未授权Agent控制或已有定时执行时保留queued，真实空闲才markRunning。单纯停留Studio页不判忙；被动list/read/assets/news-topics/news-guide刷新不取消后台，实际编辑／检查／渲染仍按前台规则。原生采集与小时推荐在空闲边界交替准入，另一类已等候时同类不连续占用；撤回需求90秒过期。原生采集可为前台真实清理让行；小时推荐仍是普通官方输入阶段，至多10分钟、超时等待Host实际取消与drain，不能声称即时抢占或真正并行。queuedAt/startedAt/finishedAt 分别保留排队与执行耗时，单个队列run去重；后台日志输出等待原因、准入、执行和实际drain，不输出正文或错误原文，日志sink失败不改变任务结果。小时候选整理仍由已授权的官方运行时和唯一 browser 完成；保存候选报告不等于用户采用、推荐快照激活或制片准入。

长期采集第六阶段：可信素材库GUI新增“周期采集与健康”，不增加模型/MCP工具、browser动作或Agent调度写入口。独立Profile `library/collection-schedules.json` 为闭合version1原子CAS控制账本，至多100计划及最近200健康通知，读取缺失文件不初始化；损坏/链接/目录身份改变保留原件并停用，不回退空库。计划固定方向、collection Project、BMW Session、官方driver、1–50个来源订阅、15–10080分钟周期及系统提示偏好。方向必须following且目标Project相符，订阅必须following并属于该方向；每方向至多一个计划。已有方向/订阅不自动启用。GUI分页列出计划，分页选择方向/订阅，支持暂停/启用、系统提示开关、通知已读、显式核对恢复和改绑当前Session/driver；结束旧轮次后可显式重配Project/方向/来源/周期并保持暂停，旧收据与材料不变；有旧轮次时禁止直接改绑。仅可信素材库主框架能调用闭合schedule IPC，Agent不能建立、启用、恢复或修改这些计划。

调度器每30秒检查（任务截止另设定点唤醒）、全局每步最多投递一个官方输入，按最近投递时间轮转到期方向；一个有限周期中每个到期来源只检查一次，每个仍限制十分钟/20次观察，不限制素材库积累数。每来源独立保存nextAt、failures及实际结果，失败不推迟其他来源；周期结束不表示每个来源都完整成功。未激活的绑定也可在固定 Project 的独立隐藏浏览器执行，不切换前台 Project/Session、驱动选择或工作区，不自动改绑。Host准入同步重核Project/Session/driver、成员/归档状态、未知收据及资源，忙碌Agent、浏览器/Project过渡、普通计划任务和原生录制/处理/合成/旁白均让行，空闲Studio页本身不判忙。模型输入仍由既有官方driver prepare验证有效目录恰有BMW browser后释放，Host不实现爬虫、模型循环或额外能力。

后台域由Host私有租约绑定注册的Project、Session和driver；普通Bridge租约仍要求活动Project，后台租约每次调用/返回重核其固定所有者。所有官方适配器沿用同一认证Bridge及有效的唯一browser目录。隐藏WebContentsView沿用BMW Chromium Session但不加入窗口，不恢复/保存用户页签；静音/暂停播放，禁止弹窗、JavaScript对话框、权限弹框、下载和调用显示捕获。固定动作门禁只允许status/help、tabs.list/open/close、navigate、observe、library.sources的list/read/collect，以及本轮collecting read/save-lead/finish；最多200调用、20次原文收集及原rolling十分钟期限，每次准入重核本轮租约，不开放制作/媒体/项目文档/计划修改。来源端口在DOM读取后的提交前再次核对租约；原文、线索和完成状态直接写原Project，来源游标仍须完整检查证据。后台交互请求不弹前台问题，记录unknown并要求显式核对。

低优先级后台输入沿用AgentHost的持久输入收据与FIFO。用户输入通过同一准入进来即abort先前后台输入，用户输入等待其实际browser/native drain后执行；可信用户浏览器操作、会话/驱动选择及Project切换先让行并等待清理；后台占用不禁用前台会话/工作区选择或前台制作入口；Feature活动标记为background，实际全局资源仍由Host持有。素材库自动只读刷新不触发后台取消，写入和用户任务才让行；手动采集准入先等待后台清理并只核对旧轮次，不在该核对中抢先派发新周期。定点cancelBackground只作用于该后台run，不取消同Session稍后排入的用户输入。Bridge撤销租约、排空工具和关闭所有隐藏页，与官方驱动实际drain共同完成后才释放；关闭失败保留租约清理句柄与隐藏页隔离，显式恢复再次清理。清理失败维持Host隔离及采集锁，显式resources.recover只重试清理。调度顺序为Profile轮次及确定runId落盘、rolling uncertain收据落盘、Host输入收据落盘、官方投递与rolling dispatchId登记；即使官方任务先完成，也保留dispatchId而不覆盖已完成采集结果。调度与人工巡检共享Project live锁，互不绕过。

重启逐个核对当前轮次与原Host收据，只合并停机期间遗漏为一轮，不按历史周期无限补跑。不存在rolling收据的预备项可重新准备（写序证明尚未进入Host）；有rolling uncertain、无dispatchId、Host收据缺失/unknown、投递异常或清理后结果不确定均进入review并停止自动投递，绝不重放原输入。已确认的成功/失败/中断也必须等待该Host run完全drained，官方成功不替代原始入口检查证据。仅rolling completed/no-new提交证据后原子推进游标；缺检查的官方成功按失败处理，其他情况保留已采集线索、旧游标和历史。截止前的确定中断让行至少一分钟后才允许从保留游标开启新的有限检查。失败、受限、超时和没有实际新增证据的partial只对本来源指数退避，从5分钟加有界确定抖动开始、上限24小时；完整成功只重置本源失败数。有新增原文证据的partial保留资料和旧游标，按正常周期再检查，其他来源继续。新增比较投递前持久startedSequence对应的不可变线索版本与本轮已保存的URL/bodySHA，不把重复子集、指标或模型声明当进展；缺旧基线时保守不认证新进展。已有version1账本可缺sourceStates/startedSequence，保留原轮次和收据安全补齐，不把无归属的旧计划退避复制给全部源。plan.nextAt由待检查来源最早到期时间派生；全部冷却时等待最早单源到期。当前Agent读取有效本轮run时，Host可附continuation：只引用同Session/订阅/输入/旧cursor的上一已结束partial，至多20条且12KiB的实际URL/SHA/标题/缺口摘要；被后轮或用户修改的证据不复用，changed/omitted明确保留。后台仍只准read当前runId，不新增跨ID历史读取权限；使用本轮fromCursor，不读其他任务。当前没有完整pending URL或DOM位置断点，不宣称精确网页断点恢复。配置失效先取消已知输入并等清理，再要求用户修复。

健康状态waiting/healthy/backoff/review、等待原因、下次时间、连续失败数、最后起止时间及本轮待检查来源保存在Profile；原始run/证据/修订历史仍保留在Project rolling分片。问题状态变化生成持久通知，同一退避/待核对状态去重；整轮从故障恢复才提示恢复，常规无新增不提示。系统Notification可关闭而持久健康通知继续保留，通知不会自动切Project。用户显式核对旧输入后只能结束旧轮次、保留游标并暂停；随后可在原Project显式绑定新的Session/driver再启用，不改写旧Host unknown收据或恢复锚点。旧Session含unknown时自动采集继续拒绝。可信 Assistant 提供按 Session/run 精确指向的“结束已取消旧任务（保留历史，不重发）”；用户明确声明取消后，Host 复核当前 Project/Session/history 绑定、目标无 pending/active/quarantine 清理资源，才原子保存 finished/interrupted 与 user-cancelled-unknown 处置时间和原 unknown 状态。该记录表示用户取消，原执行结果仍未核实，不伪造 provider 完成事件、不改写历史消息/事件/原生恢复锚点、草稿或成片，不调用中断/重发/模型；迟到回调不可重开已结束输入。失败清理必须先显式恢复实际清理，不能用处置绕过。允许结束同 Session 已清理旧任务，同时保留另一当前任务的资源、状态和交互；处置完成后仅允许新授权输入，周期旧轮次仍须显式核对/暂停并重新启用，保留游标。也可显式绑定新的 Session。后台采集不改新闻批次、推荐快照、选题、草稿、成品和采用账本；全部既有路径及可信用户选择制作门禁保持。

素材库的 Assistant 进度刷新保留未变化新闻卡片的已加载预览，不因核验时间更新重建播放器；Project/Session 切换与隐藏工作区仍暂停媒体、撤销本地预览URL并取消过期读取。隐藏工作区不因后台活动通知恢复读取。

来源采集的 authorSelector 可显式指定可见机构 Logo 的 IMG 元素，原生读取其精确 alt 作为发布单位；仍优先可见文字，最多280字符，超限保留截断问题而不作为完整候选。不可见图片、meta content、任意 aria-label 不提供署名，Logo 不替代正文或新闻预览。全库默认同时隐藏原生 speech UUID 的 raw/log JSON 与 preserved UUID 的 preservation JSON；显式包含辅助文件可查看这些记录，普通用户JSON文档仍正常显示。

- 一个 BMW 主窗口，浏览器、素材库与 Video Studio 为共享工作区；右侧 Assistant 使用同一会话。关闭或切换 Studio 不退出应用。
- 页面视口仿真仅改变网页布局和截图尺寸，原生显示区域仍由工作区边界决定；大视口取材、切换标签页及缩放窗口不能覆盖 Assistant 或 Shell。
- Shell 渲染器关闭后台节流，使被原生工作区遮挡时仍更新布局与窗口尺寸；设置、会话及计划任务弹窗在重新打开和短窗口下保留可见操作区。此项不新增模型权限。
- 顶栏以导航、Project、录制和 Assistant 为主；主题、网络、搜索、布局、登录和模型设置进入 Settings。Shell 对话框使用一致字体、主题和控件。
- Profile `BMW`、Chromium 分区 `persist:bmw`。Project 包含 ID、目录、主页、页面状态、文档、媒体与草稿；核心不存储原生 Workspace/Session 映射。
- 每个 Project 可有多个 BMW 会话，各自固定 driver 与原生恢复锚点，共享 Project 页面和媒体。BMW Project 切换恢复所选 driver 的 BMW 会话；Assistant 只能选择当前 Project 的会话，跨 Project 选择拒绝。原生 Workspace 只由需要它的 harness 维护，不参与 Shell 或 Feature 的选择逻辑。忙碌期间禁止 Project/Session 切换。
- Project 管理支持创建、选择、改名、主页、文档编辑和 archive；archive 保留文件且至少保留一个活动 Project。无永久删除 Project 的 UI。
- 文档包括 AGENTS、MEMORY、TASKS 和结构化 memory 文件；单文档 256 KiB 上限。Agent 只能追加指定记忆文档。
- 会话中心提供列出、内容搜索、创建、选择、改名、archive、排序。所有操作验证属于当前 Project；fork 按实际驱动能力启用，当前自有 Assistant 未开放原生 fork。未验证的原生 fork 不通过历史入口开放。
- 旧 Profile 的 DSH Workspace/Session 由显式迁移保留，废弃连接器及侧栏字段仅在迁移时清除，不在应用启动时处理。无聊天软件连接器、聊天转发、其他产品导入或 WebContainer 配置。

保存状态加载遵循失败保护：只有确认文件不存在才初始化。Project、Settings、计划任务、权限、布局和登录保持配置的 JSON 损坏、版本不支持、结构错误或读取失败抛出 `BMW_STATE_LOAD_FAILED`，保留原文件，阻止默认状态写回。启动在加载错误时提供重试/退出；重试重新读取原文件，不自动重置或恢复备份。Agent 相关文件只接受 v2；已有 BMW Project/Session 与已删除任务的完成运行历史保留，旧 Settings 需显式迁移。加密登录快照同样保护读取、解密、版本和结构错误；失败后后台保活、快照及配置写入被拒绝，必须显式修复并重新加载。加密暂不可用时不写快照；恢复可用后先读取验证并恢复既有快照，再采集当前 Cookie。权限和布局兼容无版本号的历史数据。
- Project 页面状态保存至多20个HTTP(S)地址、活动地址和逐页来源（user／agent／page）；活动地址保留在预算内。旧URL-only状态缺少身份凭据，保守恢复为用户页，不猜测并清理历史页面。重启或首次激活恢复已保存页面；Agent页至多6个并保留活动页，恢复期间不保存半完成状态。离线加载失败保留原URL和来源身份，不把Agent页升级为用户页。
- 同源Agent页优先复用；新页在加载前执行6页LRU预算，加载失败也不能累积无上限页面。Agent页弹窗继承Agent身份、同样受预算及Browser FIFO约束；用户页弹窗保持page身份。离开Project前，在Host转换锁内保存页面地址及来源并等待Agent页面实际销毁，返回时按保存身份恢复；用户手动页面保持原实例与跨会话共享。该回收只释放浏览器页面，不删除Project素材、原文、草稿或成片。

直接覆盖：platform 的 Project、driver-boundary、product-boundaries、project-panel-layering、global-settings、layout、permission、scheduled-task 测试；agent-contract 的 context-sync；DSH 的 runtime/preset、harness 映射及独立迁移导出。实际 UI 覆盖：driver/desktop/Studio smoke。生产 OS 钥匙串授权由用户完成，不在隔离测试覆盖范围。

Shell 的全部 46 项 invoke 使用统一主进程准入：只接受当前存活 Shell 的主框架及固定本地页面地址。其他 Renderer、子框架和已导航页面在应用处理函数运行前被拒绝；Shell 页面禁止自行导航和打开新窗口。媒体 Worker、Studio 和 Agent 的专用 IPC 仍按各自 sender/token/Project 规则处理。

## 浏览器、工具和权限

模型只有 `browser` 工具，Action enum 与 Schema 通过认证 Bridge 发布；Core 和 Feature 注册冲突在启动时失败。没有额外 shell、文件、凭据、cookie、IPC 或资源工具。

`browser {action:"help"}` 返回当前注册的核心与 Feature 动作索引，`forAction` 可查询一个确切动作的说明与闭合输入 Schema；仍使用原有 Bridge 的权限、Project/Session 和 FIFO 边界。所有入口在副作用前校验动作顶层字段、必填字段及基础类型，不接受另一动作的字段；例如 `sourceEndSeconds` 不是 `media.video.capture` 输入。未知动作/字段返回有界 JSON 错误，包含 code、validation 阶段、executed:false、合法动作或字段及 help 恢复请求，不回显参数值。嵌套媒体和 Studio 请求继续由各自契约校验。Codex 每轮启动/恢复的指导从当前准入目录生成动作索引和 help 用法，不依赖用户补充契约或历史 Project 笔记；不会因此增加工具或宿主模型循环。

Feature 可在动作注册中提供自有帮助投影，Core 不导入 Studio 实现。`help {forAction:"video.studio"}` 返回操作索引；`forOperation` 查询单个 Studio 操作，来源工作流再用 `forSubOperation` 查询 list/read/collect/confirm/acquire 的准确闭合字段和必填项。大型编辑/卡片嵌套 Schema 明确标记为投影并指向现有 describe-edit/describe-template，不把整个文档 Schema 混入帮助。Studio 请求校验错误返回 BMW_STUDIO_ARGUMENTS_INVALID、executed:false、适用的合法字段／子操作枚举及可执行 help 恢复请求；未知 source capture 子操作应恢复到 acquire，不能反复猜别名。帮助索引压缩说明，不改变认证目录、权限、Session 或官方 Agent loop。

新闻准备的首次操作帮助同时提供 `read/preflight` 两个只读请求的完整闭合 Schema，明确 `schemaSubOperations` 与覆盖范围，仍要求当前 draftId/expectedRevision；调用者不必再为无嵌套内容的读取多查一次子操作帮助。其他子操作仍按 `forSubOperation` 返回精确写入契约；该只读 Schema 不接受 enable/记录/原生准备等变更，也不放宽实际服务校验。materials 的目录帮助保持原有形态。

Studio采用作者v2／独立审片v2提示词，video.review任务策略版本为4（仍可查询v1/v2回执，去重不复用旧策略任务）。作者提示编译于feature-library，审片提示编译于feature-video。没有新增模型循环、browser动作或持久化Schema。Studio 指导把制作端与独立审片分为两个阶段：制作者在源素材／布局预检与导出后核机械完整性，使用当前MP4的有界风险时刻取帧检查变更处，再启动 video.review 并结束当前轮以释放FIFO；不先重复完整逐页审片。作者不默认重复全片motion和最终原声ASR/PCM。官方独立审片先核可读取原始技术证据的当前MP4 SHA、完整范围、ROI/语言/参数和工具版本，只补缺失、失效或异常部分；无法读到旧原始结果不声称复用。源片ASR不能替代最终音频。独立审片仍必须实际查看当前导出全部镜头关键状态页，核同片原声ASR/PCM证据，记录本轮新的逐镜及独立整片判断。仅引用变更不启用增量审片，不新增自动证据缓存。相同指纹下可复用技术证据，制作端的风险抽查不能代替完整独立审片或人工听审。

时间线读取与编辑指导明确：主画面的 clip.move 是整段调序，不改变共享切点；同源连续片段若需保持全片时钟，可在同一校验事务中先延展后段起点，再修剪前段终点，仍受源范围、效果窗、字幕和对象边界校验。必须读回实际保存的片段时钟；合法／保存成功不能证明预期切点已改变。该说明不改变命令或提交语义。

发布的工具 Schema 在共享字段类型之外，以 action 判别的 oneOf 保留每个动作的说明、必填字段与闭合字段集合，不把另一动作的合法字段当作当前动作可用参数。绘图说明提供最小 draw/annotate 示例：draw 创建新画布，要求 width/height/shapes；annotate 标注已有 artifactId，要求 shapes，两者都不接受 filename。运行时仍独立校验真实请求。绘图校验错误报告 request、shapes[i] 或 points[j] 的具体未知字段及允许字段；只返回有界字段名，不返回参数值。错误绘图动作同时说明新建与标注的区别。Qoder 固定指导及共享 Studio 说明要求新字段／卡片先读取 describe-schema 索引与 describe-edit/describe-template 的有界契约，支持当前 2.0–2.9 与专用槽契约；编码校验成功不代表可读性或编辑质量。

| 功能组 | 当前行为与边界 |
|---|---|
| 页面与导航 | Project 内标签页创建、列出、切换、关闭、导航、历史、搜索、后台默认及用户接管 |
| 观察与交互 | DOM/可访问性观察、点击、输入、键盘、滚动、悬停、等待、页面只读信息与受限页面执行 |
| 页面诊断 | 受限 console/network/load/media 摘要、失败证据；绝不扩展成宿主执行 |
| 截图与图像 | viewport/selector 截图、Project PNG artifact；不改变背景页滚动位置；viewport/selector 均按页面坐标经 CDP 抽取，Studio 用不透明工作区覆盖页面，保留页面渲染表面以继续取材；对截图阶段设期限并取消 |
| 权限 | 用户控制 Agent Control；按站点处理设备权限；用户侧敏感操作保持权限边界 |
| 登录连续性 | 用户主动选择站点后用 OS safeStorage 加密 cookies，并周期性 HEAD；关闭不清除当前登录 |
| 计划任务 | 固定 Project、BMW Session、driver 与时间/时区，保存 runs、执行/取消/删除；绑定失效报错且不自动换会话，无绑定旧任务暂停并提供手动“绑定当前会话”；排队/运行时禁止重绑，只用 browser |

标签页新建／复用导航和navigate有25秒原生期限并接收取消。取消或超时先stop并等原生loadURL结算；仍未结算时可关闭Agent临时页面并等destroyed，确认实际清理后才释放FIFO；用户页面保留并隔离，需可信用户从BMW明确关闭。关闭失败也隔离浏览器资源，status／tabs.list／help和显式tabs.close恢复入口可用；恢复前不启动其他工作，Project切换仍受排除。

浏览器媒体只允许活动Project的活动tab在浏览器工作区播放。切换tab／Project或进入Studio时，Host立即静音并暂停原页及跨域子Frame中的audio/video；页面后续play事件也被拦截，返回tab不自动续播。保留用户页面不保留后台播放。每次页面加载及原生media-started-playing重新核对，最多128个Frame、每次3秒；失败保持原生静音并记录诊断；子Frame换页／销毁的短暂失败不阻断启动或切换，后续Frame加载重新核对；成功安装策略后才解除活动页的原生静音。无法控制的Frame暂停状态不可声称已验证，可从诊断定位并关闭页面。显式视频采集拥有短期播放许可，可在Studio遮住浏览器时运行；成功、错误、取消后恢复位置／速率／loop并保持暂停，实际采集清理失败仍沿用隔离，不自动恢复任务。固定原生脚本不成为模型通用执行能力。

从播放器定位点采集前等待正在进行的seek完成；首批呈现回调若仍带定位前的缓存帧，只忽略早于本次实际采集起点的帧，不编码、不扩大原片区间。新帧仍须满足既有单调、连续及EOF校验；没有有效新帧不能产生合格采集文件。

采集控制器完成实际清理后，恢复页面播放策略时遇到无关Frame脚本失败，保持原生静音并登记诊断，仍恢复此前活动页；该失败不得覆盖已完成的采集回执或采集本身的错误。此策略恢复与采集控制器的资源清理隔离不同；后者失败仍隔离，不自动重试。

手动关闭与LRU回收同样等待原生destroyed；未实际销毁不得从tab索引移除或释放FIFO，关闭失败保留页面和隔离状态，明确关闭恢复成功后再继续。媒体任务期间拒绝关闭页面或为回收超额页面而破坏录制；Project清理也先检查媒体空闲。关闭最后一页创建空白页，不重新打开刚关闭的新闻网址。

DOM 观察、媒体发现和诊断读取使用统一阶段保护，每阶段最多 15 秒，取消、主 Frame 导航或 Renderer 丢失即停止接纳结果。媒体发现不滚动页面、不等待动画帧；后台素材采集保持前台标签页不变。诊断包含实际 PNG 截图。媒体下载的网络请求和文件流共享取消信号及 60 秒期限，结束流和关闭输出后清理本次部分文件，不删除同名既有 Artifact。只读迟到结果不能恢复文件写入；有副作用的操作不通过遗弃 Promise 释放 FIFO。

Bridge 验证认证、Session、Project 及目录，按 FIFO 执行；Project 变更期间排除模型操作。期限、取消、停止与关闭清理不能释放仍在运行的敏感工作。Bridge 校验图像输出；DSH 官方 MCP Client、Qoder 官方 SDK 和 Codex dynamic tool 结果分别承接本驱动的图像传输，BMW 只接受受限、验证的 PNG 图像结果。多次基础设施失败中止当前 turn，防止无效重试持续运行。

直接覆盖：browser-capability 的 schema、catalog、session-operations、bridge-shutdown、deadline、screenshot-read 等测试；DSH 的 failure-guard/transport。真实浏览器覆盖：desktop、browser-background 和 media smoke。

`observe` 可使用 selector/index 限定正文范围，并以最多 16 个 excludeSelectors 排除推荐、头像和推广。返回正文范围、UTF-16 字符口径、可见文本节点提取方式和截断状态（最多 50,000 字符/10,000 文本节点）；范围不存在返回 element-not-found 与空正文，不回退整页。输入控件/隐藏/script/style 内容不进入正文。结构化交互元素仍保留可见控件。

`page.media.list` 指定范围时只返回该范围 DOM 与目标播放器绑定的分发候选，支持同样的排除项；网络 URL 仅在匹配该播放器的原帖媒体 ID 或精确资源见证时进入该范围，不拼入无关联的全页 performance/网络媒体。返回 candidateOnly、范围与候选截断；发现 URL 不代表获取或解码成功。未限定范围的既有全页发现保留。

## 原生媒体

下载和保全共享原生 `media-session-fetch` 适配：读取实际页面的 `document.referrerPolicy`（默认 strict-origin-when-cross-origin），显式发送经策略缩减且去除凭据/片段的 Referer，兼容 Electron Session.fetch 不转发 RequestInit.referrer 的行为。来源由宿主页面确定，不向模型开放自定义头或 Cookie。重定向最多5次、逐跳只接受无URL凭据的HTTP(S)，跨源清除显式授权头，来源信息缩减后不恢复。`media.download` 仅接受完整 HTTP 200，拒绝206、空文件及未压缩响应长度不匹配；失败清理本次文件。完整视频仍需 inspect/解码核验，不能仅凭200断言内容完整。

视频取材增加 Host 生成的可选 `videoIdentity`（version/platform/targetId/resourceId），保存在来源候选、采集证据和媒体验证 sidecar；历史来源无该字段仍可读取，获取时必须重新绑定当前目标。身份不是模型参数。YouTube 以页面视频 ID、播放器 videoData/playerResponse 的同一 ID、播放许可和时长共同绑定；广告、错误页或 ID 不一致不暴露可用视频。X 以原帖 URL、主帖时间或可见日期链接（兼容无 data-testid/time 的新页面）、非引用/非广告播放器的封面媒体 ID 绑定同 ID 的 twimg 资源，回复与错误播放动画不成为目标。微博专用视频页或显式范围只接受一个可见播放器；普通信息流必须先明确范围。通用网页保留 HTTP/HLS 原生入口。发现结果仅为候选；转移期间和提交前重验 URL、范围与身份，录制逐帧及结束前复核，变化即失败并回滚本次资源，不静默改用录制。

YouTube `media.preserve` 保留同一有效播放器响应中完整分离音视频直链的获取：直接格式 URL 的 itag、标称 dur、clen/lmt（若双方提供）须匹配原始格式元数据，Host 只选择唯一默认音轨语言组的最高码率音轨。缺轨、多默认语言、签名密文或缺少支持的交付见证明确失败。原生 Mediabunny 将两轨编码包复制到 MP4，独立解复用核对每轨包数、负载哈希、PTS、零点及结束覆盖；合并不重编码。`media.download` 遇到绑定的视频独轨或 SABR 提示改用 `media.preserve`，避免静默产生无声文件或将 UMP 命名为 MP4。

当前目标播放器响应可另提供 `sabr` 原生保全候选，媒体列表标记 preservable/nativeSabr，和完整直链的 directResources 分开，不宣称候选已经获取成功。Host 仅在当前 YouTube 页内存观察真实 Googlevideo POST：每页最多8条、总计48条、120秒有效，每体最多256 KiB；完整导航、换视频或 Renderer 销毁即清空。同视频主题/跟踪参数的 in-place 变化保留候选，但页所属、CPN、播放器 config、资源 ID、当前目标和格式仍须一致。无真实同播放器请求时要求先短暂播放原视频再重新发现，不猜地址或解密签名。真实 POST、临时流保护验证内容及播放器 config 仅在受限 Host/原生协议 worker 内使用，不保存到证据、诊断或模型结果，不读 Cookie、凭据或页面存储。

原生 SABR/UMP 由固定版本 MIT `googlevideo@5.0.0` 在专用 worker 中处理，网络仍经过当前受限浏览器 Session。接收前按视频 ID、itag/lmt/xtags 核初始化和媒体头；核分段长度、重复负载、序号与每一段的连续覆盖，禁止仅以首尾时间代替中间完整性。bootstrap POST 可以不指定 preferred formats，但其中提供的 preferred/init/buffered 格式必须属于当前响应。选择预算内最高不超过1080p的 AVC 与唯一默认语言的非DRC AAC；预算同时考虑存档上限、原始两轨、重新封装和剩余磁盘余量，不以截短内容满足空间限制。保存原始编码轨道和安全哈希证明，证明口径为 YouTube-SABR-encoded-tracks，不冒称完整 UMP HTTP 正文字节或上传母版；精确轨道结束覆盖以格式 approxDurationMs 验证，页面整数秒仅作容差一致性检查。两轨通过相同 packet-copy 与独立包级校验才提交 MP4。只支持该有界有限点播子集；直播中、预告、DRM、流保护拒绝或不完整交付均失败；历史直播标记只在当前播放器非直播/非预告、有限时长与目标一致、单一可定位窗口覆盖零点到全长且官方播放器提供已过去的有效开始及结束时间时，才按固定回放接收。每次身份检查与验证刷新继续核这些条件，滚动窗口或缺少结束证明拒绝，不能以部分字节冒称整片。受限 SABR POST 的 Origin 只能由 Host 从当前页面派生；网站要求更新验证时，只在当前页、原 CPN、config、client 与选定格式版本不变时，等待同播放器后续真实 POST 中不同的临时验证值，每次最多15秒、最多3次；无新值或身份变化即失败，绝不生成或破解验证值。取消仍等待刷新 RPC、worker 与网络实际排空。2026-10-22 的19秒与60秒公开样本已完成真实双轨保全、合并与全片解码，最新耗时分别1.331秒和98.802秒；约10分钟样本首次遭网站流保护拒绝，复测验证通过但796.930秒发生网络中止，两次均已清理部分文件。随后同一日期的94分钟GTC目标在严格已结束回放门槛与本地Bridge通信修复后，实际通过完整双轨保全、无重编码合并、连续包级核验与元数据检查（1585654747字节、5637.7353秒）；原始双轨保留。这是该目标的实际业务证据，不代表所有长片或连续全片解码/听审通过；十分钟样本失败记录仍保留，人工听感另列待验。取消或失败须终止并等待协议 worker 真实退出、排空网络及文件，再回滚本次资源；服务端长 backoff 不能成为后台遗留任务。清理失败保持隔离，仅 `media.record.stop` 显式恢复成功后释放。无 yt-dlp、FFmpeg CLI、额外模型工具或 TikTok 专用适配。

`media.preserve` 只接受当前 Project 页面 DOM/performance/网络已发现的 HTTP(S) 媒体 URL。全页媒体发现纳入 HLS 清单 MIME/URL，范围发现仅补入该范围目标播放器绑定的网络资源，不拼入其他区域媒体。保全与解码预算独立：原始 HTTP 文件流式落盘并增量 SHA-256，不将完整长文件拼入内存；原始输入合计最多4 GiB，有限音视频/HLS时长最多6小时，HLS最多32变体、20000分段，每轨最多200万编码包，原始下载最多两小时、工具传输121分钟；本地编码包分段仍为20分钟原生任务及21分钟传输预算。清单仍最多1 MiB、单分段32 MiB；原件、组合轨道及派生封装分别占磁盘。宿主受限浏览器 Session fetch adapter 保存 master/media 清单、初始化与分段字节、URL、SHA-256、大小与标称时长；选择并记录最高带宽变体，保留独立音轨。加密、直播、字节范围、不连续、缺片及不能明确保留的其他轨道拒绝。派生 MP4 仅复制编码包，重新解复用验证每轨包数、编码负载哈希和 PTS 范围，清单时长与轨道范围不符则回滚。原始分发字节与派生封装分别列出，完整分发版本不等于上传母版；支持平台的候选先按目标身份过滤，仍需以正文和帧核对内容。Project/页面变化或取消先排空请求和文件后清理本次资源，不释放未完成的 FIFO。直接 HTTP 只声明完整响应，不凭响应结束声明完整视频。

`media.speech.align` 是同一个 BMW `browser` 工具中的有界本地分析动作，按 Project Artifact ID、明确 language（zh/en/auto）与 sourceRange 直接转写最终 MP4/WAV 的最多180秒区间，仅允许固定 base/small 模型。沿用原生语音引擎、PCM规范化、原件/窗口/产物SHA与取消清理；输出区间时间及映射证据，不修改草稿或自动应用字幕。英文原声用 language=en，不能重复中文全片识别，也不必将最终成片挂回场景或消耗素材库来源转写批次数额；不存在任意路径、命令、模型文件或网络提供方配置。ASR与PCM技术证明不能冒充人工听审。工具传输660秒，覆盖原生600秒截止与清理。

`media.inspect` 可只读检查4 GiB／6小时存档的容器和轨道元数据，不能把解码支持声明为全片已解码。新增 `media.segment {artifactId,segmentRange:{startSeconds,endSeconds}}` 从同Project存档用 Mediabunny 强制复制编码包生成本地 MP4，不允许网络、模型指定路径、丢轨或隐式重编码。请求最长29分钟，关键帧边界每端最多扩展30秒；产物最多512 MiB／30分钟，并重新解析核对轨道编码、实际覆盖与时长。返回原件SHA、请求／实际原片范围、输出时间到原片的偏移、输出SHA和JSON证明，分段边界可能重叠，转写须按映射去重并核对全片无缺口。取消或失败删除本次产物，清理失败沿用媒体隔离与显式恢复。原存档保留；后续完整解码、帧采样、转写和剪辑仍使用已有有界处理器。`library.sources acquire/preserve` 仍是解码预览入库流程，对已知长于30分钟的候选在下载前明确要求改走上述完整存档流程；指定短预览不能放行对整个长输入的解码，避免下载后因解码限制删除原件。

公开 `media.preserve` 回复仅返回前20份资源及所属 Artifact ID，另列总数和截断标记；完整资源账本保存在 `proofArtifactId`，不会将20000个分段回灌模型上下文。内部来源获取保留完整所属列表和清理能力，不使用公开摘要进行回滚。

内部 MCP 到认证 loopback Bridge 的 HTTP 使用专属有界传输，响应头/正文不继承通用客户端的五分钟等待上限；每次动作的 AbortSignal 仍统一执行默认、分段或存档期限及取消。只允许本机明确 Bridge origin 的 tool/execute，拒绝重定向；不会把该 HTTP 客户端作为模型能力。Qoder 官方 stdio 工具调用配套设122分钟上限，超过 BMW 最长121分钟通信期限，避免默认空闲监控提前截断两小时存档；连接/目录预检仍独立短限。EOF 中止未完成调用并排空私有 HTTP 连接。

`library.sources acquire` 的 `method:auto` 对已确认且时长不超过30分钟的同一播放器，先按已观测的 SABR/HLS/HTTP 资源尝试原编码保全（最多两个资源，共用60秒下载预算），完整保留原轨道及保全证明。下载失败必须等待 worker、网络与文件清理实际结束；取消、身份变化、Project变化或清理隔离不能触发采集。保全成功不再启动播放器采集。失败后的采集仍核同页、范围和视频身份；YouTube 从播放器已提供的清晰度中请求最高不超过1080p的档位，记录请求档位与当时实测尺寸，实际产物尺寸以解码检查为准。采集明确标记重新编码，原声沿用播放器当前音轨，不能称为原编码下载。获取证明记录脱敏的尝试方式、耗时和失败类型；没有自动破解网站验证。显式长存档仍走 `media.preserve` 的独立预算。此入口是有限原生任务，没有增加模型工具或 Host Agent loop。

主画面精确裁切由 `video.edit` 的 `clip.crop` 命令按当前文档主轨 clipId 定位，可设置规范化 crop 或用 null 复原；覆盖单场景原片与 visualSegments，不改时钟、原声或字幕。独立叠层不能借此命令修改。用于在正式导出前修正新闻画面主体过小的问题。

短来源的 `library.sources acquire/preserve` 除原HTTP证据外，仅对已确认YouTube候选接收 `YouTube-SABR-encoded-tracks` 原生证明：返回身份必须与候选相同，completeVod、completeSeparatedTracks均为真且reencoded为假，所属文件、证明文件及SHA继续校验。缺失／跨视频／跨平台身份、不完整轨道或重编码声明拒绝并清理本次资源；这不放宽长来源的存档与处理分离要求。

`media.audio.sample` 按输入文件 PTS 提取0.001–10秒单音轨片段，保留原生采样率/声道，无增益、重采样或混音，仅PCM16量化。保存输入/输出SHA、实际样本数、RMS/peak、量化越界样本和缺失帧，按100ms窗口列指标；无音轨和越界明确失败。`media.audio.preview` 仅打开同Project有界WAV试听控件，默认不自动播放，不能将打开播放器记为人工或模型已听审。模型只接收文字/图像的驱动不得宣称实际核听，技术指标也不构成听感、配乐或同步判断。当前Codex ChatGPT登录路径的官方音频输入限制仍是未解决的运行时约束；不添加其他模型循环、额外工具或暗中音频上传。


页面录制保存 `<video Artifact ID>.events.json`。可信主 frame 隔离域只记录点击、滚动、视口与导航，不采集输入文本、键盘、cookies 或页面正文。`page-event` 是真实派发的可信页面事件，不能据此判断是否真人；Agent 的程序化点击独立标为 `agent-action`。滚动/视口按 100ms 限频、点击立即记录；每段最多 5000 事件、5000 个帧时钟映射，JSON 总量最多 2 MiB。录制最多 30 分钟/512 MiB。暂停不支持，主页面导航继续录制，页面关闭停止并保留明确生命周期结果；`discard: true` 删除本次页面录像，字节/元数据预算失败清理本次产物，已有素材保留。停止等待文件流和事件保存/清理结束后返回。

事件保留 `pageSeconds` 原始页面时间及 `seconds` 输出视频时间，`timing` 区分 `measured-frame` 与 `wall-clock`。源视频帧回调同时冻结像素与采集时间，CanvasSource/WebCodecs 以明确时间戳编码；成功编码包的 PTS 与源帧采集时间映射随录像保存；无映射的事件保留墙钟来源，不用于自动焦点。坐标为视口 CSS 像素，另存 DPR、滚动位置、原生录制表面的 CSS 尺寸（含浏览器 zoomFactor），据此映射完整源视频，仿真视口不能代替录制表面尺寸。URL 去除凭据、查询与片段。页面录像使用 append-only WebM；没有时长头/完整索引，读取时实际扫描媒体时间，不将墙钟当作解码时长。没有系统全局鼠标轨迹采集。

录制 runtime 验收另包含真实受控网页的三步任务：选择模板、选择旁白、提交到服务器并导航到持久化任务结果页。通过认证 Bridge 录制，原生页面输入产生点击记录；在 Studio 使用可编辑建议与补充静止讲解焦点，裁切 .2 秒/1.25 倍速，检查按钮/结果范围、旁白绑定及四个选定时间点的预览与 MP4。该夹具不是公开网站或真实 DSH 模型制作；实际本地旁白用于保留绑定验证，未证明人工句边界精度。

Mediabunny `1.61.0` 与浏览器 WebCodecs 为媒体底座；Canvas/WebAudio/WebGPU/MediaRecorder 用于画面、混音、处理与采集。采集和导出由受限宿主文件 adapter 写入当前 Project artifacts；模型只看到 Artifact ID。

共享原生解码 worker 使用至多16项（含执行中）的有界 FIFO，Studio 预览核验、新闻候选核验与其他处理不并行占用同一组私有 IPC。请求在入队时固定 Project 目录；排队取消不启动 worker，执行中取消仍等待 worker、IPC 与文件 IO 清理后才释放下一项。清理失败会隔离媒体资源并拒绝尚未启动的排队请求；仅显式media.stop重试清理成功后释放，不重放旧请求。无重试、无不确定投递重放，超预算明确失败。页面采集仍是独立互斥任务。映射采集的 WebM 以原生 VP9／Opus 编码包写入显式视频 BlockDuration，保留最后一帧的实际持有时长，解复用后校验 PTS、帧数及终帧时长；不以1毫秒默认帧长覆盖终帧。MediaRecorder的末个Opus包若时长为0，保留未知时长及原始编码负载，不编造音频时长或拒绝有效包。源时间仍来自实际呈现回调，AAC 等音轨填充造成的原片音画终点差异不得当作画面丢帧，像素核对以原片实际视频帧为准。

| Action 家族 | 输入、行为与限制 |
|---|---|
| page.media / media.download | 当前页面媒体发现、公共 HTTP(S) 媒体下载；受 URL/大小/类型与 Project 边界约束 |
| media.screenshot / media.record | 当前页面截图与浏览器录制；明确录制状态、停止和保存结果 |
| media.video.capture | 页面真实视频采集；达到时长上限属于截断结果，不宣称完整 |
| media.preserve | 保存当前页发现的 HTTP 媒体或完整 HLS VOD 的分发字节、清单/分段哈希及无重编码封装证据；不声称作者上传母版 |
| media.segment | 从完整Project存档复制有界编码包分段；保存原件哈希、原片与输出时间映射，后续单独解码／转写 |
| media.audio.sample / media.audio.preview | 有界原生采样率/声道 PCM16 片段、信号指标及不自动播放的试听窗口；与模型实际听审分开 |
| media.inspect | 当前 Project Artifact 的媒体轨道、时长、尺寸与编码检查 |
| media.video.motion | SHA绑定指定本地视频主轨区间的全部解码帧；有界180秒/6000帧，在调用者指定的真实画面区域测量64×64 RGB逐帧差、持时、解码缺口、低变化区间，另列首3秒；不替代真实内容、语义运动或听感判断 |
| media.frames.sample | 依据媒体时间抽 PNG；时间/数量有界，保存为 Project Artifact |
| media.image.inspect | 解码当前 Project 静态 PNG/JPEG/WebP，返回真实尺寸；32 MiB / 16 MP，图片头在分配像素前检查 |
| media.image.annotate | 以原图像素坐标标注截图/图片，保留尺寸和原文件，输出新的 Project PNG 并回传模型图像 |
| media.image.draw | 有界原生 Canvas 绘制图解：32..4096 整数尺寸、最多 8 MP、白底默认，可选透明背景 |
| media.convert | 时间区间裁剪、缩放、MP4/WebM 转换，保留可支持轨道并检查编码器 |
| video.narrate | 真实 Edge MP3、Qwen WAV 或本地 Matcha WAV，提供测得时长和 TTS 元数据 |
| video.compose | 有限结构化分镜合成 MP4，标题/列表/字幕、已有画面和旁白、原创配乐及原声混音 |

处理支持进度、期限、取消和部分输出清理，禁止任意 URL、路径、HTML、脚本或 FFmpeg。设备缺少必要编码能力时失败，不伪造成功。实际 alpha 视频允许检查，抽帧/转换拒绝。

有限播放器采集先暂停并完成归零，再启动视频编码／音频录制和播放，避免在起始准备期间丢失画面。仅可信 ended 事件及已观察到接近有限尾端的播放进度可冻结结束证据，捕获阶段监听优先于常见站点重播回调；末端回零不再覆盖已冻结范围。timeupdate/原生帧回调保存进度，合成 ended 或未观察到尾段的提前结束不能声明完整，采集中主动 seek 明确失败。达到安全上限保持 maximum-duration/partial；ended 仍只证明当前播放器范围结束，不证明平台无试看或拿到了原始文件。清理移除本次事件/帧回调，并恢复原位置、暂停、循环和速度；实际文件首尾、音视频轨道和解码范围与播放器证据分开核验。

采集暂时展示同一 Project 的目标标签页以接收 Chromium 呈现回调，实际清理结束后恢复此前选中页；不要求人工切前台或补充参数。采集在安全上下文要求 requestVideoFrameCallback、VideoFrame、VideoEncoder 和 captureStream；缺失时明确失败。每个原生呈现回调同步取得 VideoFrame 与 mediaTime，用单调录制时钟赋予整数毫秒文件 PTS，经 WebCodecs VP9 编码。下一帧到达才编码前帧，因此暂停或停顿延长持有画面的呈现区间；变速仍逐帧记录源 PTS，不进行时长比例或分段线性猜测。音轨单独通过 captureStream／MediaRecorder 录为 Opus，保留其真实包时间，有限宿主适配器用 Mediabunny 有界流封装，不向网页或模型暴露宿主文件、IPC 或编码包入口。封装后重新解复用全部视频包，逐项核对源帧绑定的文件 PTS 与帧数，再发布 SHA-256 绑定的视频及 v2 `.source.json`。WebM 使用毫秒时间基，最终帧实际文件时长与源 EOF 分开记录；sourceDurationSeconds 与 durationAtStartSeconds 分开。最多120000个映射、索引32 MiB、原生在途帧预算64 MiB、编码/音频消息缓冲16 MiB；自适应尺寸变化在初始输出画布内按 contain 等比缩放并留黑边，逐帧保留 sourceWidth/sourceHeight，inspect 返回尺寸变化时间点，不宣称源分辨率或无损；超像素预算、编码队列超限、seek、编码丢帧、封装 PTS 不符都失败并回滚，不降级为猜测映射。

media.inspect 返回 captureTimeline（source-to-recording-file-PTS、verified）、所采集的完整可查询源区间、文件起止 PTS、映射帧数及有界实际 play/pause/ratechange 事件。唯一 browser 内的 media.capture.frames.sample 用 sourceTimestampsSeconds 在全片映射中二分选择前一张已采集源帧，按对应文件 PTS 通过现有沙盒 Mediabunny/WebCodecs 解码录制视频，核对解码 PTS 和输入哈希，再返回 PNG、实际 sourceTimestampSeconds、fileTimestampSeconds、请求差值和 PNG SHA-256。任意已采集中段／尾段均可离线并跨重启查询，不依赖原网页；帧率量化、呈现跳帧与源秒数差值显式返回，不声称恢复未呈现的原文件帧。原有 media.frames.sample 仍接受文件时钟。越界、旧无索引文件、源或映射变化、跨 Project、不可解码都明确拒绝。v1索引继续只提供已有首／尾 PNG，fileTimestampSeconds 为空；历史文件不静默补造 v2。

media.video.capture 增加可选 playbackPlan：最多16个严格递增的 sourceSeconds，每步限定 pauseMs（1..10000）和／或 rate（.25..4），到第一张达到该源时间的实际帧执行，不 seek；回执保存实际动作时间和速率。它只控制当前已授权播放器，原播放状态仍恢复。失败／取消删除本次视频、临时 Opus／编码包、映射及取帧 PNG；编码器和录制器实际停止、文件与工作队列排空后才释放资源。清理超时保留占用并隔离，现有 media.record.stop 可显式重试清理；来源事务失败仍清理本次自有派生文件。


图像动作使用同一个 `browser` 工具和现有 Project/Session/权限/FIFO/取消边界。Assistant 先截图或 `media.image.inspect`，再使用 `media.image.annotate` 的 `artifactId` 与 `shapes`；新建绘图则使用 `media.image.draw` 的 `width`、`height`、`background` 与 `shapes`。不需要目标标签页。坐标为实际图片像素，文字从左上角定位，超界图形或放不下的文字明确失败，不悄悄裁切。

支持 `rect`、`ellipse`、`line`、`arrow`、`path`、`text` 和 `redact`，按数组顺序绘制；框/椭圆使用 `x/y/width/height`，线/箭头使用 `x1/y1/x2/y2`，路径使用 `points:[{x,y}]`。颜色使用十六进制 RGB/RGBA；默认红色 4px 线条、24px 文字。文字支持中文、换行、`maxWidth` 自动折行、`fontSize`、`bold` 和背景。遮盖 `redact` 只能使用不透明 RGB 色及 opacity=1，写入新 PNG 的像素；原图保留。最多 128 个图形，单路径 256 点、全图 4096 点、全图 4096 文字字符；每段文字最多 512 字符/16 个显式行。新 PNG 最多 20 MiB，完成后实际重新解码核对尺寸再接纳。失败、取消（含完成文件后验收取消）只清理本次输出。

绘图由无网络、无 Node 的隔离媒体 Worker 使用固定 Canvas primitives 执行；拒绝 HTML/SVG/脚本、远程图片、任意输入/输出路径和自选覆盖文件名。新图像成为 Project 素材，可用于 Studio 分镜。传输期限为五分钟（包含排队及输出验收），每个媒体 Worker 保留两分钟期限。

### Qwen TTS 配置、安全保存与试听

Qwen 在线旁白提供方为 `qwen-tts`，固定北京地域 `qwen-audio-3.1-tts-flash`，默认音色 **闻怀之 `wenhuaizhi_v3.1`**（稳重、成熟，官方列为新闻播报适用音色），作为后续新闻速递等中文视频的推荐默认；另可选女声许言初 `xuyanchu_v3.1`、许玉远 `xuyuyuan_v3.1`，以及男声安明远 `anmingyuan_v3.1`（清亮、自然，官方列为旁白适用音色）。另有男声霍拙石 `huozhuoshi_v3.1`（清亮）、龙安朗 `longanlang_v3.1`（清爽利落）、龙三叔 `longsanshu_v3.1`（沉稳质感）。七种音色均支持 Settings 试听、视频默认/模板、Studio 与 browser 配音动作。模型与音色不可跨系列混用，参考[官方音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)和[HTTP API](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api)。Settings → Media → Video narration 中单独开启 Qwen（`qwenNarrationEnabled` 默认 false），视频默认/模板及 Studio 的旁白音色选择均支持 Qwen；传入 `provider:qwen-tts` 自动选择闻怀之，语速 0%。已有全局 Edge 默认、模板和草稿不自动改写。

Settings → Media → Video narration 提供北京地域 Workspace ID、密码型 API Key 输入、保存/清除配置和固定短文试听。API Key 留空保留已保存 Key，保存后立即生效，无需重启或环境变量；输入框修改后须先保存，才能使用已保存配置生成试听；不从模型请求接收或在工具结果/全局设置中回传凭据。独立的 `qwen-tts-credentials.enc`（版本 1，权限 0600）使用 Electron safeStorage 加密整个凭据记录；Shell 只读取配置状态及 Workspace ID，Key 不回显，关闭设置/保存成功后清空密码框。系统安全存储不可用（含 Linux basic_text）时拒绝保存和解密；解密、格式或写入失败保留已有密文，不静默覆盖，显式“清除 Qwen 配置”可在无法解密时删除旧密文。Shell 凭据/试听 IPC 只允许受信主框架，模型 browser 不提供凭据操作。

试听使用所选 Qwen 音色、0% 语速和固定文本“这里是新闻速递，为你播报今日要闻。”，提示会发送文本并消耗额度，需已保存凭据并开启 Qwen 在线配音。试听不修改视频默认音色；通过原生配音与真实解码检查后在设置内播放，最多 10 秒/1 MiB。音频是当前 Project 的临时产物，完成、失败或取消后清理，不加入草稿；设置关闭/应用退出可取消生成，FIFO 和 Project 切换排他持续到实际工作清理完成。播放结束可重复收听，关闭设置释放音频。

凭据仅用于原生层向固定 `https://{workspace}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer` 发起合成；工作空间值严格限为单个 DNS label，不能传任意端点。语速映射为 `1 + ratePercent/100`，24 kHz WAV，中文语言提示、关闭 SSML。60 秒覆盖合成与下载，JSON 上限 64 KiB，音频上限 8 MiB；只接受北京 DashScope 结果 OSS 的音频链接，HTTP 链接升级 TLS，下载不携带 API Key、cookies，禁止重定向；错误、超时或取消不重试、不回退，取消删除本次产物，等待连接清理后释放占用；清理失败保持隔离，显式 `media.record.stop` 重试清理。生成音频沿用 Project 归属、Studio revision 冲突检查与真实时长测量，不新增模型工具。隔离 fixture 验证不代表百炼付费模型、真实凭据或音质验收。

### Edge 与本地旁白

Edge 默认 `zh-CN-YunxiNeural` 男声、0% 语速，固定 Microsoft 服务，60 秒期限；可选晓晓女声。在线旁白默认打开，关闭后所有 Edge 入口被阻止。本地 `local-matcha/local-zh-en` 使用固定 Sherpa-ONNX WASM，需模型缓存、合成时禁止网络，180 秒期限；不会静默切换提供方或生成无声文件。

直接覆盖：media-native 的 media-controller/media-processing/video-options/video-production、platform 的 qwen-credentials-store 及桌面设置检查；实际 decode/capture/compose/local-speech 在媒体、视频、旁白 smoke 验证。Qwen 的离线 HTTP 响应夹具不验证真实百炼服务或音质；在线 Edge 和付费视觉模型为独立 opt-in，不属于离线检查的成功声明。

### Studio 语音候选、句级校正与字幕锚点

`video.studio` 新增 `align-speech`、`read-speech`、`correct-speech`，均要求当前 Session 的 draftId、expectedRevision、sceneId。识别只允许固定 base/small，作用于当前有效旁白；成功保存 Project 归一化 WAV、原始 JSON、日志及证据 JSON，草稿只保存受限证据引用及 SHA-256。每次重跑只更新候选，不覆盖已有校正；失败、取消、过时 revision 清理本次登记的新文件，保留原素材及手工记录。读取候选校验证据文件与音频哈希，过期结果只供回溯；整段 ASR 不会被按字数拆成虚构句边界。确定性建议只接受唯一的整句文本匹配及结构可用区间，仍未通过自动精度验收。

校正请求 anchors 最多 100 条，含 id、scriptStart/scriptEnd（UTF16，不能切开 Unicode 字符，每段最多 200 单位）、startSeconds/endSeconds（原始旁白文件秒数）。脚本范围和音频时间均有序且不重叠；终点必须在实际可解码音频和分镜范围内。宿主保存脚本全文/SHA、音频 ID/SHA、实测时长、捕获 revision、创建时间与 `audio-file-seconds`。可信 GUI 调用标 `user-edited`，模型调用标 `agent-edited`，请求不能自称人工审定。普通 update 无法改写这些记录；脚本/音频变化保留旧记录并标过期，重做只影响选中的分镜。

旁白面板内提供原始识别片段/概率/警告、真实音频试听与定位、空白初始句时间、取试听时间、手工调整/删除及保存。未完整填写的编辑阻止离开，不会自动估算补值。`speechCaptions=true` 在没有独立 scene.captions 时消费句锚点；独立编辑字幕优先保留，修改字幕不重做旁白。原始旁白从分镜 .5 秒开始，画面 sourceStartSeconds/playbackRate 不改变其时间；预览和原生导出共用 cue 投影，SRT/VTT 再叠加累计分镜时长。使用锚点前检查脚本/生成参数及实际音频 SHA，编码完成后再检查，过期或变化阻止复用/导出并回滚当前新成片。SRT/VTT 保持标准格式，另存 Project JSON 时间来源清单，标明每场景来源、原始音频绑定、脚本范围与时钟；GUI 提供清单下载。

分镜支持 `showSceneNumber` 布尔选项，默认保留模板编号；关闭时预览与 MP4 同时隐藏大号场景数字及页脚编号，标题卡要点上移利用空间。字幕显式换行保留，支持同一 cue 的中英双语两行排版。旁白面板可移除此段旁白与脚本，解除音频/生成/句锚点绑定但保留 Project 音频文件、原声设置与独立字幕；CAS 和撤销/重做继续生效。

画面和旁白属性提供「按句同步」引用编辑器：`scene.speechLinks` 含最多 3 条 bullets `{anchorId,bulletIndex,text}` 与 24 条 focus `{anchorId,visualIndex,artifactId,x,y,zoom,emphasize}`。板书条目和画面素材保留绑定时身份，修改/移除后保留引用并阻止消费，需重新选择或解除。标题卡板书按句开始逐条揭示，未绑定条目保持立即显示，隐藏条目占据原位置；不扩展自由图层或教学模板。强调使用整句时间，叠加旁白 .5 秒起点后，按累计画面片段时长、sourceStartSeconds 和 playbackRate 映射回源视频秒数。句区间必须完整落在所选片段内，目标必须在当前裁切内；与独立焦点重叠、超预算或源区间不足 100ms 均报错，不移动/覆盖独立焦点。

引用通过既有 update/CAS 保存，支持撤销/重做，不改写宿主锚点与旁白版本。GUI 离开输入框/切换检查器/导出前保存待输入字段；时间轴显示来源与揭示点，旁白轨从实际 .5 秒起点显示。字幕、强调、板书共用纯投影与原生绘制，任何消费者都检查有效脚本/TTS 和实际音频 SHA；SRT/VTT 来源清单同时保存引用、原始锚点、板书时间及焦点投影，独立字幕来源保持独立。`video.compose` 的标题卡可显式使用 `bulletRevealSeconds`，最多 3 个、与 bullets 等长的分镜内秒数，不能与画面素材共用；Studio 草稿不接受该派生字段。

这些用户／Agent 编辑时间不是独立声学人工验收金标。十段 base 标注已按用户核听决定采用为 12 个可编辑句／段锚点；独立声学句边界 P95 仍未建立，自动句／词／字时间批准保持关闭。

### 原生语音证据运行端口

media-native 增加仅供宿主消费的 `processArtifact({action:"media.speech.align",artifactId,model:"base"|"small",language?:"zh"|"en"|"auto"})`。请求只接受 Project Artifact 和固定候选，不接受执行文件、缓存路径、模型 URL、提示词或额外 CLI 参数；Studio 通过唯一 browser 工具的 `video.studio` 受限请求消费该端口，不直接公开底层 CLI。固定 whisper.cpp 1.9.1、本机 `whisper-cli` 版本与执行文件指纹、官方多语模型的 revision/大小/SHA-256 在每次运行核对。模型由 `scripts/install-local-asr.ts` 安装到受控缓存，原生引擎需另外安装；本机 macOS 已实测，Linux 分支尚未实测。

沙箱浏览器用 Mediabunny 完整读取唯一音轨（最多 180 秒、8 声道、96kHz、累计 32Mi 浮点采样值），按声道均值混音并用 OfflineAudioContext 重采样到单声道 16kHz PCM16。实际原格式、解码起止、归一化采样数、时长及 PCM 饱和采样数进入证据；Opus 最后一个完整解码包可能超出容器音轨实测终点，仅允许最多 120ms 的末包填充并按真实终点裁去，discardedTailFrames 记录丢弃的输入帧数，字幕时钟不平移。其他超界/格式变化仍拒绝；间隙保留静音，没有根据脚本伸缩音频。原输入前后哈希和路径/文件身份均核对；原文件替换、模型/引擎变化不能被已打开描述符掩盖。

固定 CPU 识别（旧旁白默认中文，视频原声默认自动检测语言）保存 Project 归一化 WAV、完整原始 JSON、日志及 SHA-256，返回实际耗时、`audio-file-seconds` 区间与 BPE token 概率均值。原始越界、重叠和低概率区间不压缩或补造，显式标记不可直接采用。`automaticTimingApproved:false`、`wordTimingAvailable:false` 保持关闭；概率不是人工准确率或中文词/字时间。整体最多十分钟、原始 JSON 4 MiB、进程输出 1 MiB、400 区间/16000 token；取消等待子进程及管道退出，随后只清理当前 UUID 产物。Studio 已提供原始候选、句/段级编辑、字幕及点击强调/板书共用引用。十段真实音频的 base 标注经用户试听并明确采用，保存 ASR 辅助核听来源；制作区间仅裁去超出实际音频时长的末尾，原始转写/时间/警告保留，合并整段不拆成虚构句时间。相对采用记录的原始 base 区间位移 P95 为 272.125ms，仅反映末尾边界修正，不是独立声学准确率；不据此批准自动时间能力。当前保留可编辑句/段锚点，自动词/字同步不开放。

### 预览检查、视频原声双语与有限模板

更新同一草稿的预览保留当前全片时间，并将分镜、画布、时间轴与属性同步；切换草稿立即清空原画布和播放时间、恢复待准备提示。预览准备与释放串行，取消等待实际资源加载、绘制和解码器清理，过时准备不会被标记为就绪；视频时长未知显示“待测量”，不按零秒误报缺画面。制作检查读取真实素材时长并显示当前版本的实测覆盖，检查不会写回草稿。草稿更新后旧报告及关键帧失效。

后台通知先按同一 Studio 的 Project/Session 读取新状态，读取串行且工作区代次变化后丢弃旧响应；GUI 作业必须等到自己的新快照再读取新成片素材。只增加成片/封面记录、revision 和 updatedAt 的更新，在所有编辑内容、所有者及已解码素材的大小/修改时间相同且无待输入/手势时，推进已准备预览的版本而不重新解码，保留播放头、对象选择及撤销/重做。实际内容更新仅在本地干净时同步，保留选中镜头身份与播放时间并自动准备新预览；外部内容替换清空旧编辑历史。待输入、未保存或对象手势期间不覆盖字段、不移动焦点、不静默变更请求版本；新的真实成片仍可在交付历史看到，保存冲突保持可见，需明确重新加载。简单模式在干净预览工作区收到新的当前有效成片时自动显示中央 MP4；高级保持当前对象编辑，成片不自动播放，隐藏草稿预览时暂停声音。作业期间通知合并到结束后处理，不重发任何模型/媒体命令。

交付面板提供文字/字幕审片与“生成当前草稿关键帧”；按当前草稿逐分镜生成本地预览缩略图，点击返回对应时间，生成后恢复原位置。预览和原生 MP4 共用 Canvas 排版。文字全部保留，允许有限缩小字号并提示；最小字号仍放不下时，预览/编码返回 `STUDIO_TEXT_LAYOUT`，不静默截去剩余行。提示涵盖字幕阅读密度、标题卡停留时间、上方/中央字幕遮挡、缺少译文和字号缩小。审片提示不是事实核查或人工可读性认证。

`video.studio` 增加以下受限操作，继续使用原有 Session owner、Project、revision/CAS、browser FIFO、取消与素材端口：

| 操作 | 输入与行为 |
|---|---|
| `recognize-source` | draftId/expectedRevision/sceneId，可选 segmentIndex、speechModel base/small、speechLanguage auto/en/zh；固定本地 ASR 读取所选视频音轨。保留现有字幕，保存原视频与证据 SHA 及识别候选 |
| `read-source-speech` | 返回原视频秒数的原始分段与警告；源文件变化标记 stale，不自动批准候选 |
| `apply-source-captions` | sourceCues 为核听校正的 startSeconds/endSeconds/text；从原视频秒数经 trim/playbackRate/前置片段累计时长映射到分镜，共享零旁白偏移；显式替换当前分镜独立字幕 |
| `detach-source-captions` | 保留独立字幕，解除原视频时间关联 |
| `set-caption-translations` | translations 为 cueIndex/originalText/translationText；核对当前原文与版本，保留原文和时间，跳过已有 user-edited 译文，返回 skippedCueIndices |

字幕编辑器分别编辑原文与译文，共用起止秒数；`captionDisplay` 为 original/translation/bilingual，对预览、MP4、SRT/VTT 一致生效，旧单语字幕保持原来的文本。字幕人工修改以宿主可信 actor 标记，模型不能声明人工审核。字幕来源清单记录 sourceCaptionBinding、显示模式、译文来源、分镜全片起点；原声字幕没有旁白的 .5 秒偏移。同一已识别素材的剪裁、变速、前置片段时长或调序现在按已核对源字幕重新映射，人工原文/译文保留；超出核对范围、删除/替换稳定片段、来源 SHA 变化或含糊的同时字幕/源时间编辑仍阻止消费，需重新应用或显式解除关联。翻译请求交给当前拥有该草稿的 Assistant，继续使用所选官方驱动，不新增模型循环。

原声 GUI 提供 base/small、语言选择、原视频试听、识别时间/原文校正和核听确认；未确认不能通过 GUI 应用。识别与应用不生成旁白，不自动删掉用户既有旁白或启用原声，保留原声仍由现有开关控制。ASR 单个完整音轨最多 180 秒；显式 sourceRange 可读取最多 1800 秒源文件中的至多 180 秒区间，Project 素材索引可顺序分块。自动词级时间仍未开放。源候选为宿主持久证据，独立字幕与模板编辑可撤销；应用源识别明确替换当前分镜字幕，不能以模型 draft 更新伪造识别记录。

`sceneTemplate` 是固定版式数据：summary 用三条要点和无画面素材的标题卡，comparison 用两项观点和无画面素材的标题卡，screenshot 用一段现有画面和一条说明。可选 accentColor/backgroundColor/textColor 为固定 #RRGGBB；emphasisIndex 为 0..2。GUI 提供版式、配色和重点选择；内容数量/素材不符合模板时阻止消费。标题卡模板不显示占位大数字，底部页码仍受 showSceneNumber 开关控制。模板不改变原素材、旁白或字幕，不接受 HTML/脚本或自由轨道。

原生卡片目录保持标题、要点、对比、数字、证据、演示、图解、素材八类。基础 CardSpec v1 使用九个固定模板（含兼容列表），新增 CardSpec v2 的证据阅读、原句重点、原文/译文、人物引述、背景数字、关键词、共同目标和范围关系，图解图片可选升级为 v2 阅读配方。目录、闭合参数 Schema、GUI、原生预览与导出共用 media-native 的 card-templates/card-details 契约；不接受用户代码、任意组件或隐藏 layer。describe-schema 发布八类摘要与 simple.cards/3，describe-template 按所选模板懒返回该类变体与其参数。图像 inspect 返回实际 Artifact/SHA-256，模型仍只调用唯一 browser。

阅读配方固定整页→重点、局部→全貌或有限顺序阅读，最多三处（译文/人物版最多一处），自动分配停留及有界过渡；不覆盖手工 focus/zoom。重点最多三组，每组最多三行源图矩形，支持框线、底色及实际已绘源像素反白。源坐标跟随同一裁切/阅读变换，人物/身份/译文为固定槽；目标属于实际源 Artifact/哈希，换图拒绝沿用旧框，同名文件变化会在预览、就绪检查、编码及提交后校验失败。人物及节点专用图也进入 Project 素材引用、解码和总预算。原句/译文分别最多 160 字符，明确译文和引述来源；一个人物图、姓名 32/身份 64 字符，两种固定位置，不自动抠图。未填专用内容允许编辑，导出拒绝空原句、缺来源、缺人物或不完整图解。横竖屏文字放不下时拒绝导出，不静默截断。

背景数字保留精确非负数/两位小数/八字符单位规则，最多一张静态依据；大字→依据读取原镜头表现时钟，退场后至少一秒阅读。关键词复用 scene.title，最多 20 字符，整句淡入/擦入，不创建逐字对象。共同目标固定二至三个对象和一个目标，标签或图片、关系 24 字符，节点可逐项出现；范围关系数值模式严格校验轴界、区域及至多两个递增阈值，符号模式明确示意/非比例，须填写轴含义及条件。复杂公式、通用图表、真实连续指针轨迹、3D 和任意 HTML 仍不在契约内。

专用卡片的引述、译文、署名、人物、图解节点、关系和范围文字使用共享画面的主题墨色／辅助色／强调色，浅色主题使用浅色节点底与深色文字；轴线、连接线、区间与阈值也按主题选色，不再固定白字。接近的数值阈值标签在现有固定槽内错行显示，不改变数值位置、比例或来源。卡片与字幕共用的折行保留闭括号和末尾数字／百分比组，避免右括号单独起行；完整组放不下时沿既有字号适配或溢出拒绝，不丢字。预览与原生 MP4 共用 painter；横竖屏、明暗主题及 minimal 的文字颜色／标签间距有回归断言，video smoke 解码浅色 MP4 核对引述和范围槽实际深色文字像素。检查不宣称语义或人工可读性验收。

可复用成片指纹包含宿主固定的原生渲染版本以及原有 composition／素材文件身份。旧渲染器的成片继续保留在交付历史及 Project 文件中，但不会被视为当前渲染结果；用户下一次执行 render 时生成新版，不自动后台重做或改写历史成片。相同新版渲染器、未改动内容和素材仍可复用。

GUI 先显示八类，更多表达按四个有变体的类别折叠；所选变体只显示必要专用槽及一个阅读/重点折叠区。真实预览框选将鼠标范围反算到源坐标、计算真实哈希，重点可命名、增行、删除、调序和修改有限秒数。专用内容沿 owner/revision CAS 与签名撤销保存，错误输入保留，Esc 取消；转换提示关闭的专用表现，Project 原文件保留。时序为估算/手工秒数，新增表现可显式绑定已核听句锚点；不承诺自动逐词 ASR，已有按句 focus 入口保持独立。一个旁白段落可配既有 visualSegments，多画面不要求重复 TTS。整镜头切割保留阅读/重点/计数/退场原时钟，分配当前来源的目标，无目标的证据子段回到基础证据，旁白及字幕不重写。

文档含 v2 专用卡显式写为 2.2；基础卡/全片新设置/自动旁白回执仍为 2.1，其余旧内容为 2.0，旧版本明确拒绝新版本字段。内容签名含所有专用槽及素材，缓存按实际内容/文件检查；源变化或 CAS 冲突仅清理本次新成片和报告，旧草稿/成片保留。原生验收覆盖横竖屏新增变体、真实红→青反白像素、源变化回滚、鼠标框选/SHA、撤销/重做、译文保存及实际 MP4。OpenAI 官方博客样片使用真实公开截图/录屏、本地旁白及编辑示意图，增加阅读、反白、译文、背景数字、关键词和共同目标；署名仅为 OpenAI，未构造个人引述。字幕为句级估算；隔离测试不代表付费模型或生产 Profile 覆盖。

专项验收：`scripts/studio-next-smoke.ts` 使用临时 profile/Project、实际本地英文 TTS 视频和 Whisper base，验证试听/校正/人工译文保留、Assistant 路由、预览位置与属性同步、模板撤销重做、关键帧、双语 SRT/VTT、横屏/竖屏预览与实际 MP4 像素一致性、溢出失败清理。可通过 `BMW_STUDIO_SOURCE` 复制既有公开视频到临时 Project 验证 ASR；不写入原文件。此自动夹具不证明人工转写准确率，也不证明付费模型翻译质量。

## Project 来源与引用

### 有界长篇文档与制作

整片由共享预算限定为720秒、96个顺序分镜，每镜1–60秒；全片独立对象仍至多64个、每容器各至多八视觉/音频对象、同时至多四个视频叠加解码器。编码素材总量256 MiB、文档1 MiB、来源1800秒、旁白/单次ASR区间180秒及下载512 MiB预算保持。成片回执与旁白回执分别验证720/180秒；成片回执拒绝时清理本次新MP4/报告，不覆盖旧成片。原生作业仍限十分钟，超时明确失败。

文档2.6保留已有内容/证据能力，仅当超过旧180秒/24镜或原淡变/编号时钟预算时自动选择；旧版本不能通过改版本名或导入扩展内容。时间轴至多96区域、352轨道，独立空容器至多194；各轨道片段数和文件总字节预算保持。模型read摘要按pageOffset/pageLimit分页列镜头，返回scenePage.nextOffset；GUI继续读取完整草稿。审片每镜最多24状态点，全片576点；更多分镜按均匀分镜配额选择，保留omittedCandidates，不声称完整语义审阅。相邻原声仅在文件、源时间、成片时间、速度及音量均连续时共用解码状态，不能仅凭文件名合并。音频分窗以已消费区间的结束位置判断重叠：全片峰值扫描后首次从中段播放、回退或向前重叠跳转均从原解码起点重建状态，保留AAC预热；无重叠的连续窗口复用状态。真实AAC原声和独立WAV音轨须与整片混音逐样本对照，不能用播放按钮状态代替音频验证。

### 全片来源分析任务

`video.studio` 的 `analysis` 操作接收闭合 `analysisRequest`：list/create/read/step/densify/review/retry/export。必须传当前所属draftId/expectedRevision；任务另有独立revision，保存在Project的source-analysis/草稿目录，绑定Project/Session/draft，普通草稿更新不能伪造或清空账本。当前视频轨每0.5秒规划基础帧，显式不重叠区间每0.125秒加密，重叠基础点复用；加密重新投影序号但保留原帧与作者审阅。step一次取最多8张384×384以内的PNG，read返回既有图像而不重新解码；Bridge仍按8图/20 MiB、Project路径与实际PNG SHA准入，完成页可返回零图。

任务区分计划、已抽取、待办、失败及作者声明已审阅；生成图像不自动批准审阅，模型不能覆盖用户校正。原生采样可返回8×8亮度签名，亮度均差达到0.12的相邻基础帧提出候选区间；不是语义转场检测，也不找全短闪帧。任务来源/PNG哈希每次相关消费复查，变化拒绝继续；分页失败明确记录，retry只显式释放已失败序号重试，取消不记失败，已提交页跨重启保留。单任务最多18000目标、512 MiB帧输出、16 MiB账本，每草稿32任务；源512 MiB/1800秒限制保持。read按固定目标序号每页八点，失败或待抽取不会被后续成功帧挤走；返回各点请求秒数与状态。list只返回有界任务概况，来源是否可继续使用在消费时复查；单任务响应最多列二十条区间/候选并报告省略数，完整区间保留在报告。export每册最多200目标，按UTF-8实际字节缩短分册以遵守512 KiB文本上限，保留完整中文审阅内容、失败/待办的请求时间与状态，导出Project JSON账本与覆盖/限制，按返回reportPage/报告nextOffset续册。没有音频核听或原始工程图层认证。

Studio既有参考素材弹窗内可新建/读取任务、逐页或连续取帧、停止、填写本页审阅、检查亮度变化候选并添加加密区间、显式重试和导出分册。该任务不占旧参考记录名额，不修改镜头、字幕或旁白；原有1–8帧参考分析保持独立。

MP4/QuickTime采样页由本地容器解析器从页首请求时间前的关键包解码，保留不晚于请求时间的实际呈现帧，避免每页重复从文件开头解码；其余格式仍保留顺序读取路径，兼容没有seek索引的MediaRecorder WebM。原生读取仅保留两个解码画布，不能将该优化解释为全源逐帧解码认证。

来源通过既有 video.studio 的 operation:source 管理，sourceRequest.operation 为 list/read/collect/confirm/acquire。它在同一 browser FIFO 中执行；当前对话必须属于活动 Project。来源证据由 Project 内会话共享，草稿和引用修改仍受 ownerSessionId 与 revision 保护。

collect 必须提供 bodySelector，支持 index/excludeSelectors；可独立提供 mediaSelector/mediaIndex/mediaExcludeSelectors、authorSelector、publishedSelector、accessSelector 和 Project tabId。固定 DOM 脚本读取限定可见正文与 DOM 媒体，不回退整页，也不混入全页网络资源。输入框、编辑区、隐藏节点及显式排除范围不进入原文。导航、缺失范围、失败和截断分别记录；取消不保存迟到结果。作者保留实际元素原文，发表时间保留原站明确时间或唯一完整日期行（允许“发文日期”等标签与邻接署名／文号）；限定日期区域内分开的“年／月日／本地时钟”文本节点可归一为有效公历日期，仅保留日精度、不推断时区；多日期、无效日期、更新／录制标签及截断仍拒绝，已有来源记录不重写。混有第二日期或范围截断时不选取日期，缺失为 null；标题/作者/日期/限制提示超出各自上限时，获取结果记 truncated 并列出被截断的字段；事件时间另由确认操作声明，采集时间由宿主记录，不相互代替。

Project sources/catalog.json 保存 Schema v1 的页面 URL、获取记录、正文/媒体范围、原文 Artifact/SHA-256、观看限制、候选、确认和实际媒体记录。最多 200 个来源、1000 次获取、每次 80 个候选和 40 次媒体尝试；正文 50000 个 UTF16 单元/256 KiB，元数据 4 MiB。同 URL 合并来源，重复原文可共用内容 Artifact，获取记录与多个 URL 关系保留。过时 source expectedRevision 冲突，损坏目录/改变的原文保持原样并报错；拒绝 symlink，失败仅清理本次新文件。

候选区分 body 图片、cover/poster 和 video/source；发现和确认不等于下载。acquire 的 method=download 取得确认候选的有限 HTTP(S) 文件；blob、分段流/manifest 不绕过下载限制。method=preserve 直接取得已确认HTTP(S) video/source候选的完整分发文件或受支持的明文有限HLS VOD，复用原生Session传输与无重编码保全，不启动播放器；可携带闭合preview {startSeconds,endSeconds}，要求0–1800秒且区间至多30秒，Host用原生转换生成有声短预览并登记同一来源。原分发文件不重编码，短预览明确reencoded=true；SourceMedia可选deliveryRange保存delivery-file-pts区间，文件内startSeconds/endSeconds仍为从零开始的解码时间，新闻卡片使用原文件区间，不冒充播放器source PTS。保存分发清单／分段、包校验及证明，之后同样完整解码并登记来源。Studio提供「无播放保全视频 / HLS」入口；保全失败不自动改用录制。成功去重时保留本次独立保全证据；取消／失败清理本次全部资源，不删旧素材。保全证明只说明取得的分发字节，不声称作者上传原始文件或平台完整片长。method=capture 对已确认 video/source 候选采集 HTMLVideoElement，必须给出 videoSelector，可提供 videoIndex、maxDurationMs（1–1800 秒，默认 900 秒）。固定采集程序在同一 Project 页面验证 URL、候选 currentSrc、限定媒体范围及排除项，录制期间继续核对；不能从其他页面、范围或未确认候选获取。不自动登录或导出 cookies。图片实际解码 PNG/JPEG/WebP；视频用私有固定 media.decode.check 逐个解码可支持音视频轨道至文件末尾，保存样本数、媒体时间范围和文件哈希，最多三十分钟/512 MiB、120000 视频帧/250000 音频样本/两分钟作业。该检查不进入模型动作目录。试看/短于观察时长的文件记 partial-preview，其余有限视频记 decoded-file；完整文件解码不证明平台全长。失败/需要登录独立记录，取消清理新下载并保留既有证据。capture 独立保存 pageUrl/candidateUrl/scope、元素选择、fromStart 请求、原播放器 sourceStartSeconds/sourceEndSeconds/sourceDurationSeconds、stopReason 和 UTC 起止时间；媒体文件的 startSeconds/endSeconds 仍是解码文件时间域。播放器 ended 仅证明当前元素结束；达到上限/requested 或试看均记 partial-preview，不宣称平台全长。当前捕获复用前述 WebCodecs 视频采集、MediaRecorder 音频与有界封装路径，遵守 512 MiB 文件上限和宿主期限；取消/导航/关闭先停止并清理本次录制、恢复播放位置/loop/rate并保持暂停，再释放工作状态，保留已有媒体。迟到初始化有取消标记。GUI 确认的视频候选提供「采集此播放器」入口，范围选项可指定元素和采集上限。同内容媒体实际核对哈希后共用 Artifact，每次来源证明保留并保存 proofContentId SHA-256。read 和引用导出复核当前媒体/证明文件哈希，返回 mediaAvailability（每次最多共读取 512 MiB，相同文件/哈希复用核对），区分 verified/missing/changed/invalid/not-acquired/unrecorded/budget-exceeded；旧记录缺少证明哈希保留 unrecorded，不修写历史。当前证据不完整时来源预览禁用，引用清单保留历史获取与实际媒体范围并另报可用性；取消核对不写入来源或草稿。

准备页的「网页来源、正文范围与引用」展开区提供页面与正文范围选择、来源详情、原文、候选确认、事件时间、获取和已保存素材预览，默认折叠以保留笔记、大纲和素材入口。preparation.sourceIds 关联此次视频的来源。原文选区可引用到指定分镜；每分镜最多十二条 citations，包含 sourceId/acquisitionId、UTF16 startCharacter/endCharacter/quote、kind=fact/opinion、claim、conflict=pending/conflicting 和 eventAt。更新与导出均核对引用等于保存原文的准确子串。GUI 可以移除引用，沿用保存、撤销和版本冲突。来源/引用元数据不进入合成或旁白绑定，不使成片签名或未改旁白失效。

export-citations 使用 draftId/expectedRevision 创建 Project JSON 清单，最多 512 KiB，返回原文范围、URL、原文 Artifact/哈希、发表/采集/事件时间、获取状态、已有媒体范围/证明 ID 与当前文件可用性。fact 表示引用用途，factChecking 保留 pending；冲突不自动变为已核查。GUI 提供下载入口，导出不修改草稿历史。外部网站质量、B站复测和点评样片单独实测，不能由受控 fixture 推断。

资讯布局通过可选 `cardLayout: standard|news` 保存于全片参数；旧内容缺省不写入新值。news 仅支持 16:9/9:16，使用全片标题（最多三行）、顶部文字品牌、固定卡内标题/内容区域和原字幕，隐藏旧编号与进度条；标准布局保持原行为。新参数贯通命名模板、configure、Studio 预览、composition、直接成片恢复和 2.1 文档；2.0 拒绝这些新字段。全片标题的实际绘制框可点击定位原全片标题控件，不修改 scene.title。多行视频标题保留，自动封面标题将换行转为空格，显式封面不改。共享排版校验检查全片标题与卡片区域；资讯品牌固定在顶部，原位置值保留供标准布局使用。原生运行检查已导出八类标准/资讯横竖屏 MP4 并解码每卡画面；官方博客八类样片已实际导出并检查动态帧与音轨；解锁后的原生卡片编辑和窗口尺寸检查通过；样片字幕为句级估算，音轨解码/识别不替代人工核听。

全片可选 `narrationPacing: standard|compact` 用于后续生成/导入完整旁白。compact 以真实源音频长度建立显式 voiceTiming，首尾各两帧，镜头按帧网格取整（避免浮点残差额外多一帧）；不剪除文件自身静音。`audioGeneration.autoTiming` 保存宿主自动窗口快照，普通更新不可伪造或改写；只有当前播放窗口仍匹配快照，重新生成时才更新到新的完整音频长度。已修改窗口、任何 voiceSegments（含显式静音）保留剪切和镜头时长，源区间超过新音频时报错；人工字幕和独立对象终点仍约束时长。切换全片节奏不重排现有音频，新的 standard 完整旁白沿原留白。服务单测覆盖生成、导入、自动重算、元数据防伪及人工剪切；原生检查用实际 WAV 测量验证两帧起止、MP4 时长和持久的自动窗口快照。本项不代表真实 TTS 声学拼接或逐字同步验收。

卡片 discovery 与运行时共用内容约束：`describe-template` 按模板版本发布 `contentContracts`、派生场景 `sceneConstraints`、素材绑定路径与阅读模式上限。`whole-to-detail`/`detail-to-whole` 只接受一个目标，`sequence` 按模板最多一或三个。派生草稿和 compose 的场景 schema 带条件约束，明确要点数量、静态图/视频、素材必填及互斥；源图 SHA pin 不自动附着主画面，canonical document 的实际画面仍归 primary timeline clips。错误包含镜头 ID，越界高亮包含索引和原 presentation 秒数。

## 视频参数和模板

Settings 的视频制作项支持比例、分辨率、帧率、内置画面风格、水印、配乐和 TTS。模板按名称保存在 Profile 的 videoPreferences，草稿保存参数快照；不同 Project 可使用同名模板。

优先级：明确参数 > 指定模板 > 默认值。Agent 可用 `video.settings` 读取/更新/保存模板，或在 `video.studio`/`video.narrate`/`video.compose` 指定模板名和覆盖字段。输入 Schema 闭合、有界；视频设置及草稿采用预期版本冲突检测，拒绝覆盖并发编辑。

TTS 设置只是生成参数；已有音频按分镜保存宿主生成记录 `audioGeneration`：`{kind:"tts",options:{provider,voice,ratePercent}}` 表示实际生成参数，`{kind:"imported"}` 表示手动绑定音频，`{kind:"legacy",options:{...}}` 仅保存旧音频编辑前的目标参数基线，不声称实际音色。旧草稿缺字段时保留原音频并显示「参数未记录」；后续改变目标音色/语速会标记旧音频过期。生成音频的脚本、provider、voice 或 ratePercent 改变后需重新生成，预览不混入过期旁白，导出拒绝过期音频。手动绑定音频不受 TTS 设置影响。GUI/Agent 草稿更新不能改写同一音频的真实生成记录、脚本文本及实测时长。字幕内容和样式可独立编辑，不使旁白过期。

## Video Studio

主轨交互在预览准备开始时禁用实际片段按钮和属性，重绘保持同一准入状态；等待准备／保存／选择事务完成后恢复，防止可见按钮与操作拒绝状态不一致。该约束不改变媒体时钟或导出像素。

Studio 默认使用镜头卡片、脚本与预览的统一工作台；高级编辑为主动开启的全窗口多轨视图，同一 Assistant 转为浮框。两种视图共享草稿、媒体、撤销和归属，没有第二个自然语言输入。用户已要求暂不继续 UI／工作流优化；本轮仅核查一致性。专用 AI 图片／视频素材生成暂缓，素材准备使用现有 Project 文件及浏览器采集能力。

卡片拖动提供明确的前/后插入位置及边缘自动滚动，只在松开时沿原 CAS 保存，可撤销。未保存输入先正常保存；保存期间已松手或取消，不延续拖动。同版本预览和任务刷新保留手势及标记；Project、Session、草稿/revision、模式变化，以及 Esc、区外松手、指针取消、失焦和缩放取消。镜头身份、旁白、字幕、图层及旧成片保留；不新增按钮，原菜单调序继续可用。

可选测试版审阅支持字幕样式与原文/译文/双语显示建议，使用有限结构化 before/after（null 表示未设置）和已有样式契约。建议保存不改画面；用户逐条采纳/忽略/撤销，保留字幕内容、时间、来源和实测旁白。字段或定位时间变化时拒绝覆盖；未设置字段撤销后恢复未设置。前后对照用可读样式标签，不新增常驻按钮或模型工具；实际画面依据与建议质量仍需人工核对。

自动打开高级 Assistant 时，若正常 320px 高度的四角都遮挡所选对象，尝试使用最大可放置的 240–320px 高度，保留输入和发送区并避开播放控制；已选高度随此 Session 的打开浮框保留，选择变化不跳动。用户拖放保留位置与高度；未手动摆放的浮框明确重新打开时重新计算。该高度由原生 Host 内部布局回传，不新增用户/模型参数或编辑草稿数据。

素材准备提供同一全片任务入口“让助手准备素材”，在目标与素材及高级素材资源区复用。允许零分镜草稿；提交前保存当前输入并捕获 Project/Session/草稿，阻止重复提交和同一 Assistant 忙时提交，沿用原归属及 expectedRevision 检查。任务只复用/采集真实 Project 文件并合并 preparation，实际列表随后台更新，不自行更换画面、创建镜头或制作成片；专用 AI 图像/视频生成服务仍未接入，不把任务已提交当作完成。

高级画面与独立图层提供默认折叠的“颜色与模糊”：亮度 0.25–2、对比度/饱和度 0–2、模糊 0–12 输出像素。使用封闭数值 effects，按固定顺序绘制，不接收 CSS、URL 或脚本。主画面仅处理素材，不改变标题、字幕和聚焦标记；独立对象仅处理其自身。可明确清除效果；修剪和分割保留参数；主画面可卡片往返，独立图层按共享兼容性约束保留高级编辑，沿用原保存、CAS、锁定、撤销和共享预览/原生导出。

主旁白提供“静音此镜头全部旁白”，独立于 voiceVolume，保留原音量、实测音频、voiceTiming/voiceSegments 和字幕。旁白片段共享镜头静音状态，界面明确作用范围，时间轴文字标识静音。视频画面属性提供“静音此画面片段原声”，沿用 keepSourceAudio，不改源区间、sourceVolume 或原声字幕绑定。两者复用保存、CAS、撤销和预览/原生导出；静音或零音量旁白不触发背景音自动避让。普通 Agent 更新省略 voiceMuted 时保留当前值，显式 false 可取消静音，带 undefined 的 GUI 历史快照可清除此字段。无旁白时控件禁用，图片不提供原声控制。

### 有限多轨与独立对象

预览与原生导出共用有界混音：48kHz双声道PCM每窗口至多4秒，先扫描全片峰值，再用同一全片增益渲染窗口；原声/独立音轨保持连续解码状态，任意回退或重复读取同一首窗口从片段原始源起点重建状态，避免AAC重复预热及PCM定位误差。只保留当前窗口、连续来源当前块及至多一个解码后的旁白源（仍限180秒），不分配整片PCM缓冲。Studio至多排程两个窗口，使用同一AudioContext绝对时钟，暂停停止并断开已排程节点，重建/关闭等待窗口任务结束。整片契约至多720秒/96分镜，源文件和单段语音预算独立；内部音频时钟验证不等于成片视觉/核听验收。

有限图层使用镜头局部 `layers/audioTracks` 与全片 `layers/audioTracks`，每个容器各最多八项、全片最多 64 个独立对象。视觉对象为文字/矩形/Project 图片或视频及有限科学图解，时间、标准化几何、透明度、层次、显隐/锁定、淡入淡出及显式 2–12 个关键帧为封闭字段；同一时刻最多四个视频叠加解码器。图片沿用共享 32 百万像素/256 MiB 预算，视频解码检查实际尺寸、透明数据与源区间。独立音轨按实际源区间/速度/音量流式混合，支持静音、淡入淡出和旁白实际区间内降低至 25% 的配乐增益；预览与 H.264/AAC 导出使用相同混合与图层绘制。越界对象保留原值并阻断预览/导出，不静默截断；普通更新省略既有图层时保留；清除独立对象须在可信高级编辑中执行，简洁更新不能用显式空数组丢弃对象。新素材必须在当前 Project 中通过 ArtifactJobIO；复制镜头给局部对象新身份。没有 shell、HTML 或任意渲染脚本入口。高级资源分素材/脚本/元素/音频；文字、矩形、图片、视频和音频可加入当前镜头或全片容器。音视频按实际可解码轨道的首时间戳和终点确定源区间。对象可从画布命中或独立时间轴选择，属性支持内容/几何/层次/显隐/锁定/音量/静音/旁白避让/淡入淡出和显式关键帧，使用同一草稿 CAS、撤销、保存与预览。时间轴独立片段可拖动移动、两边修剪、按播放头分割；缩放保留对象选择。关键帧裁剪保持边界样本；缓入缓出采用受限 `easingRange: [from, to]` 保留原 smoothstep 的连续区间，重复修剪/分割及播放头插点保持位置、尺寸和关键帧透明度曲线。该字段只用于缓入缓出，两个有限端点必须在 0–1 内并严格递增；不接受曲线代码或表达式。共享绘制器按区间重新归一化，原先无区间字段的动画保持原行为。属性标明“保留原曲线”，明确修改插值会重设该段曲线。保持区不制造额外无用端点，切割十二关键帧的动画仍在既有预算内；新增点超过十二个则拒绝并保留原值。片段淡入淡出的边缘行为沿用既有规则，本项不代表所有效果的无损裁剪。保存冲突保留对象输入和当前模式，明确确认重载后才放弃。独立对象存在时拒绝返回卡片并保留对象及选择；撤销或移除后恢复简洁编辑资格。当前画布选择、移动、缩放与实时像素更新已接入；空白选择打开原有全片参数，按草稿版本应用、可撤销，模式切换保存参数并保留全片选择。主轨、有限整镜头分割和逐项审阅使用下文同一契约。受限对象与动画不构成通用 NLE；超出契约的复杂绑定仍拒绝。

独立图层和音轨的时间轴行提供一个对象菜单（亦支持右键与 Shift+F10）：编辑属性、锁定/解除锁定、隐藏画面或静音/取消静音。使用已有 locked/hidden/muted 字段和原 CAS/撤销/预览/导出，不新增副本或工具。菜单捕获所属草稿、会话与 revision；版本、模式或归属变化关闭菜单，过期点击拒绝。锁定对象的可修改参数、删除、动画及分割呈禁用，仍可解锁、隐藏或静音；锁定沿用既有编辑保护，不作为宿主权限。菜单键盘导航和 Esc 返回触发点；滚动/缩放窗口关闭菜单，避免悬在错误轨道。

高级编辑的画布与时间轴之间提供可聚焦分隔条：默认约占可用编辑区 34%，拖动或上下方向键调整，Home/End 到最小/最大，Esc、指针取消或窗口失焦恢复本次拖动前高度。边界保留至少 220px 上半编辑区；轨道在时间轴内滚动。按 Project/Session/草稿保存当前 View 的比例偏好，往返保留，窄窗仅限幅，不改视频数据、revision 或撤销历史。布局变化同步原生 Assistant 避让区域及响应抽屉。

单画面和各 visualSegment 支持最多 24 个有序、非重叠 `focusIntervals`：`startSeconds/endSeconds` 是原素材秒数（图片为原画面效果秒数，内容分割后保留），最短 100ms；`x/y` 为完整源画面中心 0–1、`zoom` 为 1–4、`emphasize` 控制中心标记。焦点在原 crop 内平滑进出，预览/MP4 使用同一绘制与 trim/rate 映射；时间轴投影重点区间。画面属性提供添加、修改、删除及撤销/重做；聚焦输入在分镜/Session 切换前保存。焦点不重录视频、不使未改旁白过期，但使旧成片复用失效。替换画面移除旧素材的焦点；追加片段保留原画面的焦点。保存失败后的本地焦点仍可删除：删除先移除目标再提交修正后的草稿，不重试已被拒绝的旧草稿；删除目标正在输入的参数随目标一并移除，其他参数输入仍正常提交。删除支持撤销/重做，仍遵守所属 Session 和 revision 冲突检查。

`suggest-focus` 要求所属 Session 的 draftId/expectedRevision/sceneId，支持 segmentIndex；只读取当前 Project 对应录制事件文件，返回实际记录与确定性点击分组建议，不写草稿。建议只使用有实测帧映射且位于录制表面内的点击，缩放上限 1.5。GUI 接受建议后仍可逐项修改；已有手动区间不会被覆盖。普通视频/图片可手动聚焦，缺少录制事件明确提示自动建议不可用。建议不证明操作结果或页面正文都在焦点内，交付样片仍需审片。

画面素材选择统一提供列表／图标视图、按可见区域加载的真实图片／视频缩略图及放大预览；覆盖素材准备、匹配、工作台、封面和画面片段。预览只读取当前 Project 素材，沿用读取／解码预算、媒体控件与切换取消；显示方式切换不修改视频草稿。

交付页可直接查看／另存任意已有成片。`render` 默认复用内容及文件签名一致的已完成 MP4，不启动编码、不增加草稿 revision 或成片记录；`forceRender: true` 明确重新制作。后端签名包含有效合成参数和源素材／输出／验收报告的文件状态；分镜、字幕、音频、尺寸或文件变化使复用失效，封面与准备笔记不影响视频。旧记录缺少签名时仅提供手动查看／另存，不推断为当前成片。签名由完成作业记录，编辑不能伪造；归属和 revision 检查继续执行。

草稿保存在 Project 中，但由不可修改的 `ownerSessionId` 强绑定到唯一 Session。一个 Session 可以拥有多个草稿，共用 Project 素材；列表、读取、修改、生成和删除均在后端校验可信调用身份，另一 Session 不能编辑或继承草稿。Bridge 将已认证 Session 身份传递到执行链，Renderer 的归属由主进程确定。未绑定的历史草稿默认不可见，不自动认领。切换 Session 前保存已输入编辑，切换后显示该 Session 的草稿及独立选中状态；没有草稿时显示空状态。草稿 Assistant 请求提交到其所属 Session。当前 Studio 作业未完成时拒绝切换。

「删除草稿」要求当前版本并确认，移出活跃草稿列表，保留 `video-studio/deleted` 中可恢复记录；不删除 Project 共用素材、封面、字幕或成片文件。删除最后一个草稿恢复空状态。

Studio 使用主工作区，不创建独立退出入口。GUI 与自然语言共享当前 Session 的草稿、选中分镜、阶段、版本、材料和导出结果；DSH 驱动在官方上下文快照中注入当前 Studio 数据，数据不被当作权限提升指令。

默认「卡片编辑」把纵向镜头卡片、同一份 scene.narration 脚本和预览放在工作台。当前卡片复用 canonical script-current 编辑器，不维护另一份脚本；只展开所选卡片，其他卡片保留可读正文、缩略图和旁白状态。当前卡片只常驻「换画面」「声音与字幕」两项详情入口；画面取景和明确标识的 Assistant 委托放在镜头菜单，可关闭详情继续复用原有编辑器。支持按镜头 ID 校验的拖动调序及菜单调序、复制、删除和撤销；Project 原素材不重复复制、不随镜头删除。目标、背景、受众、大纲与素材集中在「目标与素材」详情；空状态示例只预填原有 Assistant 输入，发送后才执行。

主轨操作按镜头 ID、片段类型/索引和捕获的 revision 校验。镜头调序保持卡片顺序一致；主序列改时长顺移后续镜头，局部对象仍属于原镜头，全片对象保持绝对时钟。越界对象、字幕重叠或引用无效会拒绝操作并保留原值。旁白新增可选封闭 `voiceTiming {startSeconds,sourceStartSeconds,durationSeconds,playbackRate}`；`audioDurationSeconds` 仍是原文件实测长度，不作为播放片段长度改写。默认仍从 0.5 秒播放完整旁白并保留 1 秒总留白。明确编辑的播放区间按实际解码音频复核，预览、AAC 混音、配乐避让、估算字幕及人工句锚点共用该时钟。句锚点保留原音频秒数与哈希，修剪排除被引用句时要求明确调整引用，不自动截断。独立字幕时序修改不改写旁白。时间属性输入在外部更新/版本冲突中保留，用户明确重载才放弃。字幕来源 receipt 记录 voiceTiming；不把估算字幕当作自动对齐。

旁白可在播放头处分割为一至八个 `voiceSegments`，与 `voiceTiming` 互斥；每段有稳定 ID、镜头内开始、原音频源开始、播放长度与速度，输出按时间排序且不得重叠，实际源区间复核后才能播放／导出。分割保留原文件、原实测时长、正文和句锚点哈希；连续源／输出的切点合并句投影与配乐避让，避免人为插入淡入或重复句动画。移动／修剪／速度编辑只改选中段，不伪造词级时间。独立人工字幕不随旁白重写，关联句投影到可见区间；完全移除仍被引用的句须先处理引用。换文件或重新配音显式清除旧播放区间；旧调用省略该字段时保留已有片段，GUI 撤销用显式清除恢复原时钟。

主画面分割保留镜头、旁白、原句锚点和独立字幕，不改写源文件；左片段保留既有 ID，右片段生成新 ID。封闭的 effectWindow 保留原始推近、图片聚焦和淡入／淡出的秒数域；视频聚焦继续使用原视频秒数。明确改变片段转场可建立独立透明度时钟，仍保留画面运动时钟。连续、同原声音量的分割片段复用同一次原声解码，避免 AAC 在每个切点重复起跑；连续同源、同速度、同源区间的分割片段投影成一个原声字幕播放组；宿主据旧身份或唯一相同播放时钟重定位可信证据／字幕绑定，人工原文及译文不覆盖。实际移动、修剪、换素材或调速造成播放组变化时原绑定仍可判为过期，不能仅靠文件名猜测重新绑定。效果窗之外的扩展不自动建立新来源时钟；有限整镜头分割见下文。

时间轴单击主片段只选择并暂停，不移动播放头；原生标尺输入和键盘定位沿用同一播放与版本保护。主画面和旁白片段的 ID 可成为 Assistant 精确对象范围，第一次输入后独立固定；GUI 撤销移除片段后清理失效选择，但不改变已固定请求，发送时仍拒绝被删／错误类型／其他镜头的目标。

高级编辑需主动开启，宿主将 Studio 扩展到完整应用内容区，隐藏浏览器 Shell 与固定聊天侧栏；应用内沉浸不改变操作系统全屏状态。上半部资源左侧、画布中央、所选分镜画面／旁白／字幕属性右侧，底部展示同一草稿的主轨与独立图层/音轨。主镜头可拖动调序、右边缘改时长，画面片段可调序/修剪；旁白可移动/修剪并精确设置源区间、播放长度和速度；字幕可移动/修剪/按播放头分割，保留双语内容。独立对象可移动、修剪与分割。主画面可在播放头处分割为最多八个内容片段；有限整镜头内容分割已实现；超出可信来源范围的复杂关联重绑定拒绝。切换前保存输入、校验版本、暂停播放；失败保留当前视图与输入。进入高级时回到草稿画布，准备当前预览后启用定位，避免沿用成片视图或待准备的 1 秒范围。往返保留草稿、选中分镜、播放位置、撤销／重做、原 Assistant WebContents 与未发送文字；返回恢复侧栏宽度。高级编辑进入时，先完成保存和工作区重排／实测边界，再自动将原聊天展示为最大 320×320 的小浮框；可收起为状态胶囊。修改分阶段确认等任务偏好不会关闭已打开浮框或重新打开用户已收起的聊天。浮框位于实测属性列左侧，限制在时间轴和实际播放条上方；Renderer 可上报闭合数值范围内的 floatBottom，为自由浮动额外预留播放条，主动停靠仍使用完整属性区。自动选位的浮框在明确收起后重开时可重新避让当前对象；已打开的浮框和用户手动位置不因选择／播放改变而跳动。浮框保留范围、输入、最近消息和任务状态，完整会话可展开；驱动切换仍可通过设置操作。用户主动停靠时才替代属性区，收起恢复属性；Renderer 通过合并计时器、resize 和尺寸观察上报实际属性列边界，Native View 依此停靠；上报不依赖 requestAnimationFrame。原生 Studio/Assistant 层级直接重排已挂载 View，避免不必要的拆卸；隔离桌面验收须等待实际渲染后比较同一时刻 DOM 与原生边界。较大窗口默认自由浮动；小于 1000px 的窗口暂时停靠。小窗关闭不覆盖用户的浮动偏好，恢复大窗后按原偏好和位置展开。宿主模态层及 Studio 详情暂时隐藏聊天，关闭后恢复。

高级资源/属性响应布局使用同一 canonical DOM：宽度 ≥1100px 保留两侧栏，700–1099px 把资源折为可打开抽屉，<700px 将资源和属性折为一个非模态抽屉。打开/切换/关闭先保存输入；资源与属性详情互斥，宽窗恢复时把原节点移回，未保存字段不复制或丢弃。抽屉仅占上半编辑区，时间轴继续可操作。高级模式的原生主窗口最小尺寸为 420×640，退出后恢复 960×640；若返回时低于普通宽度则扩至原最小宽度。小窗聊天按实测上半区宽度停靠，详情期间暂时隐藏原聊天。

原生浮框首次展开根据资源/属性边界及选中对象的实际矩形选择遮挡最少的角落；空间不足不保证零遮挡。首次自由位置确定后保留，后续选择/播放不自动跳位。标题栏拖动合并连续指针请求并顺序移动同一 Native View；Esc、取消或失去手势恢复起点，收起/停靠先结束并排空拖动。拖动、收起和停靠都捕获 Project/Session，宿主拒绝过时归属；请求不改变草稿或发送模型输入。几何契约允许紧凑停靠属性宽度最多为整个窗口，资源宽度最多一半，避让矩形闭合且不得越过标准化窗口边界。

离开 Studio、切换会话或替换当前 View 时，宿主记录实际暂停的 View 并发送隐藏通知。返回已缓存的同 Project／Session 工作区也必须在归属校验通过后发送恢复通知；不能仅依赖 owner 是否变化。原 Renderer 恢复顺序读取和合并通知，获取新增 Project 素材，不改写草稿或重新发送请求；重复打开已经活动的 View 不重复重置预览。销毁时清除暂停记录。

聊天在开始输入时固定「整支视频／镜头／画面、旁白或字幕」目标；后续界面选择不会改目标，可主动更改。未发送文字和目标按 Project/Session 保留。提交由原 Assistant 主框架经闭合 IPC 验证归属及目标存在，先保存 GUI，读取目标最新 revision 并冻结上下文进入 Host FIFO；DSH 官方上下文入口与其他驱动使用同一活动请求快照。拒绝外部发送者、跨 Project/Session、已删镜头、保存冲突和非法字段；拒绝保留输入、不产生请求。独立视觉图层和音轨使用闭合的 layer {id,kind}，镜头内对象附 sceneId，全片对象不附 sceneId；不能混用旧 objectKind。Host 保存前后检查精确容器、对象类型与存在，并把名称/时间等有限数据冻结到请求上下文。对象属性的“让助手调整此对象…”只预填，不执行；已有未发送文字时保留原文和目标，不追加另一条委托。当前选择已删除的对象不能成为新的 live 范围，已固定请求仍会在发送时拒绝。主画面对象范围可带 visualSegmentId，必须同时为 object／visual、带所属 sceneId，不能混合旁白 ID 或独立图层；身份格式沿用已有画面片段的闭合字符集。宿主校验当前草稿的精确片段存在，冻结名称、镜头内开始及长度。时间轴选择携带实际稳定 ID，调序后重新按身份解析当前位置；删除后清除 GUI 选择，固定请求仍在发送时拒绝。尚无持久 ID 的旧单画面沿用镜头画面范围，不在选择时改写草稿或制造临时身份。该范围是用户请求上下文，不扩展或替代 browser 的授权。既有 browser 工具数、官方循环、取消清理与未知投递不重发规则保持不变。可选“分阶段确认”是冻结的任务说明，实际模型遵从仍需效果验收。

Studio 任务卡读取宿主统一 Assistant 会话状态与实际 browser 工具事件，严格过滤 Project/Session，区分排队、执行、等待、取消清理、失败和未知结果。停止委托宿主原有取消链并等待清理，不自动重发未知任务。对话成功结束不被当作成片生成；卡片另外显示真实草稿/素材/导出记录。保存与原生媒体作业进度分别显示，不估算 Agent 百分比。DSH、Codex、Qoder 共用该投影，无额外模型工具或 Agent 循环。

任务投影按当前 run 的实际 callId 配对工具开始／结束；工具结束后不再把最后一次启动的动作冒充仍在执行。只显示所属 Session 的事件时间、上次完成动作及结果、当前活动工具与开始时间，Host busy 或资源断开单独阻止续做。没有当前事件时不虚构时间。任务卡按已保存草稿版本显示素材、分镜、主旁白就绪与待制作数（含导入的主旁白），不把元数据就绪称为已试听。narrate-pending 的开始、逐段提交、失败及完成通过所属 Project/Session 的受限通知推送：报告实际提交的 ID、当前版本与当前待办，GUI 作业仍忙碌时也能显示已保存段数；稍后人工改稿可使此前提交过的镜头再次待制作，两种计数不混为同一状态。界面时钟只更新已知事件的经过时间，不调用模型或媒体；九十秒无新可见事件／提交进度仅提示查看状态，不据此认定卡死、停止或重试。

“准备续做说明”只在所属 Session 已结束且 Host 没有活动任务、未知投递或待清理资源时开放。可信主 frame 的 video-studio-recovery IPC 只接受 draftId/expectedRevision，复核当前 Project、Session、草稿归属、版本、取消清理状态和官方运行时忙碌状态；模型不能提供文本、路径、另一 Session 或原始请求。Host 根据当前已保存旁白待办与指纹有效成片生成固定说明，作为全片范围预填到现有 Assistant，submitted=false/automaticReplay=false，不入队、不调用模型、不重放旧输入；已有未发送文字仍遵循原预填保留规则。用户检查并发送后才沿官方运行时及原输入回执链执行，发送时再次冻结范围／检查版本。断线、投递不确定或清理未完成时拒绝准备，不以终止事件冒充资源已经释放。原有“制作并导出”仍是在用户明确确认后检查当前状态并选择性续做的原生工作流。

成片生成时简单视图可展示实际 MP4并切回草稿；旧文件和当前草稿独立保留，复用状态来自后端指纹。顶部单一交付入口随状态显示「生成视频／制作更新／导出视频」，先打开检查与导出面板，列明待制作旁白镜头。用户确认后仅执行 narrate-pending 中失效或缺失的旁白，再用当前 revision 执行完整 render；生成过程锁定编辑，取消／失败保留已经提交的旁白和旧成片，不继续后续编码。当前有效成片直接复用，不重配音、不重复增加导出记录。视频编码仍可能重做全片。强制重做、封面／字幕／历史及默认关闭的可选测试审阅位于二级入口。真实素材、时长、语音、预算及编码技术门槛继续约束导出。

主轨由已有顺序分镜、视觉片段、旁白播放窗口和字幕区间投影；独立轨道由持久化 layers/audioTracks 投影。手动编辑写回同一规范字段，不另存一份时间轴模型。点击分镜或片段定位累计时间；播放/跳转跨分镜时同步列表、属性、时间轴与原有 Agent 选中上下文。字幕仍标注估算或编辑来源；过期旁白标注需重生成。切换属性、封面、设置或交付前保存聚焦输入并检查版本，保留撤销/重做。

封面模式中央只展示独立 PNG，左侧编辑全片封面，暂停视频播放并隐藏视频时间轴；零分镜也可使用。交付集中 MP4、封面 PNG、SRT/VTT、制作检查、字幕下载和历史成片/验收报告。任务状态与保存状态分开显示，媒体作业运行时才显示取消入口；未更新预览显示提示。布局支持窄窗口和明暗主题，仅开放已有保存、共享预览与真实导出实现的有限图层/显式关键帧控制。

默认工作路径：可选填写目标／受众／背景 → 准备真实素材 → 在卡片内编辑脚本和画面 → 预览 → 检查与导出。材料、全局脚本、旁白、匹配和详细属性是按需展开的编辑入口，不要求用户逐阶段通关。高级模式把同一内容呈现为多轨工作区，导出规则一致。审阅是交付区默认折叠的测试功能，不成为导出门槛。

`video.studio` 的操作全集从有效 Action Schema 生成在文末。文档Schema、describe-schema/list发现和Studio模型上下文共用版本清单，统一公布2.0–2.9；保存时仍按实际字段选择最低能力版本。请求使用 Artifact ID、Draft ID、Scene ID 和 expectedRevision；update 的草稿为受限对象，无任意 HTML/脚本。attach 验证真实媒体类型和归属。视觉修改保留未改脚本的旁白绑定；脚本变更要求重生成。空草稿可保存、准备素材、配置和制作封面，不能导出视频；最多96分镜、720秒全片，素材集合与正文有明确上限。2.6承载扩展时钟；2.0–2.5仍拒绝超过180秒/24分镜、扩展淡变或编号时钟的文档。

全片制作面板显示分镜数、总时长与待制作旁白数，问题可点击定位分镜。`narrate-pending` 使用草稿保存的 TTS 参数顺序制作非空脚本中缺失/过期的旁白，跳过仍有效的生成音频、导入音频和无旁白分镜。每段完成即以 revision 保存并通知 UI；取消、服务失败或并发编辑阻止后续写入，已完成段保留，失败附带 `STUDIO_NARRATION_PROGRESS`：当前 revision、已完成/失败/待制作镜头 ID、`requiresFreshRead:true` 和 `automaticReplay:false`；读取最新草稿后可续作。禁止在线旁白时批量入口同样拒绝 Edge。音频绑定/再生成后的分镜时长至少覆盖实测音频 + 1 秒和独立编辑字幕的终点，不静默裁剪字幕；同时保留卡片高亮终点与退回依据的阅读时间，切分镜头按原 presentationWindow 投影而不重置卡片时钟；60秒分镜/720秒全片上限仍有效，单个旁白源仍至多180秒。

`check` 需要 draftId/expectedRevision，只读检查当前 Project 的素材和实际音视频时长，返回 revision、ready、总时长、累计时间轴、画面可用时长/缺口、待制作旁白 Scene ID、带 code/severity/Scene ID 的问题与 checkedAssets。一次检查中共享图片与音视频只探测一次，全部分镜问题汇总；检查期间 revision 变化或取消即拒绝结果。音视频检查可解码轨道、真实 alpha 包和尺寸；图片通过受限原生 Worker 实际解码静态 PNG/JPEG/WebP（verification=decode）。图片头在解码前限制单图 32 MiB/16,777,216 像素，全片唯一素材最多 256 MiB，图片总像素最多 33,554,432；检查、预览和导出共享预算。损坏、动画、SVG 或超预算图片阻止导出。材料库缩略图和图片弹窗也复用同一静态图片头检查，在 createImageBitmap 分配前拒绝超大或动画图片；缩略图最多两路并行、缓存 64 项。check 另返回当前宽高/fps 的 H.264/AAC 编码可用性；不支持时给出 encoding-unavailable。原文件不写回实测 metadata；导出复用同一检查且再次探测，不依赖过时 GUI 报告。源起点必须早于视频末尾，选择 hold 也不能放行无有效源区间；有效片段末尾定格作为 warning 展示，仍允许导出。

单分镜可含 `visualSegments`，1–8 个图片或视频片段，每段 0.1–60 秒，总和必须等于分镜时长；与分镜级图片/视频绑定互斥。各片段有独立源起点、速率、取景、原声音量与 cut/fade。fade 为经过背景的淡出/淡入，不重叠播放两个视频、不增加时长。GUI 追加等分时间、编辑时长由另一片段补足、移除按比例重新分配；`attach.segmentIndex` 可追加或替换，替换保留时间分配。测得旁白改变分镜长度时同比调整片段；旁白和字幕保持分镜连续时间。预览/导出共享选片、绘制、混音逻辑，串行读取一个视频片段；原声只覆盖对应片段和有效源区间。

`export-cover` 使用 draftId/expectedRevision 和可选 cover 参数，保存独立的 Project PNG；无需已有分镜、旁白或成片。GUI 的「视频封面」进入编辑与预览页的封面面板，支持当前 Project 静态 PNG/JPEG/WebP、视频指定秒数的真实帧和纯文字背景；标题最多 80 字、副标题最多 160 字，文字位于上方或下方，画面可完整保留或居中裁切填满，背景/文字/强调色为不透明 #RRGGBB。尺寸沿用草稿，宽 320–1920、高 180–1920；单 PNG 最多 20 MiB。静态输入最多 32 MiB/32 MP，视频遵守现有字节/像素预算和 1800 秒时长限制，指定时间须在实际视频轨道范围内，返回实际取帧时间，不伪称精确对齐。

封面参数随草稿 cover 保存，宿主独占 coverExports（最多 30 条，保存参数、尺寸、来源版本及取帧时间）；普通 update 保留省略的参数且不能篡改记录。原生固定 Canvas worker 使用 Project 固定文件句柄、限定 IPC 和禁用网络的沙箱，PNG 完成后重新解码验证尺寸。失败、取消或并发编辑只清理本次输出；封面不修改原图/原视频、分镜、旁白、字幕或视频导出历史。UI 可预览、下载 PNG，切换草稿后仍可查看最近封面；参数或输出尺寸变化提示重新生成。旧草稿无需迁移。

`export-captions` 使用 draftId/expectedRevision 和 captionFormat=srt/vtt，在 Project 素材库创建主进程分配 UUID 的字幕文件。分镜局部字幕转换为全片累计毫秒时间；明确关闭的字幕保持关闭，独立编辑字幕不改脚本和旁白。自动字幕使用有效音频的实测时长，仍属于估算，返回 edited/estimated/mixed，GUI 提示来源。取消/并发修改清理本次输出且不写草稿。单输出最多 512 KiB；下载链接与 Project 文本预览可用。

准备阶段的「让 Assistant 起草脚本」与匹配阶段的「让 Assistant 匹配已有素材」通过草稿所属的 BMW Session 及其固定 driver 提交固定、受验证的 intent；旧兼容入口沿用 DSH Session 绑定。提交前后检查 Project/revision；不添加工具或循环。辅助提示要求只补空脚本、保留已有分镜 ID/顺序/旁白/字幕及来源，匹配基于已查看的素材，不足则说明缺口。`read-material` 仅读取当前 Project 的受限文本素材，最多 256 KiB UTF-8 并报告截断；材料是数据，不执行 HTML/脚本。实际模型生成质量与外部调用单独验收。

每次原生成片重新读取最终 MP4，核对可解码的 AVC/AAC、宽高、48 kHz 双声道和实际时长；通过后保存 Project JSON 验收报告。记录产物 ID、实际/预期时长、轨道和尺寸，以及渲染帧数、fps、音频峰值、旁白实测时长。exports 记录 verificationArtifactId，GUI 可下载成片及报告；失败清理本次 MP4。编码能力具有设备差异。

原声可保留/静音/调整音量；源区间和播放率同步混音。脚本、旁白文本、字幕内容互有关联但样式独立。当前字幕时间是编辑或估算结果，不宣称自动逐词对齐。

直接覆盖：feature-video 的 draft、assets、context、preview、studio 等测试及 `scripts/video-studio-smoke.ts`。真实最终混音、音轨/时长/播放由 video-production smoke 覆盖；Studio UI 的确定性旁白替身只验证操作路由，不代表外部 TTS 质量。

## 新增卡片表现的句级引用（文档 2.3）

按句画面强调与板书引用保存期间保持字段禁用，等待实际保存回应及编辑器事务结束后才重新开放；校验或CAS失败保留待修复输入，不让后续输入被先前保存清空。speechLinks.cards 保存最多十二条句锚点引用，支持 reading/highlight/diagram/metric/keyword。每条含 anchorId、kind、index、templateId 和闭合内容快照 target；read-speech 返回当前可绑定 cardTargets、已有 anchors 与过期状态。快照核对原句重点的源 Artifact/SHA/矩形/样式、阅读模式/全貌返回、图解节点和标签、数字值/阶段或关键词内容；目标变更不默默继承旧引用。全部阅读目标需绑定，阅读句区间不得重叠；可编辑中间状态可保存，但未完整绑定或过期时不能消费。

宿主从已核听/编辑句锚点和旁白播放区间派生有界 cardCues，使用原镜头 presentation 秒数供共享绘制器消费。cardCues 不属于 Studio/视频文档的可写字段，模型不能通过草稿写入第二套时间轴。阅读按句进入细节并按所选配方回到全貌；重点和数字使用句区间；关键词和图解从句开始揭示，图解连线等待目标出现。默认手工配方在没有引用时保持原行为。compact 起点、旁白裁剪/变速、整镜头切割、重排和撤销均沿同一原时钟；分割按实际保留目标重新映射引用，不采用已删除的源。更换脚本/音频保留旧记录并阻止消费，需明确校正/重新绑定或解除引用；实际音频和源图 SHA 仍在导出前后复查。

含 cards、镜头旁白覆盖、区间源识别或放大镜字段的草稿输出 bmw.video 2.3，其余旧内容继续输出 2.0/2.1/2.2。2.0–2.2 拒绝新引用字段；文档、编辑、GUI 和原生编码使用同一契约。按句同步面板提供每个固定槽的句选项、失效提示和解除入口，时间轴显示来源与区间；这不开放自动词/字精度或新增模型循环。

Codex 恢复官方线程时使用 `thread/resume` 的 `excludeTurns:true`，只取线程元数据与当前恢复状态，避免累计审片图片在单条 JSON-RPC 响应中突破传输预算。BMW 显示的历史、Session ID、官方 resume anchor、工具目录与输入放行校验均保留；不更换线程，不清空历史，不自动重放未确定送达的输入。

## 手机证据阅读与顺序图解（文档 2.4）

局部内容编辑复用 `apply-edit` 的单次预期版本事务：`captions.set` 支持显式手工 cues、已有句锚点字幕或关闭字幕，保持音频与阅读句区间；原声字幕须先明确解除，Agent 不能删除或替换用户校正的译文。`captions.translate` 在同一 apply-edit 事务中跨镜批量提交 cueIndex／originalText／translationText；每命令1–100条，保持原文、时间及原声关联，原文不匹配或 Agent 试图改写人工校正时整批拒绝，保留原稿。可把字幕生成／改时、译文与兼容样式编辑先合为一次事务，再取得当前清单指纹，避免每镜读写。`card.set` 只修改原生卡片，可同时提交 `links`（kind/index/anchorId）；`card.bind` 仅修改当前卡片引用。Host 从当前目标生成快照并沿用已有实测句锚点，模型不提交音频记录或句锚点哈希。换标签、源图、范围或限定脚注不会自动认证旧语义；未显式重绑的旧引用仍会失效。绑定提交前复核原音频 SHA、脚本文本、播放区间与当前 Project/Session，多个命令任一步失败不落盘，CAS 冲突保留 GUI 编辑。

手机原文的标准推荐配方为 `whole-to-detail`、`returnToWhole:true` 配合目标 `lineCount`：同一源图全貌 → 原句矩形框选与周围压暗 → 平滑放大完整目标 → 静止阅读 → 返回全貌。原生渲染与审片计划共享阶段定义；`describe-template` 的 reading.recommended 发布模式、返回策略、源像素要求、实际行数前提及阶段，`guide` 提供有明确占位值的配方和节奏修复提示。GUI 新建单个阅读目标默认返回全貌，可一键对现有单目标应用推荐策略；不猜测行数，多目标须显式选择 sequence。已有保存的模式、返回设置和未指定行数的历史行为保持有效。

预览和导出共享源坐标与原始句级时钟，不横移、不重排截图文字；长目标仍会缩小适配，须选择较短完整原句并实际核对手机画面，清晰引述／译文可辅助阅读。审片计划采样定位、放大、停读及返回阶段。`sequence` 保留此前横向阅读。长静止提示应通过语义分卡、缩短已讲完的证据展示、或为结尾图解组织完整短句和节点联动处理；不得以循环缩放或截断旁白掩盖提示。修改脚本后重新测量真实音频与检查引用，保留有效图解关系和来源。

原图指纹通过 `video.studio` 的 `inspect`（`artifactId`、`assetKind:"image"`）返回 `source:{artifactId,sha256}`；工具指南提供完整示例。通用 `media.image.inspect` 只检查图像，`read-material` 只接受文字素材。

阅读目标可选 lineCount（1–8）：由操作者核看原图后填写实际行数，不是 OCR。`sequence` 原生绘制按矩形高度与行数估计字高，以 390px 手机宽度下约 18px 的行高安排紧凑原图条；该兼容模式的长行沿同一个、SHA 固定的完整源矩形横向阅读，句首和句尾各有停留，进度可见。`whole-to-detail` 的静止特写完整包含目标及少量上下文，面板高度固定，避免原文／译文槽随放大跳动。高行数或来源分辨率不足仍需视觉复查，估计字高不代表字符识别或可读性认证。配方消费原镜头 presentation 时钟和已有 reading cardCues；回到全貌选项、裁切范围和来源保护保持有效。未填写行数的旧配方沿用原行为。原文/译文卡在启用手机适配时收紧对应文字槽间距。GUI 可填写/关闭实际行数，修改目标后旧句引用需重新绑定。

diagram/sequence 是原生可编辑的二至四节点顺序图解，shape 为 steps 或 funnel，nodes 只接受 label，footnote 为必填口径。漏斗宽度明确为非比例示意；所有节点与连接始终保留，当前句节点用整块反差突出，不靠放大整张 PNG 或拆成许多空白标题卡。没有句引用时 reveal-items 使用均分镜头的编辑节拍；绑定后消费原镜头 cardCues。每个节点标签、shape 和脚注均纳入引用快照；改动不会默默继承旧绑定。GUI 提供结构、节点增删、标签及脚注编辑，原生预览与导出共用绘制器。

上述内容输出 bmw.video 2.4；2.0–2.3 的运行时解析和 JSON Schema 均拒绝伪装版本的新模板/lineCount。旧内容仍输出其原支持版本，不迁移用户草稿或删除素材。模型仍只有 browser。

estimate-speech 是只读编辑节拍建议：原生实测并复核旁白文件 SHA，以脚本文句长度分配音频区间，返回明确 editorial-estimate、automaticTimingApproved=false 和当前 cardTargets。只有节点/目标数与句数一致才返回按顺序匹配的候选；这不是语义确认或声学识别，操作者须核对对应关系。correct-speech 可同时接受 cardLinks（kind/index/anchorId）；BMW 从当前版本补齐内容快照，在一次 CAS 写入中保存已校正锚点与卡片引用，错误或冲突不产生半完成草稿，保留独立字幕/其他引用。模型来源保持 agent-edited，不宣称人工核听。原有 ASR 原始证据和严格建议路径保持独立。

correct-speech 可显式指定 timingBasis：editorial-estimate 可省略 anchors，由 Host 在当前实测旁白上重新计算；显式提供的估算锚点必须与当前估算完全相同，修改过的时间须使用 manual-edit。manual-edit 和 asr-reference 必须提供锚点；后者还须有当前音频/脚本的原始 ASR 候选，Host 核对证据文件 SHA、来源和 audio-file-seconds 时域后保存 Artifact/SHA。方法与 user-edited/agent-edited 作者分别记录在 speechAnchors.timingProvenance；出现此字段才输出文档 2.5，2.0–2.4 拒绝该新字段。GUI 保存校正明确使用 manual-edit；旧记录未指定方法时保持未记录，不推定核听或准确。所有路径保持 acousticWordTimingApproved=false，普通 update 不能重写 Host 证据。

diagnose-timing 要求当前 draftId/expectedRevision/sceneId，只读核对旁白原生解码与实测时长、读取前后实际 SHA、脚本及句锚绑定；ASR 方法另核对保存证据 SHA/来源/时域/时长。文件变化、失效或不可解码分别报告，不认领旧时长，取消/归属/CAS 冲突仍拒绝。返回原始音频时间、按实际播放速率投影的镜头区间、当前句与卡片目标关联，以及有界编辑建议。模型 timingSection 为 overview/sentences/issues，句/问题按 pageOffset/pageLimit（最多 20）分页；GUI 保留全文，交付区“句级节奏”弹窗展示实际时长、方法、作者、证据/绑定状态及可定位建议。检查不写草稿、素材或媒体，不自动重配音、剪切或增加运动。

节奏阈值为编辑启发式：长句超过 56 个阅读单位或 9 秒，密度超过每秒 9 单位，静止细节停读建议至少 max(2 秒,实际行数×1.2 秒)，单图解节点强调超过 8 秒、流程结束后余留超过 4 秒提示检查。中文计一单位，其余非空白字符计半单位；每镜最多 40 项问题并报告省略数量。还提示未覆盖脚本、缺少目标关联、顺序图解的独占强调窗口相交和未填写实际原文行数。阅读阶段复用原生全貌/定位/放大/停读/返回比例；分割镜头沿用原始时钟，只提示联合相邻镜头检查，不重启流程或把局部窗口误作完整停读。check 每镜最多展示三项节奏警告，不阻止其他条件有效的导出。身份/哈希相符不证明语义关联或声学逐字准确，仍需试听与实际成片审阅。

video.studio / guide 提供短目录、有效模板和完整调用示例；describe-schema 保留全量契约，describe-template 按需返回所选模板。工具提示明确嵌套 studioRequest、review-export、reviewOffset、原文矩形行数和上述建议/绑定顺序，不要求模型手写 JSON target 快照。reference 删除仍只供用户操作。

## 关键状态画面检查与实际成片手机审片

原生导出在同一 Canvas 绘制路径记录关键状态：镜头起止、入场结束、字幕切换、板书揭示、证据重点、阅读取景、聚焦峰值、译文出现、数字退场、图解揭示及独立图层关键帧。使用全片实际编码帧格，分数镜头切点不会将上一镜头的帧当作下一镜头起点。每镜最多 24 点、全片最多 576 点；优先保留镜头首尾、阅读细节与聚焦峰值，明确报告未覆盖的候选数量，不声称连续语义检查。

绘制前编码路径观察全部实际 fillText（包括专用槽和独立文字图层），按最终变换计算文字边界，报告出框、390px 手机宽度下小于 12px 的字号及文字相交；每点最多 256 行文字、最多保存 400 项已去重问题，超过预算的问题观察另报计数；文字观察超过 256 行仅报告未覆盖数量，正常绘制继续，去重集合也保持有界。主要画面区域的 32×32 像素抽样连续八秒变化很少时提示检查节奏，不将稀疏抽样称为逐帧冻结检测。检查不修改草稿、不自动裁切或删字；截图内文字、图解语义、事实和遮挡仍需视觉复查。质量报告随已有技术验收 JSON 保存，技术 passed 不等于画面或事实通过。

字幕在预览、文字预检和原生导出中共用完整字幕块布局；左右安全区包含八个逻辑像素内边距，整块纵向限制在 720 高坐标的 56–686 区间。盒式背景只绘制一个包围全部字幕行的矩形，先背景后全部文字，避免逐行半透明背景重复叠加或盖到上一行字。关键状态观察同时记录变换后的字幕背景及绘制顺序，并区分字幕、署名、图解脚注、水印与计数器；报告背景相叠、背景盖字、背景与其他文字相交及超出字幕安全区域。背景观察每点同样最多 256 个，超额计入未覆盖数量。它仍是有界几何检查，不能替代实际成片视觉审阅；原生视频回归另核对手机取帧中两行及三行字幕背景的实际透明度连续性。

唯一 browser 内的 video.studio 新增 review-export：要求当前 Session 的 draftId、expectedRevision、sceneId，可选 reviewOffset（0–16）；仅接受与当前内容、素材、成片、验收文件签名一致的导出。旧成片没有画面记录时明确要求重新制作，不把当前预览冒充旧成片。按记录每次最多八点从实际 MP4 解码 PNG，最大 390×720，返回请求/实际解码时间、状态原因、原成片签名、每张 PNG SHA-256、下一页和抽样范围。Bridge 使用现有八图/20 MiB 图像准入，检查 Project 路径、PNG 与 SHA。取消、Project/owner/revision 或文件变化只清理本次新取帧，旧素材、草稿和成片保留。

Studio 审阅区新增“手机尺寸审阅当前镜头成片”，按 390px 宽显示实际取帧，可分页、定位草稿时间、停止取帧及查看问题；读取时复核图像哈希，切换 Project 或卸载释放对象 URL。此入口不写草稿，不生成新的模型循环。

review-export 返回 scene-page 质量范围，只携带本页样本和最多十二项当前镜头问题，nextOffset/totalSceneSamples 与 frames 置于紧凑结果内。qualitySummary 给出全片/镜头计数及原始完整 reportArtifactId；未显示的问题继续计入省略数量。完整技术/质量报告仍保存在 Project，不随分页返回重复全片数百条采样记录，避免文本预算截断分页和图像身份。图像 SHA、成片签名、撤销隔离和失败清理沿用同一验证。

审片进度另存于 Project 的 video-studio/export-reviews/<draftId>.json（Schema 2，兼容读取 1），不加入可编辑视频内容、不改变草稿 revision。每草稿最多保存八个成片指纹的记录，文件上限 2 MiB，拒绝 symlink、外来 Session、重复身份和非法字段。只由宿主成功取得当前 MP4 的实际关键状态 PNG 后记录样本索引、Artifact、SHA 与时间；取帧请求位于目标帧内部半帧处（末尾受成片时长限制），实际解码PTS与目标关键状态相差不得超过四分之一输出帧，偏到前一帧等情况整页拒绝并清理本次PNG，不记覆盖。返回目标seconds、实际请求requestedSeconds和解码actualSeconds，三者不混用；每帧另返回由Host videoTime生成的editTime（ticks及必要残差），可直接复制到编辑事务，不手工舍入分数帧残差；重叠分页不重复计数。review-status 要求当前 draftId/expectedRevision，复核当前导出、报告、素材及已保存 PNG 的实际指纹，分别返回技术报告状态、有界排版抽检结果、取帧完成度、Agent 声明与用户声明。生成图片不等于已视觉审阅；未记录的技术状态、模型意见和用户意见均不推定通过。模型回复按 pageOffset/pageLimit 分页镜头状态，scenePage.nextOffset 续读，意见只返回明确标识的预览和完整字元数；GUI 保留完整意见。

record-export-review 接受闭合 exportReview {exportFingerprint,scope:"scene"|"film",status:"passed"|"needs-fix",notes:1..600 字元}，镜头范围还需 sceneId，整片范围不能传 sceneId。归属、当前草稿版本、成片指纹、取帧和实际文件在写入前重新核对；作者来源仅由 Host actor 决定，模型不能声称用户已验收。Agent 声明某镜头通过前须已取得该镜头全部当前样本；整片 Agent 通过还要求每个当前镜头单独提交通过意见，不由镜头通过自动生成整片判断。PNG 缺失或被替换会使相关模型判断显示需重查。用户可以基于实际观看单独声明结果；每份新意见保存 Host 单调递增的 sequence，实际 createdAt 仍为墙钟时间，避免同毫秒或时钟回拨改变意见先后。整片通过后的任何同作者镜头意见都会使其整片意见需重查；镜头重新通过也不能恢复旧整片通过，须明确重新提交整片意见。旧 Schema 1 同时刻意见的先后不明时保守要求重查；只读不改写旧日志，下次宿主写入采用 2 并保留旧帧及意见，非法／重复 sequence 拒绝。用户界面提供镜头通过／需修改、整片需修改及整片通过，具体意见必填；整片通过另需明确勾选“已观看当前整片（包含声音）”；提交新的镜头意见或需修改意见后清除该确认，不能复用旧观看勾选。这些是各作者的声明，不代表自动语义、事实或听觉认证。

当前成片与上一份已记录成片按原生渲染版本、共同输出设置、实际素材身份、镜头内容与全片起始时钟比较，审片计划把变化镜头排在前面。新成片不继承旧帧、模型通过或用户通过，未变化镜头仍须进入当前输出的最终整片复查；计划始终说明 requiresFullFilmReview/reuseOldFrames=false。只读状态查询不建立日志；旧版本记录及原媒体保留。当前成片不存在或指纹失效时明确要求重制，不能把旧验收当作新版本完成。

## 当前范围与维护

通用 NLE、任意 Hyperframes HTML 导入、外部聊天控制、独立远控/移动端、签名安装器和自动升级未实现。核心不会从其他仓库加载运行时代码。自动测试使用临时 Profile、DSH Home 和 Workspace，不能证明真实钥匙串授权、外部服务可用性或全部模型视觉能力。

修改功能/权限/Schema 必须更新本文；新增、移动、删除测试运行 `npm run docs:features`。文末列表由源码生成并由 `npm run check:features` 验证。验证命令和证据边界见 [VERIFICATION.md](VERIFICATION.md)。

## 共享视频文档与编辑器兼容性

Video Studio 保存 format=bmw.video 的单份规范文档，按实际使用字段选择 schemaVersion 2.0–2.9。content 分为 settings、brief、story.scenes、timeline.regions/tracks/clips 与 cover；records 保留 Host 的媒体/语音来源与实测绑定、审阅/参考和导出日志。story 不保存镜头位置或时长，region 是全片顺序和时间权威；字幕 clip 使用 start/end，其余显式 clip 使用 start/duration。放置时间是 1000000 ticks/s，迁移残差最多 ±0.5 微秒，源媒体秒数与原始时钟完整保留，分数帧率和任意空隙/嵌套序列尚未开放。预览、导出和旧 read/update 使用受校验的无损 v1 投影，不持久化第二份草稿。

simple.cards/3 是高级模型的可逆子集，继续接受原 simple.cards/1 的内容；仅进入高级模式、主画面/旁白裁剪、固定效果等不永久锁定。任一独立叠加图层、独立音轨或自由关键帧要求高级编辑；隐藏/静音/锁定仍存在。compatibility 根据当前内容/版本返回对象、路径、原因。简洁写入同时校验当前和最终合并后的候选，不能用遗漏字段/空数组丢弃高级内容；返回卡片由 Host 校验当前 owner、selection/revision、dirty 和兼容性，UI 提示原因。撤销/移除这些对象后可恢复卡片资格；已保存的高级草稿在卡片视图只读，可从原入口进入高级。无自动有损降级。

唯一 browser 的 video.studio 提供 describe-schema、read-document、compatibility、validate-edit、apply-edit、migrate-document。类型命令包括 brief.set、scene.add/set/reorder，captions.set/translate、card.set/bind，clip.move/trim/split/effects/mute，layer.add/set/remove，固定 ID、类型和全片时钟；最多 32 条，一次 CAS 保存。brief.set 只修改受校验的 preparation 字段；scene.add 接受 id/title 与闭合内容字段，默认追加，可显式 afterSceneId 插入，不能写入旁白测量、哈希、生成记录或关联快照。scene.set 可修改脚本、字幕样式、引用、来源和显式时长；实际引用仍由宿主核对，音频与图解绑定保留原有失效规则。试算不写入，结构/原生支持、可逆性与实际渲染就绪分别判断；真实素材准入、翻译保护、源时钟/日志保留沿现有 Host 校验。Agent 不能自行声明高级权限，提交前重新核验可信当前高级界面与 Project。试算不证明媒体/排版或渲染成功，生成的新 ID 必须在 apply 后重读。

模型浏览器适配层把 create/read/草稿修改返回转换为有界摘要，保留草稿 ID、所属 Session、revision、输出设置、镜头清单、旁白待办和就绪问题计数；摘要不是可写完整草稿。GUI 与直接宿主服务仍读取完整投影。read-scene 要求 draftId/expectedRevision/sceneId，按 content/card/captions/speech/visuals/reviews/timeline/sources 返回所需字段；字幕、句锚、建议、时间轴与来源按 pageOffset/pageLimit 分页，卡片目标仅返回 kind/index/label 和关联选择，不重复宿主身份快照。read-preparation 按 notes/outline/artifacts/sources 分区，文字每页 4000 UTF16 单元，记录每页最多二十项；文字与记录的 nextOffset 各自按对应单位续读。describe-schema 对模型返回能力及命令索引，describe-edit 按 editOperation 返回一个命令契约；卡片具体 Schema 仍由 describe-template 提供。渲染回复保留实际 MP4、完整报告 Artifact 身份与有界质量计数；逐页实际成片审阅保持原有图片准入。read-document 对模型返回摘要并指向逐镜头 timeline 取得稳定 clip ID；试算不重复整份 canonical document。模型 list 分页且只携带本页草稿的证明与兼容性，ASR 读取分页保留置信/警告及时间域，长段落预览明确标记截断，原始证据仍可按 Artifact 读取。

assets 可传闭合 assetQuery {kind,query,includeReviewArtifacts,offset,limit}，默认二十、最多五十项，遍历全部合法文件名后筛选和分页，不在筛选前截取前一千项。默认排除匹配原生审片 PNG／视频报告命名的文件；它是文件名分组，不冒充素材语义或来源认证。目录和条目拒绝 symlink；GUI 未指定 query 的完整服务清单也遍历全部合法素材，确保大量审片帧不会挤掉当前 MP4、验收报告及画面／旁白引用，不能以目录前一千项代替完整 GUI 清单。模型默认使用筛选分页。read-material 按实际 Artifact ID 查找 Project 文本，不受旧列表前一千项限制；模型只收到有明确截断状态的四千字元预览页。网页原文使用 source/list 获取来源与获取记录 ID，再 source/read；模型可选择 text/candidates/media 分区，原文返回精确 UTF16 偏移及至多32个、每块至多160 UTF16单元的quoteSpans；块不拆代理对，边界精确保留，模型可直接复制区间与原文而不估算长度，分块不认证主张。候选确认与已获取媒体的当前文件/证明核验结果分开。source 摘要与原文读取保留发布日期、明确声明的事件日期及其来源、采集日期和访问限制；未知日期保持 null，不能把采集日期推定为发布时间。原文读取另保留访问说明与错误，不因正文分页丢失预览/登录限制。source 文本不作为 Agent 指令，不能用 sources 中的原文文件名冒充 artifacts 中的文字素材。

字幕布局修正后提升原生导出指纹的渲染版本，旧版排版成片不再作为当前内容可复用的已完成输出；原文件及历史记录保留，需要以新渲染路径重新导出才能验收新效果。

旧 v1 只读加载不改文件；首个成功编辑或显式 migrate-document 才升级，迁移前把原字节按 SHA-256 保存到 Project video-studio/schema-backups。迁移不改内容版本或媒体/成片；所有字段反向投影不同、超限或无法表达时拒绝写入。固定 owner、同版校验、原子文件替换、私有备份和签名历史保持。

[Video Document 2.0](VIDEO_DOCUMENT_V2.md) 说明实际字段、能力预算及迁移，[Agent 视频接口](AGENT_VIDEO_EDITING.md) 给出调用约定。机器 Schema 与示例由运行时类型编码器生成并纳入 npm run check；video.schema 覆盖迁移/闭包/字段完整性/权限，studio.schema 覆盖真实鼠标对象创建、UI/IPC 返回限制、陈旧版本、签名撤销、试算和原生 MP4。专用 AI 素材生成继续暂缓。

## 模块接口与测试分类

模块定义与依赖方向见 [ARCHITECTURE.md](ARCHITECTURE.md)。十个产品包、应用组装和验证工具拥有明确职责，跨模块仅能依赖 package exports 指定的公开文件。Feature 生命周期、Browser 宿主与原生媒体端口有具名 TypeScript 接口；未知跨进程输入与媒体回复仍须运行时校验。公开接口有正反类型消费者、运行时契约测试和对应回归保障。

Browser 与 AgentDriver 的直接保障不依赖具体 DSH 实现；通用 driver 夹具从 Platform 注入的连接配置出发，经 MCP 适配器和 Bridge 实际操作 Project 页面，并验证权限、绑定及切换后恢复。DSH 的安装版兼容性与持久化绑定验证单列为具体实现/产品装配保障，按 Agent 契约、DSH 实现和产品组装范围选择；Browser 模型接口（Schema、目录、Bridge、MCP）单独改动不会自动启动 DSH。完整离线基线仍执行 DSH。

测试分为 unit、contract、boundary、type、integration、desktop、media、external。`test:plan` 给出选择依据，`test:affected` 根据文件依赖、行为 watch 和接口矩阵执行受影响保障；任何源代码改动保留全局边界。共享验证辅助库的改动自动沿导入/重导出闭包选择所有运行时消费入口；生产模块仍使用接口/行为范围。未知/删除路径、共享配置及验证代码中无法证明的动态导入升级为完整离线集。生产代码不得依赖测试目录或验证工具；Renderer 禁止裸名称或 node: 前缀的 Node 内建模块。生产计算式导入默认拒绝，仅 DSH 插件允许解析声明的固定安装包字面量，不允许新增任意计算式导入。测试未分类、接口保障缺失或生成文档过期直接失败。新构建的源码/输出哈希收据防止使用过期 JS，只有完整离线集通过才更新验证基线。

固定中文 ASR 资源准备、原始证据和可编辑锚点的当前行为见上文“原生中文语音证据运行端口”；用户核听采用记录和仍关闭的自动精度门见 [VERIFICATION.md](VERIFICATION.md#user-listened-whisper-base-adoption)。

画布独立视觉对象的选择边框和拖动/缩放手柄是 GUI 覆盖层，不写入视频像素。点击和手势按实际 object-fit 留白后的画幅映射；镜头局部/全片对象保持原身份、时间和来源。变换对原有各关键帧应用相同位移/尺寸比例并以所有帧边界限制；不暗中生成动画、不改变 easing。一次拖动对应一次版本校验保存与撤销，指针取消/失焦恢复反馈；锁定、保存中和待处理属性输入阻止变换。拖动期间复用已准备的素材、音频与共享导出绘制器，合并指针事件为单个进行中绘制和最新几何，不为每个事件重新解码素材或建立音频上下文。临时覆盖仅允许同一已准备草稿/镜头/对象的几何变化，不能改来源、时间、文字或关键帧时钟；松手前不写草稿。Esc、指针取消、失焦和切换模式恢复原画面；切换/销毁在释放素材前排空临时绘制，避免迟到帧污染新预览。高级低频操作进入“更多”，复用并移动原 DOM 控件，返回卡片恢复原父节点；重复分镜条隐藏，由时间轴保留镜头导航。

点击画布无独立对象的区域选中全片设置，清除对象选择，发布整片范围并暂停预览。全片参数复用同一 `VideoOptionsForm`、模板及应用控件，临时移动到属性区；原设置对话框打开时移回，关闭后恢复，始终只有一份控件和参数。声音、品牌水印与模板按需展开。待应用参数不会在普通 render 或外部更新中重置；视图/会话切换前通过 configure/CAS 保存，一步撤销，失败保留输入和原视图，明确确认重载后才丢弃。无高级对象的草稿可往返并恢复全片选择；含独立对象时保存待编辑参数，但返回卡片被兼容性约束拒绝，保留高级选择。

预览完成不得覆盖主轨、独立对象或其他待保存字段的外部更新/冲突提示。实际预览准备完成只更新预览状态；存在待编辑输入时保留当前保存提示，避免把未提交或版本已变化的输入称为“草稿已保存”。主轨保存仍使用捕获的 Project/draft/revision 和原 CAS，不自动重放到新版本。

### 独立对象分割后的原淡入淡出

图层和独立音轨新增可选封闭 fadeWindow {originId,startSeconds,durationSeconds}，原时间范围0–720秒、长度至少0.1秒、当前片段须完全落在原范围内。分割/修剪保留原淡入淡出秒数，在原效果时钟上取样；短片段不重启/压缩效果。已有无窗口对象沿用原行为。视觉透明度和流式音频增益共用 layerFadeGain，关键帧仍独立保留原限制曲线。生成的曲线子域端点只在原合法端点内消除浮点舍入，用户输入验证不放宽。

同源、同原效果身份/时间、相邻播放/源区间且速度、音量、静音、旁白避让和淡入淡出一致的音频切片复用一次连续解码，避免 AAC 片段处重复引入解码起始差异；独立修改任一策略会分开处理。对象身份与持久切片保留，不压平轨道。原素材不改写。

所选对象的折叠淡入淡出属性标注「保留原曲线」，原秒数只读；明确「按当前片段重设淡入淡出」才移除窗口并将秒数限制到当前片段。操作保留媒体、几何和关键帧，用原 CAS 保存/撤销。淡入淡出/清除动画预设明确重设效果，单纯编辑文本/位置/音量不重设。超出原窗口的时长编辑拒绝并保留输入。此项不代表整镜头分割、全部效果、参考生成素材或逐项审阅已经完成。

### 原声字幕随主画面重新映射

SourceCaptionBinding 增加可选封闭 sourceCues、sourceRange 与 visualSegmentId；sourceCues 最多 100 条、源时间 0–1800 秒、原文/译文各最多 200 字，区间排序不重叠，sourceRange 必須同时提供并包含所有核对区间。新的 apply-source-captions 保存用户核对的完整原声 cue 及实际原文件范围，并对已存在稳定 ID 的连续源组保存准确片段身份。旧数据不自动获取全源审核资格：首次映射只能保留当时可见的源范围，越界须重新应用。字幕/原素材/证据文件不重写。

主画面移动、修剪、源起点/速度和前置片段变化，经同一源组重新投影字幕，无旁白 .5 秒偏移。保留当前人工正文、译文及来源标记，镜头边界截断不猜测词级时标；根 cue 中未播放的核对部分仍保存，再次扩展可恢复。单独字幕正文/时间编辑同步回源 cue；宿主翻译操作同样保留根记录。直接提交不能伪造 sourceCues/sourceRange、人工来源、SHA 或稳定目标，宿主只使用原可信记录。稳定片段被删除或换成另一 ID 时不自动采用同名文件；普通编辑删除稳定 ID 后不能采用同名无 ID 画面；恢复原无 ID 的旧状态必须通过宿主已确认的完整历史快照。未分段画面没有画面片段 ID，镜头 ID 不被借用为字幕目标。

画面时间与字幕正文同时变化且既非原字幕也非确定的新投影时，返回 STUDIO_SOURCE_REBIND_CONFLICT 并不写新版本。超出核对范围返回 STUDIO_SOURCE_CUES_REQUIRED；有独立时间区间的旧字幕不会被默认为全源字幕。源 SHA 校验、Project/Session 归属、CAS、FIFO、取消、原语音锚点和单 browser 边界保持。生成的投影时间在真实镜头/片段范围内消除浮点终点越界；外部输入验证不放宽。所选主画面属性提供简短说明，错误保留当前输入。

这项完成当前原声字幕的复杂源时间重映射，为整镜头分割提供基础；整镜头内容/旁白句锚点拆分、剩余有限效果、参考/生成素材、逐项实验审阅与完整制作/压力验收仍属于原设计待办。

时间轴主轨编辑在保存后继续持有操作，直到选择恢复及真实预览准备完成，才重新开放分割与播放头；连续操作不会读取上一次的左侧选择。当前原生事务专项和完整前台鼠标回归分别记录，后者仍需解锁桌面后原样补验。


### 宿主已确认的历史恢复

list 为同 Project/Session 的每个当前草稿内容返回 snapshotProof。当前进程的服务使用私有随机密钥，对规范化编辑内容及 Project/Session 作 HMAC；版本/更新时间和导出记录不属于可恢复内容。restore 封闭请求必须提供 draftId、当前 expectedRevision、完整原草稿及 64 位十六进制证明。内容、审核来源、素材、owner 或其他字段不同均拒绝；另一服务实例、新进程或外来 Project/Session 不可采用。签名不验证素材当下的真实性，不替代消费前的 SHA、锚点、编码及媒体检查。

现有撤销/重做在捕获已保存、内容相同的快照时记录此证明，恢复被删除镜头时可保持宿主已确认的句锚点、原声识别/根 cue、人工译文和音频测量。restore 保留最新视频/封面导出记录，使用原 CAS 和新版本写入，并继续 owner/FIFO/取消边界。没有证明的未保存历史仍走普通更新；无效证明不会回退为普通更新或重放，输入/错误保留。无新增用户按钮、模型循环、工具、路径、磁盘历史或生产数据迁移；证明随宿主服务生命周期失效。该基础用于整镜头分割，新分割及完整工作流仍按原设计推进。

Studio stop 先关闭新的 IPC/打开准入，再关闭所有 View 并等待已打开或正在打开的素材句柄完成关闭；停止后不重新打开 Studio，排队中的旧素材读取不得新建句柄。

### 原始镜头时钟与明确静音

共享合成支持有限 presentationWindow：originId 为 1–80 个字母／数字／连字符，startSeconds 为 0–60 秒，durationSeconds 为原镜头 1–60 秒，musicIndex、sceneNumber、sceneCount 为 1–96 的整数（文档2.0–2.5仍限24）；子段必须完全在原镜头范围内，sceneNumber 不超过 sceneCount。标题入场、要点出现时间、画面编号／进度和自动配乐使用原镜头时钟，字幕、媒体与独立对象仍使用各自局部时钟。bulletRevealSeconds 在原镜头范围内验证。原始时钟未提供时保持旧合成行为。Studio 普通 update 从同一镜头保留宿主已有 presentationWindow，不接受用户／Agent 原始请求创建或重设宿主来源；超过原时钟的延长明确拒绝，签名历史恢复继续沿用原版本／归属校验。

voiceSegments 可以明确为空数组，含义是此段不播放旁白；缺少该字段仍沿用旧完整旁白行为。空数组保留原音频与脚本绑定，声音／自动字幕投影为空，独立人工字幕保留，主轨不会选择不存在的第一个旁白段。旁白时长计算对空集合保持有限值。原生导出回执报告实测原音频总长（至多 180 秒），宿主验证实际播放窗口是否在源文件与镜头范围内；不能再用原音频总长代替播放长度。无旁白镜头仅接受零音频时长，缺失／伪造／越界回执拒绝。

这些共享媒体基础现已用于下面的有限整镜头分割；句锚点／句聚焦／板书与已核对原声字幕的整镜头分配现已接入下节的可信原始播放投影。

### 有限整镜头分割

既有 video.studio 新增封闭 split-scene 操作，只接收 operation、draftId、expectedRevision、sceneId、splitSeconds；切点是镜头局部 1–59 秒，两侧各至少 1 秒，最多二十四镜头。不能附带原始草稿／历史证明／外部路径。宿主按同一 owner、CAS、FIFO 和取消准入一次写入，失败不改变原 JSON；成功 revision 加一并发出一次通知，保留现有视频／封面输出日志。

画面按交集直接分配到两侧，不创建临时第九片段；左／完整右片段保留身份，跨切点右片段获新身份。视频源起点按原速度前移，原 focus、zoom 和 effectWindow 的来源时钟保持。完整旁白脚本／原音频／实测总长／生成绑定不改写，有限 voiceSegments 分配原播放区间；没有旁白的子段明确为静音。独立字幕在切点裁剪时间，原文、人工译文与来源保持完整，不猜测字词对应位置。局部图层／音轨分配同一源时间、锁定状态、淡入淡出来源和严格裁剪的关键帧曲线；全片图层／音轨逐字段不变。所有原镜头在首次分割时固定 presentationWindow，后续标题／编号／进度／音乐不重启。原声视频的相邻同来源 effectWindow 区间跨镜头共同解码；同名文件或有间隙、速度／音量变化不能合并。

时间轴沿用同一个分割入口，选择整镜头时标为「分割整镜头」，选择具体画面／旁白／字幕／独立对象时对应原有操作。保存、右续段选择、原播放头恢复和真实预览准备持有同一编辑事务；成功后才进入 Undo 历史，CAS 失败不造历史／脏草稿。签名 Undo/Redo 保留原始时钟和身份；撤销删除所选续段时清除过期 GUI 选择。卡片续段说明保留完整脚本并复用原旁白区间。宿主重新生成／导入不同旁白时可重建该镜头的原始时钟，普通 update 不能伪造重设。

句锚点／句聚焦／要点与已核对原声字幕现可按下面的可信来源时钟进行整镜头分割，原证据与来源保持；不能把分割视为新的听审或源字幕确认。已有局部／全片越界对象、切点产生不足 0.1 秒的画面／旁白／图层、已测量视频末帧停留区域、总对象超六十四或关键帧超十二都原子拒绝，不裁掉未处理内容。任意复杂编辑后的绑定恢复仍需明确处理；已有基础效果、参考抽样、逐项审阅和制作恢复分别遵守下文契约，不自动扩展权限。

### 整镜头的可信语音与原声字幕分配

Studio 私有 speechPlaybackOrigin 仅由宿主分割／明确句校正派生，包含原镜头 presentationWindow 范围内零至八个完整 voiceSegments 和至多 2000 字符的当前播放 clock；clock 包含源音频身份、实测时长和有限播放窗口，连续且同速度的源／播放片段合并，时间按微秒规范化，片段 ID 与对象键顺序不改变时钟。原句锚点、脚本／音频 SHA、校正来源、时间域和 capturedRevision 原样保留。普通 update 从同一音频保留宿主原时钟，不能提交新的／改写原时钟；合法省略原音频字段在验证来源前恢复原绑定，明确移除或绑定不同音频解除该时钟。该私有字段在共享媒体合成前剥离，不扩展模型执行边界。

分割保留整句原文。自动锚点字幕按子段的实际旁白区间裁剪显示且保持动态投影；静音子段为空。句聚焦以原始完整句区间投影到每个画面来源时钟，不在切点压缩／重启曲线；画面引用只分配到原画面实际出现的子段并重映射下标，素材身份、裁切与独立焦点冲突检查继续执行。无素材标题卡的板书揭示直接保留原时钟值，即使子段静音或揭示已发生，不相减再相加制造浮点边界变化。播放窗口发生实际变化时，消耗原引用拒绝；通过现有 correct-speech 明确校正可按当前有限播放重建来源投影，未改播放时钟的校正不重启原曲线。没有自动听审／词级时间／新的 ASR 认可。

原声字幕由宿主将已核对 sourceCues／sourceRange 和原文件 SHA 分配到仍包含原稳定画面组的子段，保留隐藏已核对 cue、全文、人工译文和校正来源，不扩展核对区间。丢失原画面组的子段解除该原声元数据，只保留独立字幕；识别候选随原素材实际成员重映射，不采用同名无来源片段。组外独立字幕按切点裁剪；跨越组边界的含糊独立字幕、过期身份／时钟、超核对范围、交叠／超预算仍原子拒绝。整镜头服务在分配前重查实际语音／原声文件 SHA，异步读取期间取消或并发更新不写入；保存前继续同一 owner／CAS／FIFO。签名 Undo／Redo 与卡片／高级模式使用同一规范草稿，保留这些可信记录。

这一实现仅覆盖当前可信来源契约内的整镜头绑定分配。任意复杂重绑定、效果扩展与完整用户体验验收不由本实现保证；参考抽样与有限逐项审阅见下文，AI 生成暂缓。

## 制作取消、清理与明确续做

统一「生成视频／制作更新／导出视频」仍沿用一次确认与既有原生旁白、编码。取消按钮在命令执行时可用；请求取消后变为不可重复点击的「正在停止…」，作业状态明确「正在停止并清理…」，实际命令／资源尚未排空时仍不开放编辑或下一命令。取消回执的迟到文字只作用于同一命令代次，不能覆盖已经结束或后来新命令的状态。停止不抹除已逐镜提交的旁白，也不抹除历史成片。

制作停止／失败后从所属草稿重新读取已提交状态，说明尚待制作的旁白段数和「再次确认制作」的恢复方式；不自动重发、不自动续做。用户再次确认后跳过仍有效的旁白，再完成检查和完整 MP4。取消显示「制作已停止」，失败显示「制作未完成」；用户提示去除 Electron IPC 外壳，保留实际失败原因。并发改稿按现有 revision 拒绝旧结果，人工字幕与译文保持独立。

隔离 Studio 原生专项 `BMW_STUDIO_PRODUCTION_RECOVERY_CASE=1` 已验证第三段 provider 失败、第二段处理中取消／并发改稿、实际编码完成而尚未入库时取消／并发改稿五种路径。取消期间另一 IPC 命令拒绝，清理完成前制作按钮保持禁用；初始有效旁白及第一段新旁白保留，原 MP4 字节／日志不变。后两项实际新编码及验证文件在未提交时回滚。明确重试只生成剩余／重新变过脚本的旁白，获得新增的可解码 H264／AAC MP4，不覆盖旧结果。声音来源是已测量合成 WAV 夹具，控制门限用于确定原生提交边界；不证明真实 TTS 网络／付费效果、编码进行中所有取消点、生产 Profile 或完整前台鼠标验收。

## 可选逐项审阅（测试功能）

“检查与导出”里的审阅区默认折叠。让 Assistant 提出建议沿用当前所属对话与官方运行时，不增加模型循环或工具；本地文字检查和关键帧仍可独立使用。新建议通过唯一 browser 的 video.studio propose-review 提交，需当前 draftId/expectedRevision 和闭合 reviewProposal：sceneId、field（title/narration/visualBrief/captionStyle/captionDisplay）、精确 before、after、reason、镜头内 seconds。宿主核对镜头、原值、时间、归属与 CAS，生成 ID、作者来源、原 revision 与日期；建议只是作者提供的依据，不代表事实核查。每草稿最多四十条记录，字段/文本/时间有界；未知字段与通用补丁拒绝。

reviewItems 是宿主所有的持久审阅日志，不计入视频内容比较。普通 update、签名 restore 保留当前日志，不能伪造、覆盖或清除建议；日志更新保留已准备预览和当前版本关键帧。read/list 返回记录，所属视图自动刷新建议；用户可以展开修改前后内容，定位到对应镜头和全片时间。Agent 的专用审阅操作只能提出建议；adopt-review/dismiss-review/undo-review 需要 GUI user 身份、当前 revision 与 reviewId。采纳只改一个字段，撤销只恢复该字段；原值/新值与当前字段不同、镜头删除、旧版本、已处理状态均拒绝，保留当前内容。忽略可处理陈旧的待处理建议，视频不变。采纳与状态在同一原子草稿写入提交，期间其他修改、人工双语字幕、原音频和当前导出日志保留。旁白脚本变更使旧音频待更新，不自动生成旁白或 MP4；撤销恢复原脚本后按现有实测绑定判断有效性。

文本建议的 before/after 使用字符串；captionStyle 使用完整六字段样式或 null，captionDisplay 使用 original/translation/bilingual 或 null，null 表示未设置。采纳与撤销核对原字段和定位时间，保留字幕内容、时间、来源及原旁白。只显示译文要求已有译文。未设置字段撤销恢复未设置。此项不接受任意补丁或 CSS，不保证 Agent 建议质量；实际画面依据仍需人工核对。

## 参考素材分析与制作背景

参考分析进入原有图片/视频素材预览的上下文入口，不增加常驻阶段按钮或第二个聊天输入。先“生成参考帧”，再“让 Assistant 分析参考 ↗”；结果在原素材列表显示就绪标记，重新打开可看实际 PNG、源时间、分析与将加入的文字。点帧可在原素材预览定位实际源时间。内容分析需要当前官方 Agent 运行时，宿主只准备图片证据和路由原会话，不自行执行模型循环。

唯一 browser 的 video.studio 增加封闭 prepare-reference/read-reference/set-reference-analysis/apply-reference-notes。draftId/expectedRevision、Project/Session、当前素材种类/身份均校验；prepare-reference 可为视频指定一至八个不同有限源秒数，默认在实际视频轨范围抽三点；图片仅静态一帧。media.inspect 的视频轨 now 返回 startSeconds/endSeconds，按真实轨道起止采样，不把音频尾部导致的总媒体时长当成视频终点；其他检查和音轨字段保留。图片先实际检查解码后产生 640×360 原生适配 PNG，视频通过已有原生取帧产生不超过 640×360 的 PNG。记录保存源 ID/SHA/字节数/尺寸、总媒体时长/实际视频区间、请求与实际帧时间、帧 ID/SHA/尺寸、原版本/日期。源预算 256 MiB、单源 16 Mp，静态图片同时服从原图片 32 MiB 预算；视频不超过 1800 秒，最多32份历史记录及8个artifact/SHA源组，每份一至八帧。

referenceRecords 是宿主所有日志，排除于视频内容比较；普通 update 与签名 restore 保留最新记录，不能伪造或清空。读取/保存分析/明确加入背景前核对当前源和所有帧 SHA，读取帧后再次核对源。Bridge 把这些返回作为真实模型 PNG 图像，沿用实际 Project 路径、PNG、数量/总字节预算与取消检查，并对将返回的实际字节再次核对记录 SHA。frames 路径是宿主结果，不向模型开放任意本地文件读写。

分析是作者提供的 summary 与实际采样 frameIndex 的 description/adaptation，文本、数量及字段封闭；不能伪装未采样画面或整段视频/音轨已审阅。analysisOrigin 区分 user/agent，Agent 不覆盖用户校正。用户“加入制作背景”要求当前 beforeNotes 与 CAS，仅追加可预览的参考块；不自动改脚本、重配音或导出。原保存/签名撤销重做保留参考日志、期间的媒体、手工字幕和导出记录。

原生输出仅在来源再次核对和当前归属/CAS 成功后提交。取消/冲突/验证失败只删除本次新建、身份相符的帧，不删旧资源；等待真实清理完成才重新准入。取消反馈说明已保存成果保留；源/帧变化显示重新生成参考帧的说明。原会话委托失败，即使弹窗已经关闭，也向仍属原视频的状态区报告恢复方式，不自动重发。宿主诊断仍保留原错误，不把 Electron 包装或错误码直接展示为恢复文案。

当前为有限抽样参考分析；尚无自动全视频分段/节奏/音轨分析、语义真值保证或实际 AI 图片/视频生成工作流。达到32份历史记录或8个源组上限时禁止超额取帧；不自动删除历史或改建草稿，用户仍可显式管理参考记录；旧参考图片与原媒体保留。完整视频语义分析、复杂引用恢复与完整用户体验仍未获该抽样验证证明；后续 UI 优化已暂停。

## 卡片内画面与脚本配对

默认卡片编辑把所选镜头的原 canonical script-current 编辑器与画面缩略图、画面意图放在同一张卡片；其他镜头显示完整脚本文字。卡片按自身可用宽度排列：350px 以上左右配对，较窄时上下排列，避免全窗断点和侧栏变化造成截断。长画面意图超过 120 字时用按需展开保留全文；没有省略保存内容。当前镜头提供“编辑卡片”“换画面”“声音与字幕”三项常驻编辑入口，镜头菜单、素材/声音详情和高级编辑共用原草稿、编辑器与 revision/history，不新增脚本副本或聊天框。

实际编译组件、生产 HTML/CSS 与原生参考 PNG 已在 headless Chromium 通过 24 镜头长中文、1200/900/700/620/420 五种窗口宽度、完整文字、无横向溢出和 canonical DOM 身份检查。解锁后完整新增原生 case 已通过五种宽度、固定预览、详情返回、保存冲突保留输入、高级/卡片往返、1.25 秒播放头、手工字幕/独立对象/音频与签名撤销重做（早期测试记录）；当前独立对象返卡片由共享 schema 拒绝，原生回归检查原因提示和撤销恢复；旧 MP4 指纹和独立旧草稿保持。组件检查与实际 DOM/IPC/Canvas 原生检查分别记录；它们不能替代前台鼠标与用户验收。

## 参考记录的额度恢复

现有参考素材弹窗增加默认折叠的“管理参考记录 · n/8”，显示当前草稿全部记录的素材、日期、帧数与分析状态；同一素材的记录可切换查看，仍经原 SHA 核对后才能使用。用户可明确移除单份记录并释放一个取帧名额；移除仅变更宿主 referenceRecords 日志，保留全部 Project 源文件/参考 PNG、已加入制作背景的文字、脚本/字幕/图层和导出。操作中禁用管理按钮；移除当前记录后清空其画廊与分析，不能继续用已移除记录委托 Assistant，其他记录可明确重新读取。没有新增常驻工作台按钮或聊天入口。

remove-reference 是封闭请求，必须包含 draftId/expectedRevision/referenceId，只允许可信 GUI user actor，Agent 调用拒绝。沿用 owner/CAS/取消/FIFO；只操作元数据，不读取已过期或丢失的源/帧，因此这些记录仍可恢复额度。未知 ID、错误归属、版本冲突或取消不写入、不发送变更通知。读取失败后当前记录提供明确“重新读取”，仍核对最新源/帧，不自动恢复就绪或重发任务。普通 update/签名内容 Undo 不恢复已移除的宿主日志；界面明确说明内容撤销不恢复参考记录，可重新取帧，原图片仍可作为 Project 素材使用。

真实宿主单元契约覆盖32份记录满额及8个源组、用户专属移除、错误归属/CAS/取消、失效源/帧仍可移除、媒体与背景/脚本/导出保全、内容历史不复活旧记录及重新取帧预算。实际组件与服务回调的交互证据另见 VERIFICATION；不等同于 Electron 原生/前台、付费模型或生成服务验收。完整视频语义分析尚未实现，分析质量需人工核对，专用 AI 图片／视频生成暂缓。

## 两种编辑视图共用精简操作栏

卡片与高级模式共用原有顶栏控件：视频名称、保存状态、撤销/重做、目标与素材、视图切换与单一交付入口。作品切换、新建/删除、视频设置、重载、手动保存和返回浏览器移入同一“更多”菜单，不复制字段或事件；点击菜单外或 Escape 收起。尚未创建／选中草稿时目标与素材禁用；零分镜草稿仍可准备素材。错误后的明确重载仍可从菜单进入。

含局部/全片图层或独立音轨、多个画面片段或焦点区间的卡片显示一条“含高级编辑”上下文入口，选择同一镜头后沿已有保存/CAS/模式切换进入高级编辑；不扁平化、不新建草稿。卡片按 Project/Session/草稿在当前页面记忆滚动位置，最多保留十六份；长画面意图的展开状态在同一草稿渲染和模式往返中保留。卡片容器关闭浏览器自动滚动锚定，仅在卡片视图记录位置，避免高级布局重排污染原位置。上述 UI 不增加模型工具、网络调用或媒体模型。

## 空草稿到卡片初稿与竖屏交付

简单模式在空草稿的素材/背景区显示原有“让 Assistant 生成卡片初稿”委托入口，沿原所属 Session 与 script intent，不增加聊天框或模型循环；背景可空。大纲保持原字段，在默认折叠区按需阅读与修改。已有分镜时同一委托变为完善脚本，保留原提示词的用户内容保护。

同一草稿从零分镜收到后台初稿，且页面没有待保存输入时，简单视图进入镜头卡片与草稿预览，并关闭原准备资料详情。待保存输入存在时继续保留文字和当前页面，明确重新加载后才接收外部版本并打开卡片。Project/Session/版本准入、结果通知和 unknown 不重发沿原规则；视图切换不写草稿内容。

卡片预览按当前区域高度适配横/竖画幅，播放和定位控件始终留在预览区，不随卡片滚动，也不要求滚动竖屏画面后才能播放。交付计划只显示待更新旁白数量和制作影响，完整镜头名单保留在默认折叠区；有效旧成片复用时不显示待更新名单。可选测试审阅默认折叠，不成为导出门槛。

预览准备期间，主轨对象选择／手势、时间轴分割与播放/定位控件一同禁用；真实准备完成后按当前编辑状态恢复。对象选择及分割后保存／选择／预览使用同一事务，操作前捕获逻辑播放头并在选择时显式恢复，不从重建期间的临时零值重新取时；检查等待事务完成，避免把选择回执当作预览完成。


### Project 素材索引与区间语音检索

全片转写增加 materials 的 transcribe-source/source-batch-status/recover-source-batch 三个封闭子操作；精确帮助支持 forOperation:materials + forSubOperation。先通过 media.preserve 完整归档，再以 Project artifactId/current index revision 开始；默认 base/auto，显式支持 small、zh/en。每批至多32个固定900秒原生 packet-copy 工作段，每次至多8段、18分钟预算；原件至多6小时／4GiB，仅元数据检查使用归档预算，单段仍遵守30分钟解码限制。分段记录原件SHA、区间、实际起点偏移、输出SHA和证明；每段按既有180秒原生ASR、至多十块／10分钟索引任务处理，逐块CAS保留进度。

Material index version1 新增可选 sourceBatches（Project最多8批），每批有所属Session、独立revision、固定源/模型/语言、单元、pending/complete/interrupted及inFlight。先保存inFlight再执行原生操作；正常取消等待真实清理，保留已提交段／ASR证据，不自动重放。遗留inFlight标为uncertain，需原生无活动／隔离后显式recover；recover本身不重做，清理未知或仍忙拒绝。显式续做重新核原件、工作段／时间映射和原始ASR证据哈希，只处理未完成块；源／模型／语言改变拒绝绑定旧批。状态只报告保存范围，不重新认证文件；续做实际重核。处理范围映射回原片时钟，返回缺口及零识别范围；complete表示全片处理覆盖，不认证逐字准确、静音、全片观看或人工听审。原始转写仍通过现有索引／search按本地文件时钟读取，并使用单元offset映射，尚未新增合并全文导出。

原生语音归一化区分 SPEECH_DECODE_CLOCK/FORMAT/BUDGET 错误。仅首个AAC缓冲可在一个1024采样编码帧及两采样容差内跨源零点，须实际跨零、长度有界；丢弃负时间PCM，保留源时钟，并记录可选discardedHeadFrames（输入采样帧数，至多1026）。后续逆序／重叠、其他codec负时钟、过量前滚继续拒绝；不通过跳过首0.1秒或放开时钟检查回避错误。隔离复制的既有失败GTC段已实际验证0–180秒完整输出2880000个16kHz样本、丢弃784个负时间输入采样帧；这不是重新跑完全片或人工听感通过。

完成的合法 ASR 区间允许零识别段，仍保存归一化PCM、原始JSON、日志及SHA，不补造文字。素材索引以 `segmentCount:0` 保存已处理范围，返回 `no-speech-detected` 和 `unrecognizedRanges`；这只表示本次ASR没有返回讲话段，不认证静音或没有讲话，也不能当作已准确转写。已完成空结果不自动重放，人工核听和必要的显式重新识别另记。

`materials` 是现有 `video.studio` 内的封闭操作；list/index/set-metadata/search 使用 Project 素材 ID 与独立索引 revision。索引保存源 SHA、实际媒体尺寸/时长/音频终点、至多三张实测缩略图、人工或 Agent 编写的标题/说明/标签、原始 ASR 区间证据，以及当前会话可见草稿的使用关系。来源标题/URL 来自现有 Project 来源清单，仅表示记录关系；不做来源事实认证或视觉语义搜索。GUI 从“更多”打开索引、编辑说明、搜索并在原时间区间试听；未保存输入通过工作区已有 flush/离开保护保存。

每个 Project 最多 200 件、索引 JSON 至多 4 MiB、每件最多十段互不重叠的语音区间。源文件至多 1800 秒；单次 ASR 归一化区间至多 180 秒，原始 ASR 保持 normalized-interval-seconds，检索结果只加实测源起点，明确标为 source-file-seconds。单次索引至多十段，识别循环十分钟预算，媒体检查另沿各原生 worker 的限额，下一段开始前保留一分钟；每段完成以 CAS 单独提交，已完成进度保留，取消或失败只清理当前未提交产物，不隐式重试。完整音轨调用仍保持 180 秒限制。搜索每页 1–50 项，续页必须携带索引 revision，源读取累计至多 512 MiB、语音证据至多 16 MiB。源/证据 SHA 变化、符号链接、损坏索引、并发说明编辑均拒绝覆盖；原始证据和原文件保留。自动词级精度、可用性和时间批准门仍关闭。

### 原声转解说与单镜头本地配音恢复

`validate-source-narration` 试算已有单段视频与当前有效中文旁白的配方，`apply-source-narration` 按 owner/revision 提交：先保留 0.1–20 秒视频原声，在连续原画面的切换点播放实测旁白，后段关闭原声；原声/旁白增益各 0–2。可按旁白长度调整镜头，只有明确 allowEndHold 才允许后段末帧停留；原声前段必须有真实画面。已有分段、复杂语音布局、按句焦点拒绝自动整理；独立对象存在时自动调整时长拒绝，固定镜头长度仍校验轨道。字幕可保留独立字幕，或明确把核听原声前段与已编辑句锚点/显式估算的旁白字幕合为独立双语字幕；原声关联快照、源/旁白 SHA、采用者与时间依据保存在 Project JSON 回执，估算不等于已核听。GUI 从“更多”进入，先显示当前配方检查结果，再应用，支持一次撤销/重做。

`narrate-local` 是明确的单镜头恢复操作：当前镜头保存 local-matcha 的 narrationOptions，其他镜头音频与全片 TTS 保持原选择。常规/批量配音消费镜头覆盖或全片默认；没有失败后的隐式切换。镜头覆盖使用文档 2.3，原文档内容不含新字段时仍输出原支持版本。旁白完成后发生 GUI revision/Project 冲突或取消，不认领新音频，只删除本次新产物，保留旧文件和新编辑。固定本地资源、禁网络、实际 worker 清理与既有旁白预算保持有效。

### 录屏段落建议与保留上下文的放大镜

新录屏事件侧车保存实际 WebM SHA；旧侧车可读取但标为 legacy-unverified，不能获得原始绑定认证。完成录屏会重新检查容器，usability 回执给出实际视频起止、尺寸、容器时长、音轨有无、停止原因与部分录制状态；inspected-unreviewed 不证明帧内容、操作结果或声音质量。视频元素自身停止时记录实际 currentTime，并区分 ended 与 unexpected-stop，不能返回虚构的零源终点。

`suggest-recording-plan` 基于 measured-frame 的点击/滚动/导航事件，最多展开三个活动窗口并生成至多八段：operation、wait-candidate、result-candidate、unclassified。只有完整实测事件间至少三秒空隙才建议两倍速/静音；墙钟事件、截断记录或预算外活动保留原速。无事件不证明页面静止，导航不证明成功。GUI 从“更多”进入并要求核对播放器，可编辑源边界、原速/两倍速和静音；`apply-recording-plan` 要求当前 source/event SHA，连续覆盖当前全源区间，显式保存 visualSegments，不删除原片或任何区间。只接受添加旁白、字幕、手工焦点与独立对象之前的未分段视频，避免暗中重排已编写时钟；更新遵守 CAS、可撤销。

FocusInterval 可选 mode zoom/loupe；loupeCorner 是四角之一且仅供 loupe。放大镜使用原素材像素的正方形采样，保持全画面取景并以有限圆形细节呈现，平滑进出与 sourceStart/playbackRate 同步，预览/原生导出共享绘制；焦点区间及角落使用文档 2.3，旧版本拒绝新字段。它不生成自动鼠标轨迹或确认页面语义。
## 简洁卡片的标题与要点编辑

简洁模式的草稿预览中，点击实际绘制的标题或要点选中并显示“编辑文字”，双击或 Enter 在画面内输入。卡片的“编辑卡片”展开同一镜头的标题和已有要点，两处同步；点空白处、失焦或 Ctrl/Cmd+Enter 保存，Esc 取消未提交输入。文字支持换行，标题按固定模板最多两行绘制；标题最多 44 字，要点最多 64 字，并沿用现有文字布局校验。要点行提供“删除”，末尾提供“＋ 添加要点”；新增使用空白本地输入框，填写后点“添加”、点空白处或 Ctrl/Cmd+Enter 保存，取消或 Esc 不写草稿，空白新增不保存。每镜头最多 3 条要点，达到上限时禁用添加并解释；固定数量版式要求先通过“更换”改用要点列表，数量不匹配时阻止增删。删除同步移除该条的揭示时间/语音板书引用，后续引用索引顺移；其余绑定、旁白、字幕与素材保留。增删复用所属版本 CAS、单次撤销/重做，外部冲突不覆盖。位置沿用固定版式。面板显示当前版式与“更换”：要点列表、三点总结、两项对比、画面解读共用原生预览与导出渲染。选择器用当前镜头的真实内容生成独立临时预览，适用性由现有文字/素材校验决定，不适用的选项禁用并解释原因。预览与取消不写草稿；确认仅更换当前镜头 sceneTemplate，保留文字、素材、旁白和字幕，使用所属 Project/Session/draft/revision 的 CAS 保存及单次 history 撤销。关闭、切换或失效时取消预览并等待原生资源释放；不自动删要点或生成内容。新增模板种类留待真实场景验证。

命中区域由预览与导出共用的绘制器报告，以实际画幅和 object-fit 留白计算，缩放后重新定位。覆盖层不写入视频像素，不允许编辑标签、字幕或品牌水印。标题与已有要点使用原 scene.title/bullets，不复制草稿、不改旁白、字幕、素材和时钟。每次修改经过 Project/Session/草稿/revision 校验和原 update/CAS 保存，复用签名撤销/重做；外部版本冲突保留输入，明确重载后才丢弃。高级不兼容、保存中或跨所属上下文时禁止编辑。

### 原生文字图层时序与描边（文档能力2.7）

独立文字图层新增封闭 `textTreatment` 参数：完整/逐字素/逐行显现、开始延迟、逐字总时长、逐行额外错时及0–8px描边（相对720高度）、不透明十六进制描边色。中文、组合音标、肤色及ZWJ emoji按Intl.Segmenter字素边界处理；完整内容先排版，显现时不重新换行或改变字号。Studio高级属性与唯一browser的layer.set共用校验、版本和原生Canvas预览/导出实现。切分和头部修剪累加原始显现offsetSeconds；清除淡入淡出不重启文字时钟，GUI提供显式重新显现。含此字段的文档最低2.7，旧能力版本在运行时及JSON Schema均拒绝；无此字段的历史短片继续选择原最低版本。此字段仅控制文字时序与描边；透视、运动模糊和glitch由下述独立包装契约定义。

### 有界入场包装、错时卡片与源裁切（文档能力2.8）

独立视觉图层新增封闭`packaging`：入场时长0.05–8秒、原时钟偏移0–720秒、X/Y轴透视翻牌（±85度）、方向模糊（0–24输出像素及±180度）、放射模糊（0–0.15）、RGB glitch（0–12输出像素、1–24Hz）。强度按原始时间的平滑曲线衰减至零；纯数值时钟按微秒归一，跳转及重复切分不依赖上一帧状态。原生Canvas预览/导出共用固定16条带透视网格、各5次有界模糊采样和固定RGB条带偏移；两张可复用像素表面按实际对象尺寸与有限padding分配，预先选择读回模式并在释放时清理，不保留逐帧缓存。类型校验拒绝CSS、脚本、着色器和未知字段。

高级编辑提供效果数值、预设、重置原时钟与清除入口。`layer.add kind:"card-stack"`在所选镜头或全片生成六个独立可编辑对象：三底板、三文字，按0/0.25/0.5秒错时，并保留现有对象预算（每容器八个、全片六十四个）；至少1.2秒、六个剩余图层及连续层次，否则整次事务拒绝。重复相同的高级编辑原因在界面中合并展示，后端仍保留逐对象原因。

图片/视频图层新增`sourceCrop:{x,y,width,height}`，尺寸至少0.05且区域不得越过实际来源；源裁切独立于画布几何，主画面、人像小窗可从同一公开原片分别取区间并独立排版。视频小窗不自动重复混入声音，原声仍由主画面或独立音轨拥有。GUI和`layer.set`共用契约。`layer.set`中`textTreatment/packaging/sourceCrop:null`表示清除；持久文档只允许合法对象或省略。含包装或源裁切的文档最低2.8，运行时及发布Schema共同拒绝旧版本承载这些字段；文字时序单独存在仍最低2.7，长篇单独存在仍最低2.6。

成片审片计划新增包装入场/中间/结束及文字显现时钟候选，源偏移后的候选不得落在对象范围之外；显式换行仅作候选估计，不声称找到所有实际换行或逐字边界。每场景首尾保留最高优先级；现有24/场景、576/全片总上限及omittedCandidates不变。

独立图层可作为镜头的全部视觉内容。制作条件检查只接受在该镜头时间范围内存在的可见本地图层/全片图层；隐藏、全程零不透明度、空白文字或完全位于其他镜头的对象不补足画面内容。仍需通过实际素材解码、文字布局、范围及成片检查；存在对象不代表整段有完整语义覆盖。

### 科学图解数据与共享渲染（文档能力2.9）

高级编辑的独立视觉图层新增`kind:"diagram"`及必需的`science`版本1数据。GUI提供类型、数据行、数值范围、单位、颜色、说明与原动画时钟；与普通图层共用pending输入、CAS、锁定及撤销，错误数据保留在控件中供修改，不覆盖已保存草稿。`layer.add kind:"diagram"`添加默认曲线，`layer.set.patch.science`替换完整的受限数据；数据驱动的读数没有手工覆盖字段。图层仍计入每容器8个/整片64个独立对象预算。

四类封闭组件：曲线（2–64个X严格递增坐标、包围数据的XY范围、沿线点）；比例（1–8分项、非负值且合计为正、条/饼/环共享分项）；路径（2–32个归一化点，1–24粒子，1–8流动周期）；阵列（1–8分组、合计1–64对象）。数值有限且绝对值不超过1e9，颜色为不透明RGB，标题40、单位12、说明80字符。结构Schema限制字段、类型和条数，运行时另核验点顺序、范围包含、非零路径、比例总数和阵列合计；钻井Y向下不减且终点低于起点，深度直接从钻头Y映射，水平段不增加垂直深度。流动模式的读数表示时钟进度，不是流量/压力仿真。

`scienceState`从同一数据及微秒归一的原始时间导出曲线前缀/点/读数、当前分项/扇区/总数、路径头/粒子及对象位置/目标数量。阵列身份按数据分区稳定生成，重排中允许交叠；目标分组标签在最后10%显现，较密对象不绘制不可读的小编号。科学计数显示为有限精度字符串，原数据保持数值。切分、头部修剪累加science.offsetSeconds，清除淡变不重启科学动画。预览/导出共用同一Canvas绘制器与状态函数；字号按整帧与390像素手机宽度有界调整，放不下时明确报布局错误，不能静默省掉数据标签。比例图例在动画开始前按目标值预留固定布局，长标签使用两行；极小中间值可显示小于0.001，原始数值不变。

默认图解使用示意数据并显示说明；不声称复原论文测量或通用3D/流体仿真。新字段/类型最低文档2.9，旧版本的结构Schema和运行时均拒绝。此前2.0–2.8仍按各自最低能力保存。审片计划加入科学动画开始、中间与结束候选，保留既有全片576/每镜24上限及遗漏计数。

<!-- BEGIN GENERATED CAPABILITY AND TEST INVENTORY -->

> 本区块由 `npm run docs:features` 生成。请修改上方人工维护的功能条目，再刷新本区块；不要手工编辑本区块。

### 当前 Browser Action 清单

- BMW 核心 Browser Actions（49）：`status`、`help`、`tabs.list`、`pages.discover`、`pages.read`、`pages.read-result`、`tabs.open`、`tabs.show`、`tabs.close`、`navigate`、`back`、`forward`、`reload`、`observe`、`page.text.find`、`click`、`type`、`wait`、`key`、`hover`、`page.diagnostics`、`page.media.list`、`page.viewport.set`、`media.screenshot`、`media.download`、`media.preserve`、`media.segment`、`media.video.capture`、`media.inspect`、`media.audio.sample`、`media.speech.align`、`media.audio.preview`、`media.video.motion`、`media.frames.sample`、`media.capture.frames.sample`、`media.convert`、`media.image.inspect`、`media.image.annotate`、`media.image.draw`、`media.record.start`、`media.record.stop`、`project.context`、`project.memory.append`、`project.tasks.append`、`schedule.list`、`schedule.create`、`schedule.update`、`schedule.remove`、`schedule.run`
- feature-library Feature Browser Actions（9）：`library.materials`、`library.sources`、`library.news`、`library.research`、`library.exports`、`library.streams`、`library.collecting`、`library.collection-batch`、`library.recommendations`
- feature-video Feature Browser Actions（5）：`video.compose`、`video.narrate`、`video.studio`、`video.review`、`video.settings`

- video.studio 操作（79）：`news-preparation`、`news-topics`、`propose-news-topics`、`select-news-topic`、`news-guide`、`record-production-review`、`precomposition-status`、`precompose`、`production-profiles`、`propose-type`、`adopt-type`、`production-read`、`production-review`、`plan-impact`、`analysis`、`diagnose-timing`、`review-status`、`record-export-review`、`read-scene`、`read-preparation`、`describe-edit`、`guide`、`estimate-speech`、`suggest-recording-plan`、`apply-recording-plan`、`narrate-local`、`apply-source-narration`、`validate-source-narration`、`materials`、`describe-template`、`describe-schema`、`read-document`、`compatibility`、`validate-edit`、`apply-edit`、`migrate-document`、`remove-reference`、`prepare-reference`、`read-reference`、`set-reference-analyses`、`set-reference-analysis`、`apply-reference-notes`、`propose-review`、`adopt-review`、`dismiss-review`、`undo-review`、`split-scene`、`restore`、`recognize-source`、`read-source-speech`、`apply-source-captions`、`detach-source-captions`、`set-caption-translations`、`align-speech`、`read-speech`、`correct-speech`、`source`、`export-citations`、`list`、`create`、`read`、`delete`、`update`、`narrate`、`narrate-pending`、`check`、`export-captions`、`export-cover`、`read-material`、`suggest-focus`、`review-export`、`render`、`assets`、`inspect`、`attach`、`open`、`context`、`configure`、`save-template`。字段、用户专属操作与归属检查见上方契约。

### 当前自动化测试清单

#### `packages/agent-contract/test/assistant-ui.test.ts`

- `Assistant IPC admits only named bounded commands with explicit Session/run identities`
- `unknown input disposition requires exact owner/run and explicit no-replay acknowledgement`

#### `packages/agent-contract/test/context-sync.test.ts`

- `BMW context validates Project and Session identity without native Workspace fields`

#### `packages/agent-contract/test/conversation.test.ts`

- `BMW conversations admit a visible blank Session without a provider identity`
- `driver capability declarations fail closed instead of enabling missing features`
- `driver events reject extra execution tools and malformed interaction decisions`
- `event envelopes require explicit Session/run identity and a positive replay sequence`

#### `packages/agent-contract/test/driver-settings.test.ts`

- `Settings commands are closed and snapshots reject credential-bearing form defaults`

#### `packages/agent-contract/test/video-identity.test.ts`

- `YouTube binds URL and both tracks to the same target, selects one default language and rejects foreign/ambiguous evidence`
- `X network resources require the original post media identity; replies, unrelated animations and changed identity fail closed`
- `A correctly identified YouTube target without observed delivery refuses guessed SABR or another video`
- `Only a same-target YouTube response can advertise an explicit native SABR resource`
- `Capture follows only the same pinned YouTube identity across delivery rotation; downloads remain exact`

#### `packages/agent-ui/test/studio-composer-scope.test.ts`

- `Composer pins a visual piece at first input, preserves owner drafts and clears piece identity for broader scopes`

#### `packages/browser-capability/test/bridge-http.test.ts`

- `Private Bridge jobs bypass the global header/body timer but retain caller cancellation and closed loopback destinations`
- `Private Bridge transport never follows an authenticated redirect`

#### `packages/browser-capability/test/bridge-shutdown.test.ts`

- `Bridge shutdown cancels the active renderer wait before draining FIFO`
- `Host scoped leases use their pinned executor and context without admitting a normal inactive lease`

#### `packages/browser-capability/test/browser-deadline.test.ts`

- `Only bounded batch collect receives its ten-minute transport budget; reads, admission and malformed requests retain the default`
- `browser requests are finite while media jobs retain their long budget`
- `Source acquisition budget includes bounded download, capture, cleanup and decode`
- `YouTube player navigation allows bounded initialization while unrelated hosts keep the normal budget`
- `Bounded local speech gets processing plus cleanup transport time`

#### `packages/browser-capability/test/browser-host.test.ts`

- `Feature dispatch admits the host port and forwards actor, Project and cancellation without replacing them`

#### `packages/browser-capability/test/browser-schema.test.ts`

- `accepts every declared browser action`
- `Browser validation returns recoverable catalog contracts and rejects ignored cross-action fields before execution`
- `rejects unsupported and malformed requests`
- `returns only string tab ids`
- `Text page batches admit bounded explicit URL lists and never caller scripts, tab targets or deadline overrides`
- `body ranges bound selectors and exclusions and reject malformed scope rather than broadening it`
- `Discovery admits only closed bounded account requests, and an explicit leads projection`
- `Export speech windows use the same browser catalog and fixed local interval contract`
- `Visible text finding requires an explicit closed scope and bounded query without caller scripts or source authority`

#### `packages/browser-capability/test/collect-page-source.test.ts`

- `Published time reads a bounded timezone-bearing TIME datetime while preserving visible date fallback`
- `Publication metadata extracts one complete publisher date line beside bylines or document numbers, never ambiguous or truncated dates`
- `Visible body witnesses bind UTF16 author and publication metadata without guessing selectors or accepting changed text`
- `Body publication witnesses reject cropped update/recording dates and non-date text instead of laundering them into current news`
- `Source collection retains scoped originals, unknown dates and candidate-only roles with no global resource admission`
- `Missing source range never invokes media fallback; truncation, visible trial evidence and missing explicit media range remain explicit`
- `Navigation across collection phases yields navigated evidence; cancellation leaves no late candidate admission or listeners`
- `Clipped metadata remains explicitly truncated rather than silently admitted as complete author/date evidence`

#### `packages/browser-capability/test/collection-page-pool.test.ts`

- `Collection page pool runs exactly 2–3 isolated lanes with bounded admission and closes every lane`
- `Text account coverage requires same-account visible posts and excludes login shells, redirects and incomplete text`
- `Collection page pool cancels queued pages and waits for every active lane cleanup before releasing admission`
- `Collection page pool rejects changed ownership after reads, source tab targets, over-budget work and invalid bounds`
- `Collection page pool isolates ordinary source errors but aborts on cleanup failure and reports explicit recovery`
- `Collection link discovery uses only visible scoped HTTP links, normalizes fragments and reports its bounded range`
- `Collection navigation equivalence permits theme refresh and query serialization while preserving video, origin and remaining query identity`
- `Confirmed access walls stop only queued URLs of the same subscription for this batch; timeouts remain ordinary pending failures`
- `Durable text batch projections preserve every status and paginate large metadata, links and original text without middle truncation`

#### `packages/browser-capability/test/mcp-tool-catalog.test.ts`

- `BMW MCP discovers exactly browser from the authenticated product catalog`
- `MCP catalog admission rejects extra tools and malformed action boundaries`
- `Authenticated browser help describes contributed and core actions without a second tool or permissive aliases`
- `Published browser schema separates canvas drawing, annotation and Studio arguments by action`
- `Studio operation and source suboperation discovery stays bounded and recovers opaque source enums without human contracts`
- `Source-frame model image admission rechecks the native PNG hash after service completion`
- `Wire schema factoring preserves full BMW validation, deterministic catalogs and unchanged native help contracts`
- `Factoring keeps embedded schema identifiers local, literal data intact, and existing references/vocabularies untouched`
- `Published descriptions retain every action instruction once and preserve additional feature context`
- `Batched help reads only effective schemas, preserves closed shapes and explicitly omits over-budget targets`

#### `packages/browser-capability/test/media-artifact.test.ts`

- `media download writes a bounded Project artifact through the browser fetch adapter`
- `media download rejects non-web URLs and responses beyond its byte limit`
- `artifact filenames remove path syntax and infer media extensions`
- `media download rejects partial HTTP responses and removes truncated full responses`
- `media download rejects and removes DASH initialization fragments`
- `media download cancellation aborts fetch and drains streaming writes before removing partial output`
- `failed media download never removes an existing artifact with the same filename`

#### `packages/browser-capability/test/media-session-fetch.test.ts`

- `media adapter reduces referrer and strips secrets across bounded redirects`
- `media adapter honors no-referrer and refuses non-web redirects and redirect loops`
- `Media POST keeps bounded SABR protobuf bytes and refuses arbitrary bodies, origins and redirect rewrites`
- `Native POST preserves binary data and close-before-response cannot release an unfinished response`
- `Native cancellation still aborts a live response after outgoing close and waits for its destruction`

#### `packages/browser-capability/test/page-navigation.test.ts`

- `Navigation deadline stops and drains the real pending operation before the FIFO admits another action`
- `Cancellation whose stop never settles closes the actual page before returning, with no late continuation`
- `Failed native close reports quarantine and only a later explicit close with destruction recovers`
- `A user-owned page is retained after failed stop until explicit close recovery`
- `Already cancelled navigation never starts native loading and an ordinary load error does not leave listeners`
- `Collection DOM readiness stops and drains asset loading, while ordinary navigation still waits for load`
- `A collection ready probe cannot release a still-running native navigation or leave late renderer work`
- `Temporary content lease captures real content before stopping an unrelated pending load`
- `Temporary content lease records negative evidence before deadline cleanup and never upgrades an empty shell`
- `Only successful same-document receiving bytes can extend a read; headers, stale progress, errors and other URLs never do`
- `Content lease lets active document bytes finish but keeps a hard cap and cancellation, without accepting an empty shell`

#### `packages/browser-capability/test/preservation-result.test.ts`

- `Long archive browser receipts remain bounded without losing the complete internal rollback ledger`
- `Short native receipts retain every resource and malformed results are refused`

#### `packages/browser-capability/test/renderer-read.test.ts`

- `Renderer read cancellation releases FIFO and ignores late DOM and diagnostic results`
- `Renderer reads bound deadlines and reject navigation, renderer loss and pre-cancellation`

#### `packages/browser-capability/test/screenshot-read.test.ts`

- `screenshot cancellation releases FIFO and ignores a late renderer result`
- `screenshot deadline identifies phase and renderer loss removes observers`
- `screenshot rejects main navigation and never starts already cancelled reads`

#### `packages/browser-capability/test/session-leases.test.ts`

- `managed provider registration resolves only an attached live Host lease and keeps the canonical BMW owner`
- `Session lease revocation aborts its work but awaits actual cleanup before returning`
- `Qoder/Codex MCP receives host scope from its private environment and rejects model scope substitution`

#### `packages/browser-capability/test/session-operations.test.ts`

- `Session operations serialize, recheck admission and recover after failure`
- `Browser bridge pins Project identity, revokes queued Sessions and returns only owned PNG images`
- `Browser bridge admits bounded Project frame sets and propagates active MCP cancellation`
- `Studio context bridge authenticates Session ownership and rechecks revocation after GUI flush`

#### `packages/browser-capability/test/tab-policy.test.ts`

- `Agent tab reuse prefers an exact URL without navigating`
- `Agent tab reuse navigates the most recent same-origin Agent tab but not a user tab`
- `Agent tab cap closes only least-recent background Agent tabs`
- `Saved research ownership survives restore, bounds Agent pages and preserves the visible page`

#### `packages/browser-capability/test/video-acquisition.test.ts`

- `Direct preservation returns original encoding without starting playback or capture`
- `Download failure falls back only after preservation drained; public diagnostics omit delivery URLs`
- `Cancellation, changed identity, and failed cleanup never start capture`
- `One shared native budget aborts download and awaits its cleanup before fallback`
- `Long or unknown sources require explicit archive handling; guards fail before acquiring`
- `Fallback failures retain the real guard error and bounded download reasons without signed URLs`
- `Expired delivery can enter capture only after a fresh capture-specific identity check`

#### `packages/browser-capability/test/video-capture-ready.test.ts`

- `Preparation waits for actual buffered video and pauses before capture can start`
- `Unbuffered or zero-size players do not masquerade as ready; timeout drains playback`
- `Cancellation during warmup awaits pause and never returns readiness`
- `A short capture buffers its own bounded window rather than requiring thirty source seconds`

#### `packages/browser-capability/test/youtube-sabr-observation.test.ts`

- `SABR observations are private, bounded to registered page identity/session nonce, expire and clear on navigation`
- `Same-video theme navigation retains the native witness; target changes and full reloads clear it`
- `Finite completed broadcasts require a past end and a complete seekable window; active and incomplete streams remain refused`
- `The actual bounded player observation admits an ended replay and rechecks rolling/live state before retaining its witness`

#### `packages/feature-library/test/collection-batch.test.ts`

- `Closed batch contracts and trusted admission retain exact owner, anchor, revision and user priority`
- `Uncertain official delivery is persisted before enqueue and never replayed; explicit rejection is distinct`
- `Nine configured sources use bounded real-store collection, fair article slots and original/legacy preservation`
- `Restricted, blank, incomplete, missing links and foreign redirects retain cursor and never become no-new`
- `Agent batch pages avoid runtime output folding while every original and full GUI gap remains intact`
- `Incremental URL checkpoints ignore changed entry metrics without losing newly saved originals`
- `Partial decision failures preserve per-item saved receipt and retry does not duplicate the accepted lead`
- `Pending links survive cancellation and a fresh explicit batch; cleanup must drain and quarantine recovery never replays input`
- `User cancellation settles only after all native page lanes close; saved originals and uncertain collection remain inspectable`
- `A lead commit followed by interrupted batch receipt recovers the exact decision without a duplicate lead revision`
- `A full 200-URL backlog drains saved pending before reading new entries and never truncates unreviewed URLs`
- `Restricted or incomplete next entries preserve all prior 1–100 pending URLs and the previous successful cursor`
- `Observed truncated article originals can save leads with explicit gaps but stay pending and never advance source cursors`
- `Qbit publication fallback admits only one valid complete civil date beside the independent byline with an exact UTF16 witness`
- `Compact review covers the whole batch once, keeps uncertain dates pending, and supplies immutable evidence`
- `News screening uses frozen publication intervals, excludes proven old originals and retains uncertainty`
- `Background batch scope admits compact review only for its exact agent Project, Session and saved batch`

#### `packages/feature-library/test/collection-scheduler.test.ts`

- `Multiple directions are fair, bounded and idle-only; explicit foreign bindings wait without switching or modifying old data`
- `Restart coalesces missed periods into one bounded cycle; prepared work resumes while uncertain delivery never replays`
- `Failure backoff is capped, cursor-safe and health notices deduplicate; recovery succeeds only after actual evidence and drain`
- `User arrival before admission is safely deferred; thrown delivery and cleanup failures retain locks and require review`
- `Schedule pause drains only its background receipt; driver changes stop automatic input and explicit rebinding is required`
- `Closed bounded schedule state preserves malformed bytes, rejects CAS and linked files, and does not initialize on read`
- `A restricted source rotates behind the other selected sources; lost cleanup acknowledgement never becomes an automatic retry`
- `Muted system notifications still persist health notices and a Session rebind cannot silently replay a pending cycle`
- `The deadline wakes independently of the periodic tick and cancellation still waits for its own actual drain`
- `Explicit reconfiguration after recovery can change cadence and Project binding without changing old receipts or evidence`
- `Collection diagnostics cannot alter admission, source completion or actual cleanup`
- `Per-source cooldowns isolate failures and partial progress while a bounded cycle continues healthy sources`
- `Productive partial uses the pre-dispatch evidence snapshot; repeated subsets do not invent progress across restart`
- `Legacy global backoff is not inherited by unrelated sources, while normal cadence and unknown receipts survive upgrade`
- `Source retry state is closed, bounded and source-bound; legacy in-flight partial cannot fabricate a progress baseline`

#### `packages/feature-library/test/exports.test.ts`

- `Actual enabled render inputs preserve rates, segmented voice, source EOF and held frames without reference/hidden/muted adoption`
- `Read-only bidirectional queries paginate and expose changed/missing output and material hashes without rewriting historical adoption`
- `Only host-admitted committed copies add original Project ancestry to automatic adoption`
- `Legacy exports project read-only unknown adoption; pending records need a matching owned draft receipt`
- `Studio export history remains independent beyond thirty draft receipts and cache reuse never creates another version`
- `Cancelled, changed-input and corrupt-ledger paths preserve old work, report unverified adoption and never mint a false committed record`
- `Ledger admission failure preserves successful Studio work while CAS failure removes only the uncommitted output`
- `Immutable admission refuses a target created after preparation, and damaged ledger queries keep diagnostics bounded`
- `Export browser queries are closed, bounded and read-only with no model export-admission route`

#### `packages/feature-library/test/library.test.ts`

- `Global discovery includes unindexed files, body search, archive filters and independent CAS metadata`
- `Cross-Project copy retains source originals, media and proofs, deduplicates repeats and survives loss of the source Project`
- `Copy rejects hash changes and collisions; pre-aborted work leaves target artifacts and catalog unchanged`
- `Corrupt metadata and symlinked directories stay unchanged and surface as explicit discovery issues`
- `Cancellation after staging drains cleanup, and repeated copies preserve independently edited target metadata`
- `Date and availability filters preserve publisher precision, and supporting artifacts require an explicit filter`
- `Model source pages preserve exact UTF16 positions without returning every acquisition or candidate`

#### `packages/feature-library/test/recommendations.test.ts`

- `Strict ten snapshots rank all scoped events with bounded steps and pin events, policy, editions and exclusions across updates and index rebuild`
- `Shortage reports expiry, missing editions, duplicate events and filters; no small batch becomes complete or activates without explicit acceptance`
- `Snapshot selection rechecks event and source evidence while selected drafts retain original versions and durable dispatch never replays`
- `Direction week windows are admitted only by frozen Host bindings; old news stays at 72 hours and foreign use copies one selected proof without rewriting source snapshots`
- `Legacy observation editions are reused only at their frozen revision, originals stay byte-identical and cancelled/CAS steps retain resumable progress`
- `Closed requests, stale originals and trusted-user boundaries reject model strategy/generation/activation and never create foreign indexes`
- `Legacy news canonicalizes its owned Project alias once and rejects a rebound alias without weakening record-store boundaries`

#### `packages/feature-library/test/research.test.ts`

- `Project topics and global promotion persist without moving originals or rewriting legacy news/drafts`
- `Explicit purpose supports non-video works and reference/planned relations never claim actual adoption`
- `CAS rejects stale organization, promotion and global direction edits without partially changing either store`
- `Corrupt and linked research metadata is preserved; raw material discovery remains available with explicit issues`
- `Closed browser schema matches parser and refuses paths, ambiguous identities, oversized pages and adoption claims`
- `Direction topic references paginate beyond summary limits, unlink safely and expose archived collection state`
- `Acquisition grouping reaches its saved original without duplicating files and an explicit artifact assignment can override it`

#### `packages/feature-library/test/rolling.test.ts`

- `Closed rolling catalog admits bounded manual operations; no model subscription, merge, dispatch or foreign evidence bypass`
- `Real social entry snapshots accept literal URL identities and empty metrics, with actionable errors for full URLs, trend labels and partial finish evidence`
- `X and YouTube observations bind exact visible metrics, platform identities and source SHA, without claiming fact or growth`
- `Only successful complete entry evidence commits a cursor; restricted, partial, corrupt evidence, cancellation and stale CAS retain it`
- `Persisted uncertain delivery, real cleanup failures, deadlines and submission budgets never replay or drop saved leads`
- `Editorial revisions, atomic merge/split and complete evidence partition preserve originals, lineage, snapshots and audit histories`
- `Direction pause or collection-Project rebinding invalidates the saved lease without moving old subscriptions or evidence`
- `A fast official completion still persists its dispatch identity without overwriting the completed collection`
- `Social challenge originals stay inspectable but cannot become content leads or advance a successful cursor`
- `Current-run read bundles bounded partial evidence reuse without granting subscription or history reads`
- `Continuation rejects previous Session, subscription, input or cursor changes and omits later-mutated evidence`
- `Continuation keeps exact URL and SHA within a twelve KiB summary and reports omitted entries without new reads`

#### `packages/feature-library/test/source-preservation-basis.test.ts`

- `Source acquisition accepts complete native SABR only for its already confirmed identical YouTube target`
- `SABR source acquisition rejects absent, foreign, cross-platform or malformed delivery identities`

#### `packages/feature-library/test/source-presets.test.ts`

- `Fixed catalog is closed, HTTPS and platform checked, with official/research/reporting and X/YouTube observation coverage`
- `Preset subscription is trusted, CAS protected, repeat safe and preserves edited subscriptions, old files and paused defaults`
- `Social observation kinds and challenge guards do not invent growth or reinterpret old optional fields`

#### `packages/feature-library/test/streams.test.ts`

- `Generic multi-direction events exceed recommendation size, preserve revision snapshots and rebuild after interrupted maintenance`
- `Stream schema and service keep maintenance trusted, retain legacy files and never expose foreign source bodies`
- `Explicit legacy news synchronization is idempotent, keeps batch bytes and separates observations from different Sessions`

#### `packages/feature-video/test/material-index.test.ts`

- `news research transcribes one measured short preview but rejects longer or cached long sources before ASR or index writes`
- `material index durably chunks long source clocks, searches exact original intervals and reuses validated completed work`
- `material background chunks reject GUI metadata CAS races, preserve committed parts and clean only new proof outputs`
- `Zero-result intervals retain raw ASR evidence and coverage without fabricated text, silence claims or repeated processing`
- `material index paths, cursors and intervals stay closed and symlink catalogs are never replaced`
- `one bounded OR search returns exact reusable pins and oversized sources cannot trap its cursor`

#### `packages/feature-video/test/news-delivery.test.ts`

- `Operator delivery packages only fresh pinned independent passes; rejects queued, changed frames/output and existing destinations`

#### `packages/feature-video/test/news-preparation.test.ts`

- `News preparation gates narration/render on actual current scene evidence and preserves generic Studio behavior`
- `Static MP4, missing source sound, changed PNGs and unrelated source ranges cannot establish preparation`
- `Preparation invalidates script, citation, framing, source bytes and CAS changes without rewriting prior records`
- `Native track-bound inspection does not invalidate observed preparation through derived container duration`
- `Closed preparation API, separate journal ownership, policy strengthening and bounded model paging stay explicit`
- `Shot batch links exact pins to native segments, reference frames and one atomic scene commit without semantic approval`
- `Shot batches retain reusable completed work after failure, reject changed plans and preserve concurrent GUI edits`
- `Shot preparation rejects missing pins and cancellation before native work and keeps checkpoints private`
- `Shot binding hints stay bounded, reject ambiguous acquisitions and never replace failed or cancelled validation`
- `Uncertain shot checkpoints refuse replay without mutating progress; timing logs contain only bounded metadata`
- `Observed scene batches inspect current facts once and commit all declarations by one checklist CAS`
- `Observed scene batches reject the whole batch on stale evidence, user declarations, cancellation and concurrent GUI changes`
- `Invalid speech projection remains a per-scene preparation gap without admitting stale evidence or breaking read-only diagnostics`
- `Preparation exposes exact reference endpoint gaps in preflight and evidence refusal without weakening source windows`
- `Incomplete reference analysis names exact missing frame indices and a read-only recovery without changing evidence`
- `An acquisition ID typo returns a closed exact-source lookup without correcting or executing the failed shot`
- `Preparation diagnostics identify the exact authored field without echoing text or weakening speech requirements`
- `Reusing existing shot IDs rejects before native work or checkpoint writes and directs explicit footage replacement`

#### `packages/feature-video/test/news.test.ts`

- `Live broadcast publication labels retain original day precision and never turn relative or future dates into fresh news`
- `Localized post clocks never invent a timezone and retain conservative publication-day boundaries`
- `Date-only publishers retain precision and qualify only when the entire conservative timezone range is within 72 hours`
- `Publisher day labels tolerate weekdays, month dots, ordinals, clocks and zones while keeping day precision`
- `Leaving news research is user-only and preserves the board while releasing the Session research restriction`
- `Ten verified news events survive restart and selecting the tenth keeps one draft, explicit voice and no preselection media work`
- `News candidates accept broad subjects and recording days while rejecting unknown fields, duplicate events and ambiguous dates`
- `News proposals require original dates, exact quotes and source-owned verified previews; empty results remain pending`
- `Only a current trusted selection creates one draft and durable dispatch never replays after uncertainty or restart`
- `News research allows material reads and preview indexing without granting metadata edits, drafting or synthesis`
- `Preselection blocks drafting and native narration, and late source changes reject selection or further selected rendering`
- `News journals preserve corrupt files, reject symlinks and archive previous selected tasks without deleting their drafts`
- `Native page screenshots bind exact source URL and text, preserve CAS and reject changed pages or files before a news proposal`
- `News guide recognizes rendered title cards and sentence captions, but reports stale or explicitly disabled captions`
- `News guide accepts captioned original-speech scenes without TTS and rejects muted or short source coverage`
- `Selected video evidence accepts native same-film HD trims across restart, never same-site different films or unproven names`
- `Native lineage rejects missing parents, linked receipts, cycles, foreign paths and cancelled verification`
- `Selected news render guard permits same-original HD footage without burning its low-resolution preview, retaining stale-source rejection`

#### `packages/feature-video/test/preparation-fingerprint.test.ts`

- `Preparation fingerprints ignore inspection and provenance metadata while retaining rendered caption and segment edits`
- `Preparation fingerprints bind effective anchored captions and speech links without hashing evidence provenance`

#### `packages/feature-video/test/production-assessment.test.ts`

- `Only trusted user-origin type assessments can declare listening and viewer understanding; Agent opinions remain separate`
- `Type review journals enforce Project/Session ownership, independent CAS, bounded history and no symbolic links`
- `Content review identity is stable across receipt revisions and changes with actual source bytes or authored questions`

#### `packages/feature-video/test/production.test.ts`

- `News duration review distinguishes the default 45-second brief from an explicit two-minute focus target`
- `Versioned production worksheets and research diagrams require 2.10 and round-trip without losing authored fields`
- `Type adoption is explicit, rechecks actual source bytes and preserves GUI edits and current revision`
- `Impact matrix distinguishes voice, visual, captions and cover changes and binds plans to current file hashes`
- `Source relations never infer authorship from URLs and reject dangling, duplicate and cyclic ancestry`
- `Semantic goals keep their captured sentence/target identity across regeneration and never silently adopt repeated sentence IDs`
- `External asset chains retain native SHA snapshots through six versions and flag replacements without rewriting earlier versions`
- `Late proxy completion reconciles a GUI CAS race and asks native ownership cleanup to remove only its new outputs`

#### `packages/feature-video/test/scene-reference-preparation.test.ts`

- `Scene reference batch fixes four selected half-open intervals with one CAS, preserves seven prior records and reuses exact native evidence`
- `Reference endpoints use actual PTS and exclusive scene end, with structured windows instead of unchanged retries`
- `Three camera cuts retain every source boundary within eight native frames and disclose omitted interior candidates`
- `Scene reference batch refuses stale sources, cancellation and GUI CAS while preserving records and cleaning only its new PNGs`
- `Immutable reference history and source-group budgets are shared, backward compatible, bounded and closed to invented scene clocks`

#### `packages/feature-video/test/source-analysis.test.ts`

- `Whole-video sampling uses measured video range, reuses dense baseline points, bounds requests and never invents review`
- `Analysis pages survive restart, densify without losing reviewed identities, export complete ledgers and reject changed evidence`
- `Failed analysis pages clean new files, require explicit retry, and cancellation preserves committed progress`
- `Analysis exports paginate by actual UTF8 bytes and retain every long Chinese review note`
- `Analysis CAS preserves competing edits and refuses symlinked storage`

#### `packages/feature-video/test/source-transcript.test.ts`

- `One bounded native source request segments locally, batches ASR, resumes committed units and reports full original-time coverage`
- `Batch cancellation preserves completed ASR chunks, awaits cleanup and resumes only on an explicit new request`
- `In-flight checkpoints require explicit recovery after native cleanup; foreign sessions and changed original bytes are refused`
- `Source batching is unavailable during news research and has a closed bounded request contract`

#### `packages/feature-video/test/studio-materials.test.ts`

- `Studio material groups reflect live scene bindings and reuse across Project drafts`
- `Studio material drops admit only current Project assets matching the target slot`

#### `packages/feature-video/test/studio-sources.test.ts`

- `Studio source evidence is Project-shared, while citation edits keep Session ownership/CAS and actual original UTF16 ranges`
- `Native full-file decode admission rejects empty/dropped track evidence and remains a private host action`

#### `packages/feature-video/test/video-boundary.test.ts`

- `video actions remain feature-owned in one browser tool and require trusted narration consent`
- `Session-owned direct composition registers an editable draft and existing export without changing other drafts`
- `Direct composition never registers cancelled, failed or foreign work; unsupported timing stays explicitly standalone`

#### `packages/feature-video/test/video-document.test.ts`

- `Context rejection supplies a valid explicit read request without admitting extra fields or changing edit recovery`
- `Primary trim retains exact microsecond caption boundaries without erasing deliberate source residuals`
- `Primary crop edits target actual segmented or single-source footage and preserve clocks, audio and captions atomically`
- `Preparation summaries expose missing citations without certifying video motion; timeline identifies primary objects and edit clock`
- `Edit failures identify rejected fields and recovery operations without accepting aliases or partially changing the draft`
- `Agent context, discovery and published schema advertise the same supported document versions`
- `Version 2.9 scientific data survives editable commands, saved documents and original-clock scene/object cuts`
- `Version 2.8 entry packaging and six editable staggered cards use bounded Agent transactions and retained clocks`
- `Version 2.7 text treatment survives Agent edits, persistence and cuts; old document versions reject it`
- `Version 2.6 admits bounded twelve-minute films and 96 scenes while legacy documents retain their original budgets`
- `Short films with expanded fade or original presentation clocks also require 2.6 and stay reversible`
- `Browser model reads and mutations use bounded projections while GUI retains complete drafts and all Host records`
- `Filtered Project asset pagination discovers materials after thousands of review outputs and rejects links`
- `Compact model results retain export identity, source text offsets and speech evidence without repeated full records`
- `Phone line hints and editable ordered diagrams require 2.4 while previous documents remain supported`
- `Speech timing provenance requires canonical 2.5, roundtrips without loss and cannot be relabeled as a legacy document`
- `detailed source reading and background phases require 2.2 and survive CAS splits and signed restore without restarting`
- `persisted card splits retain original metric and reveal clocks across reorder and codec restoration`
- `global layout and pacing persist in 2.1 and survive ordinary updates without rewriting old drafts`
- `automatic narration receipts keep the new document version independently of optional presentation settings`
- `model catalog shares eight categories and lazily returns only the selected closed template`
- `explicit template conversion preserves text and source files, rejects count loss and reports visual detachment`
- `card documents persist their only content authority in 2.1 while old 2.0 stays unchanged`
- `Canonical v2 preserves preparation, script, subtitles, source clocks, output settings and journals exactly`
- `Shared codec accounts for segmented fallback, empty voice, independent effects and original fade/keyframe clocks`
- `Integer placement with bounded residual preserves legacy JS clocks without rounding trusted source time`
- `Timeline owns chronology; invalid versions, unknown fields, duplicate IDs, gaps and unmapped objects fail closed`
- `Simple profile is a reversible subset; hidden/muted advanced objects block until removed, with no persisted mode lock`
- `Simple typed edits remain closed and roundtrip across both editors`
- `Canonical persistence and v1 migration preserve originals, owner, exports and revision; invalid reads do not rewrite`
- `Agent operations enforce trusted scope, current revision, atomic dry runs and actual advanced authorization`
- `Bounded captions and card edits preserve Host speech records and atomically bind current targets under CAS`
- `Typed independent edits convert global time to owning scene and preserve original fade clocks on trim/split`
- `loupe mode roundtrips in 2.3 and cannot be disguised as a previous document version`
- `Caption translation commands batch scenes under one draft CAS and preserve original source clocks and user corrections`
- `Editorial batch discovery returns exact preparation branch and translation command without unrelated schemas`

#### `packages/feature-video/test/video-review-packet.test.ts`

- `Pinned audit packet contains actual script, captions, visual/audio clock and verified saved quote without certifying claims`
- `Oversized editorial data remains below 12 KiB with explicit section and scene omissions`
- `Unavailable quotes are explicit and a changed pinned draft aborts packet admission`

#### `packages/feature-video/test/video-review.test.ts`

- `Video audit rejects caller authority, catches sparse closing cards and cannot reuse old or foreign run approval`
- `Internal video action binds the actual native export, rejects stale owners and revisions, and records sparse ending failures under its Host run`

#### `packages/feature-video/test/video-settings.test.ts`

- `video template settings persist without changing other settings and are reusable by name`
- `Studio snapshots defaults and templates while visual-only configure retains custom size and CAS`
- `TTS resolves Edge male defaults named snapshots and explicit overrides while preserving opt-out`
- `Studio narration uses configurable TTS rather than fixed local speech and enforces the Edge gate`

#### `packages/feature-video/test/video-studio.test.ts`

- `Task display handles empty workspaces, owned completed tools and silent intervals without treating them as stopped jobs`
- `Production facts and explicit recovery use current owned records, never infer a stalled runtime or replay uncertain input`
- `Scientific form edits round-trip all datasets, preserve cut clocks and reject invalid cells atomically`
- `Layer-only scenes satisfy visual readiness only when local/global content is visible in that scene`
- `Rejected long-film receipts remove only new native outputs and preserve the current draft and existing files`
- `original-to-narration recipe keeps continuous footage, measured voice, bilingual source text and explicit caption clocks`
- `explicit local narration changes only the selected scene voice choice and preserves completed global-provider scenes`
- `sentence-linked card slots bind exact content, project compact voice time, survive whole-scene cuts and require document 2.3`
- `reading and highlight sentence references preserve pinned source identity and reject partial or altered target sets`
- `actual export review rejects foreign ownership and stale receipts and rolls back newly sampled images on a revision race`
- `Export review persists current frame coverage and separate declared assessments, invalidates stale evidence and prioritizes changed scenes without reusing approval`
- `card image inspection exposes actual pinned identity; changed source before or after encode blocks and rolls back only new exports`
- `compact playback uses measured source time and preserves manual captions, cuts and explicit silence`
- `host generation and audio import apply compact pacing, protect auto receipts and retain manual playback on replacement`
- `Studio drafts persist per Project and reject conflicting GUI or Agent revisions`
- `Only owned journal revisions retain prepared content; captions, clocks, preparation and output edits require reconciliation`
- `Studio coverage follows actual voice, source trim and speed and requires explicit end hold`
- `Studio render remeasures artifacts instead of trusting edited duration metadata`
- `Studio rejects script paths and malformed captions while admitting Project images`
- `Studio visual edits retain measured narration while rewritten scripts require new speech`
- `Studio selection validates owning draft and scene and publishes the latest revision as context data`
- `Studio GUI undo can explicitly clear an attached voice without erasing omitted model bindings`
- `Preparation persists without scenes, retains legacy bindings and rejects empty export`
- `Preparation admits Project text and rejects missing and symlink additions without a revision write`
- `Caption edits preserve voice while regeneration replaces only the selected script audio`
- `Generated narration records actual parameters and blocks stale voice or rate while visual edits remain ready`
- `Legacy audio keeps unknown parameters and detects subsequent changes; imported audio ignores TTS preferences`
- `Production checklist locates timeline gaps, stale speech and invalid starts even with explicit hold`
- `Measured readiness collects shared and missing asset issues without writes and uses the same export gate`
- `Readiness rejects alpha, oversized, undecodable tracks, symlinks and revisions changed during inspection`
- `Pending narration saves each scene, skips current imports and resumes safely after provider failure`
- `Batch cancellation and concurrent edits reject late results without committing or starting later speech`
- `Narration preserves independent caption endpoints and refuses scene or whole-film duration overflow`
- `Batch uses the draft voice snapshot, respects online opt-out and retains completed scenes on cancellation`
- `Studio exports Project subtitles and literal bounded text while segment changes retain measured narration`
- `Measured image budget deduplicates shared pictures and unsupported encoders block export without writes`
- `Cover export admits closed options, legacy drafts and independent zero-scene output`
- `Cover source admission rejects other Project IDs, audio and symlinks before native work`
- `Cancelled or conflicting cover jobs remove only their new PNG and preserve GUI changes`
- `Workbench timeline preserves cumulative fractional scene and segment boundaries with caption provenance`
- `Workbench timeline labels estimated captions and admits empty cover-only drafts`
- `Studio Session ownership hides legacy and foreign drafts and rejects every foreign draft operation`
- `Studio deletion checks Session and revision and keeps shared materials exports and recoverable records`
- `Studio bridge forwards authenticated Session ownership instead of accepting a caller-selected owner`
- `Studio pending narration keeps the admitted owner when caller identity changes during an awaited job`
- `Legacy renderer exports remain in history but cannot be reused as current theme-correct output`
- `Completed MP4 reuse survives cover/notes edits but invalidates changed composition, files and forged journals`
- `Focus suggestions admit only Project recordings at the owning revision and never overwrite manual focus or speech`
- `Explicit timing provenance binds native editorial estimates or real ASR references, remains read-only in ordinary edits and diagnoses changed evidence`
- `Sentence rhythm diagnostics flag long or dense arguments and long diagram holds while preserving text, source clocks and full graph associations`
- `Native timing diagnostics observe changing audio and reject a revision race without modifying media or returning an old result`
- `Editorial estimates are read-only and corrected anchors plus current card targets commit atomically`
- `Sentence spans reject overlap/forgery/Unicode splits and ASR paragraphs are not divided into invented sentence times`
- `Host sentence correction binds actual hashes and trusted actor; ordinary draft updates cannot replace it`
- `Speech evidence success/rerun preserves correction; cancelled or conflicting recognition rolls back only new outputs`
- `Anchored captions share voice offset and cumulative film time; independent edits remain and file/script changes fail closed`
- `Anchored render rechecks the audio after encode and rolls back only newly created MP4/report on late replacement`
- `Speech links preserve target identity, map trimmed/rated segmented focus, and reject orphan, crop, overlap and boundary changes`
- `Title-card reveal links preserve static rows and independent captions; changed bullets and forged raw times cannot be adopted`
- `Focus-only anchor consumption verifies actual audio hashes and exports truthful receipts; editable links support CAS undo without rewriting host anchors`
- `Studio preserves optional scene numbering and bilingual line breaks through composition and revisions`
- `Unknown footage is pending measurement rather than a false source-range or footage-gap error`
- `Source caption clocks clip trim edges, apply rate and preceding segment offset with zero narration lead`
- `Original-source ASR keeps independent captions; reviewed apply maps actual clock and preserves source evidence`
- `Original-source recognition rolls back only new artifacts on cancellation, CAS conflict and source hash change`
- `Bilingual translation preserves original times and user corrections, and fails atomically on stale original or CAS`
- `Studio simple-first view policy stays separate from video data and freezes confirmation context`
- `Studio chat and renderer geometry reject foreign fields and invalid native layout bounds`
- `Studio pinned prompt scopes validate whole-film, scene and object data before admission`
- `Independent Assistant targets bind exact local/global containers and reject deleted or mixed identities`
- `Studio preserves advanced layer containers during omitted model updates and keeps out-of-range edits recoverable`
- `Studio rejects layer references outside its Project before saving and checks actual overlay source durations`
- `Independent GUI edits preserve local/global identity, source clocks and lock admission`
- `Animated timeline cuts retain linear and restricted easing samples`
- `Canvas transforms preserve animation shape, identity and timing while bounding every frame`
- `Main voice timing preserves measured source and maps preview, captions and manual audio anchors`
- `Main sequence reorder and ripple edits keep local ownership and absolute global tracks`
- `Main subtitle move, trim and split materialize one canonical ordered bilingual cue list`
- `Invalid voice source windows remain readiness issues without invented timeline captions`
- `Studio live chat requests pin an immutable owner and validate actual panel/selection bounds`
- `Repeated easing trims, splits and inserted keyframes preserve the full source curve and persisted ranges`
- `Narration splitting preserves source identity, continuous sentence captions and focus before independent piece edits`
- `Narration piece schemas and clocks reject ambiguity, coercion, source overflow and excess pieces`
- `Stored narration pieces survive omitted model fields, preserve independent captions and enforce captured revision`
- `Exact narration piece Assistant targets reject deleted, foreign-container and mixed scopes`
- `Main visual cuts preserve image/video framing, zoom and fade envelopes at arbitrary and repeated cut points`
- `Visual splits preserve sentence focus links and trusted source subtitles, including later segment reindex and undo`
- `An explicit local transition keeps the original motion clock, and later cuts preserve both clocks`
- `Exact visual piece scope survives reordering and rejects deleted, foreign and mixed targets`
- `Independent cuts preserve full fade and keyframe samples in scene and film clocks`
- `Reviewed source subtitles rebind trim, speed, offset, reorder and undo with original cues and manual translations`
- `Legacy source subtitle bindings admit only reviewed visible range and reject forged roots or unreviewed extension`
- `Source subtitle identity never adopts a deleted stable clip and host translation edits survive later reprojection`
- `Host-approved history restores deleted scene speech/source records and preserves the current export journal`
- `Snapshot approval cannot authorize modified content, foreign owners, another host, cancellation or stale revisions`
- `Unsegmented source bindings never adopt scene IDs and anonymous replacement needs approved history`
- `Explicit silent narration pieces retain source binding and manual captions without implicit replay`
- `Raw Studio updates cannot mint or reset a host presentation origin`
- `Whole-scene split partitions eight visuals directly, freezes original chapters and preserves complete bilingual text`
- `Whole-scene split preserves silent prefixes, exact voice source intervals and original audio receipts through repeated cuts`
- `Whole-scene local layer split retains locked easing, fades and audio source clocks while global tracks stay exact`
- `Whole-scene admission rejects spoofed payloads, unmeasured/bound speech and tiny fragments without changing saved bytes`
- `Whole-scene host operation shares owner/CAS/cancellation and sends one notification only after the atomic write`
- `Whole-scene rejects tiny visual cuts, invalid local objects, held-source cuts and global object overflow atomically`
- `Bound whole-scene split retains original sentence/focus clocks, silent pieces and exact reviewed anchors across repeated cuts`
- `Bound title-card cuts retain original bullet reveal times even in silent prefix and following suffix`
- `Bound source captions partition trusted roots, hidden reviewed cues, edited translation and independent out-of-group cues`
- `Whole-scene source binding rejects ambiguous crossing captions or stale identities before writing`
- `Bound split consumption rechecks actual source/voice hashes and preserves cancellation and CAS after asynchronous reads`
- `Explicit host sentence correction rebases changed playback origin; raw edits cannot mint/reset it and new audio clears it`
- `Experimental review persists bounded proposals as host-owned journals without editing film or accepting raw journal forgery`
- `Review adoption and selective undo retain unrelated edits, generated voice, bilingual captions and export journals`
- `Review blocks stale field/scene/CAS, unauthorized Agent adoption and cancellation atomically with no notifications`
- `Review undo refuses later field edits and deletion; forty-record budget and closed request validation fail without partial writes`
- `Review Assistant uses the same owned full-film request and only proposes concrete individual suggestions`
- `Reference preparation saves source and frame fingerprints as immutable journals without editing canonical scenes or letting update/restore forge records`
- `Native reference receipt mismatch and changed source roll back only newly claimed frames and retain old files/draft`
- `Reference analysis targets actual sampled frames, protects user corrections and requires explicit exact notes adoption while keeping scripts and captions`
- `Reference cancellation and concurrent GUI CAS after native completion wait for rollback without orphan frames or overwriting user changes`
- `Reference Bridge admits real bound PNG bytes and rejects post-service tampering, while closed requests, foreign owners and budgets stay bounded`
- `Reference Assistant pins its prepared identity in the original request and refuses pretending sampled frames are full-video review`
- `User reference management releases the bounded history budget without reading changed media or deleting PNGs, preserves notes/content/history and prevents Agent removal`
- `Reference removal accepts only an owned record identity and revision, never paths, bulk lists or analysis payloads`
- `Scene narration mute retains gain, measured audio, timing and captions through omission, explicit unmute and CAS`
- `Main footage mute resolves stable segment identity without changing source clock, gain or captions`
- `Visual effect edits preserve source/narration clocks, captions and stable targets through trim, split and clearing`
- `Whole-scene splitting moves main footage effects onto derived visual segments without applying them to captions`
- `Material preparation allows zero-scene film scope and preserves real-artifact and stage boundaries`
- `Subtitle review validates finite structured values and readable labels without accepting styles or field coercion`
- `Subtitle review adoption and selective undo retain exact voice, captions, source clock and unrelated edits; unset fields restore unset`
- `shorter regenerated narration preserves authored card highlight clocks and split presentation windows`
- `recording compression preserves a continuous source clock and refuses implicit speech or overlay retiming`
- `late narration completion preserves GUI revision and cleans only its newly created audio`
- `recording macro request admits only explicit hash-bound edits`
- `new recording focus suggestions reject replaced source bytes while retaining the current draft`
- `Complete reference analysis groups commit once and preserve source bytes, scenes and user corrections`
- `Reference analysis groups reject partial, foreign, stale, cancelled, changed-file and open requests without partial writes`
- `Unknown edit discovery returns supported commands and footage replacement route without executing work`

#### `packages/harness-codex/test/codex-backend.test.ts`

- `Codex resumes the same anchor with fresh input scope after an audit and preserves browser-only admission`
- `GPT-6 uses the exact admitted startup catalog when resuming its native Session before dispatch`
- `GPT-6 never starts a native runtime without its admitted startup catalog`
- `Codex admits input after catalog verification, resumes the same provider and normalizes browser/image/message receipts`
- `Codex large escaped success receipts stay valid and bounded without truncating model output`
- `Codex rechecks live authentication and model membership before creating or resuming a native Session`
- `Codex catalog failure never starts the provider or releases a user message`
- `Codex rejects a foreign tool scope and waits for transport cleanup`
- `Codex cancellation racing the input receipt sends one interrupt after the turn becomes known`

#### `packages/harness-codex/test/codex-installation.test.ts`

- `Codex public CLI discovery resolves executable files and an explicit missing installation never falls back`
- `Codex retains only an admitted executable across restarts, with explicit recovery and private bounded pins`
- `A missing Codex installation keeps BMW settings available and rejects input before opening a connection`

#### `packages/harness-codex/test/codex-policy.test.ts`

- `Codex protocol admits verified patch versions and reports detected and supported versions`
- `Codex effective catalog reads Responses and Responses Lite additional_tools, including hidden extra namespaces`
- `Codex accepts a newer shared official model cache without admitting its CLI protocol or extra tools`
- `Codex reads the selected official CLI catalog without trusting or overwriting a foreign shared cache`
- `Codex browser thread excludes environments, shell, MCP helpers and question tools before user input`
- `Codex disables inherited MCP entries without carrying their commands or credentials into thread overrides`
- `Codex discovery instructions derive action names from the admitted browser catalog and survive resume parameters`
- `Codex raw catalog cache avoids repeated refresh but rechecks fingerprints, projection integrity, expiry and cancellation`
- `GPT-6 startup catalog changes only tool metadata and preserves native model capabilities and transport`
- `GPT-6 host catalog is immutable, content addressed and private without modifying the official model cache`
- `Codex protocol rejection names only admitted operation and numeric code, never raw provider text`

#### `packages/harness-codex/test/codex-settings.test.ts`

- `Codex settings project official paginated models and account status without model input or account metadata`
- `Codex never commits a verified model while its native settings process fails to close`
- `Codex selects maintained supported models without user preflight and rejects unsupported catalog entries`
- `Codex browser login completes only for its login ID and admits an official origin`
- `Cancelling Codex login cancels the native operation and never selects a model`

#### `packages/harness-dsh/test/browser-failure-guard.test.ts`

- `repeated infrastructure failures stop only their official Session until next turn`
- `selector errors, success and user cancellation do not trip infrastructure guard`

#### `packages/harness-dsh/test/dsh-backend.test.ts`

- `DSH preparation failures retain cleanup ownership and permit retry only after actual native drain`
- `DSH rejects malformed native membership before creating a Session or submitting input`
- `DSH stop retains the native process until an actual exit event, including legacy lifecycle callers`
- `DSH child errors cannot masquerade as physical cleanup and a later exit permits recovery`

#### `packages/harness-dsh/test/dsh-events.test.ts`

- `DSH pre-input admission uses the exact scoped model catalog and immutable Project identity`
- `DSH durable events retain tool IDs and text without leaking image bytes or thinking`
- `DSH official prune replacements do not complete or duplicate live browser calls`
- `DSH rejects orphan, mismatched and live-call prune replacements`

#### `packages/harness-dsh/test/dsh-migration.test.ts`

- `legacy display imports human/model text without context, summaries, private reasoning or pixels`
- `cold DSH migration reads all backward pages at one cursor and preserves archived/parent identities`
- `missing native bindings and pagination without progress fail instead of choosing another Session`

#### `packages/harness-dsh/test/dsh-preset.test.ts`

- `installs and safely updates only the BMW DSH preset`
- `does not overwrite a preset directory not owned by BMW`
- `isolates product state and privately seeds credentials without shared writable links`
- `keeps BMW as theme source without overwriting unrelated DSH settings`

#### `packages/harness-dsh/test/dsh-runtime.test.ts`

- `DSH calls use the harness RPC envelope and validate the response`
- `DSH project activation creates a project-scoped BMW session`
- `DSH project activation reuses its persistent project session`
- `BMW Session Center lists only active sessions in its Project and searches content`
- `BMW creates new DSH sessions with the browser-only preset`
- `DSH prompt submission preserves exact input and returns every Assistant output in order`

#### `packages/harness-dsh/test/dsh-settings.test.ts`

- `Owned DSH initialization privately copies provider credentials and never rewrites their source`
- `A dangling legacy DSH credential link fails closed before official writes can follow it`
- `DSH settings use official redacted control APIs and preserve exact model routes`

#### `packages/harness-dsh/test/dsh-transport.test.ts`

- `DSH launch authentication accepts only the owned origin and token`
- `DSH requests preserve named arguments and correlate prompt admission`
- `DSH WebSocket snapshots authenticate, cancel streams and reject mismatched frames`
- `BMW keeps exactly browser while delegating MCP execution and cleanup to DSH`
- `DSH command discovery normalizes the official array response and sends authentication`
- `BMW scoped registry checks execution identity without changing model arguments or native execution context`

#### `packages/harness-dsh/test/project-bindings.test.ts`

- `DSH owns immutable native Workspace mappings while BMW Projects retain only their own identity`

#### `packages/harness-dsh/test/video-case-log.test.ts`

- `video case export preserves prompts and observable reasoning while redacting credentials and inline media`
- `video case export reads complete paginated history and rejects duplicate or missing event sequences`

#### `packages/harness-dsh/test/workspace-context.test.ts`

- `DSH Studio assembly preserves the prompt, sole tool and existing context while replacing stale selection`

#### `packages/harness-qoder/test/qoder-backend.test.ts`

- `Qoder releases UUID-stamped user input only after the effective catalog and binds provider resume identity`
- `Qoder preflight failure closes its worker without consuming input or falling back to a new Session`
- `Qoder cancellation retains failed native cleanup ownership and recovery never resubmits input`
- `Qoder denies an unexpected permission request without interrupting a browser-only turn`

#### `packages/harness-qoder/test/qoder-events.test.ts`

- `Qoder effective initialization rejects builtins, foreign MCP, inherited plugins and unsupported runtime`
- `Qoder content blocks sharing a model message ID retain distinct tool/text identities and stream one reply`
- `Qoder unexpected tools, unfinished calls and mismatched streaming prefixes fail closed`
- `Qoder split MCP image result stays in the native context and cannot complete a foreign call twice`

#### `packages/harness-qoder/test/qoder-settings.test.ts`

- `Qoder settings discover the official models with no persistent session or released user input`
- `Qoder selection checks the official model catalog and does not persist a disabled model`
- `Unexpected Qoder model work in a settings control session fails before preference writes`
- `Qoder preference commit waits for actual cleanup and a failed close retains recovery ownership`
- `Qoder cold zero-turn login failure exposes login controls; execution results are still rejected`

#### `packages/harness-workbuddy/test/workbuddy-acp.test.ts`

- `WorkBuddy ACP redacts provider errors, rejects pending calls and awaits child close`
- `WorkBuddy cleanup waits for its owned MCP child process group`
- `WorkBuddy malformed transport output never echoes raw credential-bearing text`

#### `packages/harness-workbuddy/test/workbuddy-backend.test.ts`

- `WorkBuddy gates before input and cleans its ephemeral credential Home`
- `WorkBuddy rejects a failed catalog before releasing user input`
- `WorkBuddy serializes slow host events before terminal completion`
- `WorkBuddy fails closed on foreign tools and never fabricates a receipt`
- `WorkBuddy emits paired browser events and rejects reused tool ids`
- `WorkBuddy reports native model failures as failed and keeps Key configured`
- `WorkBuddy retains failed cleanup ownership until explicit drain succeeds`
- `WorkBuddy quarantines a failed preflight cleanup without automatic recovery`
- `WorkBuddy keeps stable native resume binding and rejects another BMW owner`
- `WorkBuddy rejects foreign session permissions before granting browser access`
- `WorkBuddy owns preparation before waiting on the catalog gate`
- `WorkBuddy cancellation cleanup failure is not retried by outer finalization`

#### `packages/harness-workbuddy/test/workbuddy-catalog.test.ts`

- `WorkBuddy effective catalog gate rejects extra tools, wrong identity/schema/model and zero-tool evidence`

#### `packages/harness-workbuddy/test/workbuddy-policy.test.ts`

- `WorkBuddy isolates launch environment, tool overlay and settings`
- `WorkBuddy admits only exact BMW tool identities and single permission channel`
- `WorkBuddy catalog MCP declaration has no executable Session binding`
- `WorkBuddy native model failure cannot masquerade as end_turn success`

#### `packages/harness-workbuddy/test/workbuddy-settings.test.ts`

- `WorkBuddy encrypts keys, isolates permissions and preserves unreadable credentials`
- `WorkBuddy settings distinguish configured from real task verification without inference`

#### `packages/media-native/test/capture-source-index.test.ts`

- `Capture WebM retains explicit terminal VFR duration without a nominal frame-rate grid`
- `Capture WebM preserves a terminal Opus packet with unknown duration while rejecting zero-duration video`
- `Source PTS indexes reject file-clock substitution, unobserved gaps, stale media/PNGs and foreign Projects`
- `Mapped captures select middle frames through pause and variable rate, verify decoded PTS and roll back failed PNGs`

#### `packages/media-native/test/media-controller.test.ts`

- `Shared decoding FIFO drains active cleanup, skips cancelled previews and survives failed jobs`
- `Shared decoding cleanup failure quarantines queued work until explicit recovery succeeds`
- `Shared decoding FIFO bounds admission and preserves queued operation order without replay`
- `browser-native video capture filenames remain Project-local WebM artifacts`
- `video chunk decoding ignores commas inside codec parameters`
- `capture IPC admits only the current media main frame`
- `Selected-video cancellation drains late initialization and removes only its new file`

#### `packages/media-native/test/media-port.test.ts`

- `Native media reply admission rejects host paths, fabricated durations and malformed tracks`
- `Inspected video track range is finite and lies inside measured media, allowing an AAC tail without extending video`
- `audio endpoints use the same finite source-clock validation as video`

#### `packages/media-native/test/media-preservation.test.ts`

- `HLS preservation selects explicit media, resolves relative URLs, and rejects live/encrypted/ranged/gapped input`
- `HTTP preservation keeps exact delivery bytes and hashes, never claims the author original or full video range`
- `Preservation fails closed and rolls back all owned resources on unsupported playlists, partial responses and cancellation`
- `Separated transfer refuses partial/missing audio, identity mismatch and truncated responses, retaining existing artifacts`
- `Failed preservation cleanup stays recoverable without following a replaced Project directory`
- `Long storage and bounded decoding have independent budgets and segment contracts`
- `HTTP archive writes incrementally before EOF and rolls back a truncated stream`

#### `packages/media-native/test/media-processing.test.ts`

- `media actions require artifact IDs and reject unbounded or ambiguous processing requests`
- `media worker admission rejects missing frames, forged timestamps and unexpected output codecs`
- `media job I/O pins the Project input and rejects links, out-of-range reads and writes`
- `media jobs roll back partial artifacts and commit only validated PNG outputs`
- `media export refuses missing audio, discarded tracks and duplicate track mappings`
- `media processing rejects transparent video instead of silently changing its colors or alpha`
- `Image admission rejects non-raster, huge or animated headers before decode and bounds cumulative pixels`
- `Image drawing admits bounded primitives and rejects executable, outside, transparent-redaction and aggregate inputs`
- `Drawing output IO has no input, bounds PNG writes and rolls back failed dimensions without changing existing images`
- `Drawing validation identifies wrong action fields and nested property paths without exposing values`
- `complete motion evidence detects static video, changes, decode gaps and missing boundaries without semantic approval`

#### `packages/media-native/test/precomposition.test.ts`

- `Sixteen-cell proxies use sequential four-decoder blocks with explicit source intervals, identity and audio policy`
- `Proxy cancellation waits for owned native work and removes only intermediate/output artifacts; directory replacement quarantines cleanup`

#### `packages/media-native/test/research-diagrams.test.ts`

- `Event tables remain deterministic across reverse seek and retained-clock cuts; groups and event targets are bounded`
- `Measured charts use independent values, sourced series and explicit linear/log axes without normalization or clamping`

#### `packages/media-native/test/science-spec.test.ts`

- `Scientific diagrams are bounded data; schema admits defaults and runtime enforces cross-field relations`
- `Curve growth, tip and units retain one physical data state across edits and reverse/source-clock seeks`
- `Ratio sectors, current values, percentages and totals come from the same dataset and progress`
- `Path head, flowing dots and depth readout share a seek-safe clock without hidden simulation history`
- `Thirty-seven array objects retain identity and group totals while geometry interpolates and data changes`

#### `packages/media-native/test/speech.test.ts`

- `interval speech preserves normalized and original source clocks and rejects unmeasured or oversized ranges`
- `Speech requests admit fixed models and Project artifacts, never executable, cache, prompt or CLI options`
- `ASR parser preserves out-of-audio/overlapping boundaries and token probability without claiming word accuracy`
- `Speech evidence rejects fabricated approval, foreign hashes, frame clocks and silently cleared warnings`
- `Completed ASR may report zero recognized segments while retaining measured audio and raw evidence provenance`
- `Speech mapping uses actual source trim/rate, narration offset and cumulative film time without clamping hidden anchors`
- `Speech normalization replies require actual bounded sample provenance`
- `Normalized WAV outputs reject fake headers/sample counts and preserve original Project input`
- `Speech subprocess cancellation waits for termination before rejecting and cannot leave a late output`
- `Speech subprocess rejects bounded log overflow and version/runtime failures after child settlement`
- `Speech fingerprints reject replaced artifacts even when an already-open descriptor still has the original bytes`
- `Speech subprocess keeps UTF-8 log characters intact across raw pipe chunks`
- `Speech language is an explicit fixed choice and English or automatic ASR retains source language`
- `Opus final packet padding is bounded and recorded without moving the original audio clock`
- `A single AAC buffer crossing source zero may retain bounded preroll evidence without skipping source time`

#### `packages/media-native/test/video-element-capture.test.ts`

- `Video EOF evidence survives prior page replay handlers at 8, 15, 30 and 60 second endpoints and restores position with playback paused`
- `Synthetic EOF and premature trusted EOF cannot claim completion; limited captures retain measured progress`
- `Seeking during capture fails instead of claiming continuous whole-video coverage`
- `Native source frames bind encoded file PTS, freeze updated duration and close every frame`
- `Pre-initialization scope rejection drains without quarantining an inactive capture or retaining temporary files`
- `A capture from a seeked position excludes cached frames before its admitted source interval`
- `A target identity change before the next frame rejects capture before encoding that frame`

#### `packages/media-native/test/video-options.test.ts`

- `video ratios map to bounded even landscape portrait and square resolutions`
- `explicit video overrides beat template snapshots and defaults with nested watermark merge`
- `video templates and styles reject duplicate names arbitrary controls and oversized watermarks`

#### `packages/media-native/test/video-production.test.ts`

- `Finite entry packaging preserves source clocks and bounded perspective under reverse seeks`
- `Text reveal preserves graphemes and full-layout lines under arbitrary seeks and sliced clocks`
- `Phone reading pans the entire pinned source at readable estimated size and stays on the original sentence clock`
- `Whole-to-detail phone reading locates then zooms a complete target, holds still and returns on the original clock`
- `Editable sequence diagrams validate all four sentence targets and reject unbounded or mismatched input`
- `quality samples use actual film frames across fractional cuts, focus peaks and capped caption transitions`
- `phone review catches painted label clipping and collisions while sparse static observations remain qualified`
- `anchored reading keeps exact source rectangles and original presentation time with explicit whole/detail returns`
- `Shared caption wrapping avoids automatic single-Han tails without changing explicit breaks or numeric tokens`
- `English connector wrapping retains speech words and explicit breaks without an automatic on orphan`
- `Caption backing contrasts with the actual foreground rather than always using black`
- `Whole caption blocks reserve padding and keep multilingual rows inside the same safe layout used for preflight`
- `Native paint observations catch backing overlap, late backgrounds and attribution collisions without flagging intentional caption backing`
- `Card wrapping keeps closing brackets with percentage numbers and preserves all text`
- `Detailed cards keep readable theme colors and separate close numeric threshold labels in both aspect ratios`
- `detailed cards pin actual source bytes, reject changed sources, bound geometry and keep dedicated assets in decode budget`
- `reading recipes keep whole/detail dwell and bounded scale; range semantics reject invented proportion and invalid ordering`
- `news layout rejects unsupported shapes and misleading coercion and checks its real text budget`
- `eight card categories admit their actual assets and reject unsupported content without dropping it`
- `closed card presets retain exact numeric representation and seek on original scene clocks`
- `seekable composition validates Project IDs, bounds and real narration assets`
- `narration fixes provider and voices and rejects SSML control or arbitrary endpoints`
- `composition output handle rejects input reads and cleans partial output on cancellation`
- `Selected source sound trims, retimes, scales mono and stops at its endpoint and scene boundary`
- `Caption and source audio contracts stay closed and captions estimate within scene-local time`
- `Visual segments admit bounded clips, preserve scene time and expose deterministic fade boundaries`
- `SRT and VTT use global cumulative milliseconds, respect disabled captions and label estimated timing`
- `Bounded Project text export cancels and removes its own output without replacing existing artifacts`
- `Source focus retimes through trims and segments and keeps framing inside the original crop`
- `Recording evidence has a closed clock/coordinate domain, filters pre-roll and groups real and Agent clicks honestly`
- `Title-card reveal has bounded scene-local times, exact bullet identity and no footage; legacy bullets stay immediate`
- `Bilingual SRT and VTT select original, translation or both without changing timing`
- `Fixed templates validate bounded colors/content and reject text overflow before encoding`
- `independent layers validate identities, Project references, ranges and video decoder overlap`
- `explicit layer keyframes interpolate geometry and fading without changing base values`
- `streamed source audio supports bounded fade gain without samples outside the selected interval`
- `Restricted easing admits only closed increasing domains and stays stable near curve endpoints`
- `Visual effect clocks are finite closed bounded data with unique piece identities`
- `Closed independent fade windows admit short preserved pieces and reject invalid original clocks`
- `Original presentation windows validate root bounds and preserve counters after repeated cuts`
- `Native narration receipts distinguish source duration from short and silent playback pieces`
- `Visual effects are closed finite numbers shared by scene footage, segments and independent objects`
- `published card schemas and runtime agree on reading mode and actual visual binding`
- `recording suggestions cover every source frame and reserve wait compression for complete measured events`
- `loupe keeps base framing while its source clock follows trims and rate changes`
- `quality observation bounds memory while preserving every actual paint and restoring the native method`
- `Qwen narration uses its news voice and rejects cross-provider choices and model controls`
- `Qwen native adapter sends the fixed Beijing model and rate, retrieves bounded WAV without credentials or redirects`
- `Qwen rejects untrusted download origins, missing credentials, provider errors, excessive bytes and invalid WAV without retries`
- `Qwen cancellation cancels an in-flight audio body and does not retry synthesis`
- `Portrait fullscreen footage clears animated headings and every bottom-caption block without moving at cue changes`
- `Portrait heading painting uses shared paragraph wrapping and avoids an automatic isolated Han character`

#### `packages/media-native/test/youtube-sabr.test.ts`

- `SABR admission binds the actual binary POST configuration and formats to one finite YouTube target`
- `Complete default-language format selection respects 1080p, archive and reserved-disk budgets`
- `UMP validates fragmented media identity, exact segment length and complete separate tracks`
- `UMP rejects foreign video/version/track, truncated media and changed duplicate segments`
- `First and last segments cannot hide a missing or overlapping middle interval`
- `Cancellation terminates a protocol worker in server backoff and retains existing Project files`
- `Bootstrap POSTs may omit preferred tracks, but initialization/buffered formats cannot name foreign versions`
- `A failed native drain quarantines only this acquisition until explicit cleanup recovery succeeds`
- `A server attestation request may reuse only a newly observed same-player token, without persisting it`
- `A server refresh cannot change the target or selected format version before another POST`
- `Native attestation refresh refuses a different playback nonce even for the same video`

#### `packages/platform/test/agent-history-store.test.ts`

- `Historical native capture identity survives restart only with paired admitted calls and unchanged capture-index bytes`
- `display history survives restart, keeps bounded ordered streaming and cannot replace submission receipts`
- `history never admits foreign, out-of-order or terminal-late events and preserves corrupt saved files`
- `explicitly ending an unknown receipt preserves evidence, active interactions and restart audit without replay`

#### `packages/platform/test/agent-host.test.ts`

- `Agent input and BMW Session appear before connection; failed catalog preflight never releases the prompt`
- `provider terminal notification does not finish the receipt or release FIFO before browser drain`
- `cancel waits for the active browser tool to drain and cancels queued input without sending it`
- `cancelling another queued Session returns while the active Session keeps its browser resource`
- `failed drain quarantines resources; recovery cleans up without replaying uncertain input`
- `transport failure after acceptance keeps the delivery uncertain without inventing success or replay`
- `late or duplicate tool callbacks fail the run rather than moving admission forward`
- `a queued Session cannot execute in a different Project after selection changes`
- `approval response requires the current Project, active run and an offered choice`
- `provisional completion followed by provider failure never persists a finished receipt`
- `failed native cleanup holds admission even after browser drain and recovery never replays input`
- `late callbacks cannot resurrect an uncertain submission after its native transport settled`
- `queued Studio requests freeze their explicit context and expose it only to the active owner`
- `Background collection yields to user input; FIFO waits for its actual drain and targets no later user receipt`
- `Failed cleanup of a yielded background input quarantines the queue until explicit recovery, never replays it`
- `Pinned inactive Project/Session background inputs preserve selection and yield to the foreground only after actual drain`
- `Background interaction requests become uncertain receipts without exposing a foreground interaction or replaying input`
- `targeted user cancellation ends drained unknown without interrupting a newer run in the same Session`
- `unknown resolution cannot bypass failed native cleanup quarantine`

#### `packages/platform/test/agent-settings-controller.test.ts`

- `Settings cancellation retains Host exclusion until actual cleanup and never exposes provider secret errors`
- `Settings cleanup failure quarantines admission; recovery retries only cleanup`
- `Model preferences survive Project selection writes and stay separate for every driver`
- `Repeated settings refresh shares the native read through cleanup; mutations and other drivers stay excluded`
- `Profile settings cache reuses each driver across Projects, marks ages independently and never admits native work on view`
- `Settings mutations replace cache after cleanup; partial failure and cancelled reads never publish fresh readiness`

#### `packages/platform/test/assistant-controller.test.ts`

- `Feature activity exposes owned runtime event facts, clears completed tools and blocks dispatch until actual cleanup is released`
- `Assistant controls persist per-Project driver selection, reject foreign Sessions and exclude transitions during a turn`

#### `packages/platform/test/assistant-tasks.test.ts`

- `Internal review queues behind its caller, persists trusted task metadata, deduplicates and waits for real cleanup`
- `Internal review refuses unverified catalogs, changed models and uncertain delivery without replay`
- `Only an explicit new start after interrupted cleanup gets a fresh input; uncertain and active receipts never replay`

#### `packages/platform/test/background-admission.test.ts`

- `Background admission uses real resources, permits an idle Studio and never preempts work or cleanup`
- `Waiting collection and hourly phases alternate at idle boundaries, expire withdrawn demand and retain foreground priority`

#### `packages/platform/test/background-collection.test.ts`

- `Background action admission bounds originals, refuses side effects and revalidates the lease before work`
- `Passive library refreshes preserve background work; user mutations and work requests preempt it`
- `Background discovery publishes only admitted actions and exact operation branches`

#### `packages/platform/test/bmw-catalog.test.ts`

- `BMW exposes research/media actions and the Video extension boundary`

#### `packages/platform/test/browser-user-agent.test.ts`

- `page user agent exposes Chromium without Electron or BMW shell tokens`
- `page user agent strips every BMW product brand and preserves standard Chrome`

#### `packages/platform/test/continuity-state.test.ts`

- `Unreadable login configuration or ciphertext blocks background saves and leaves original bytes intact`
- `Login-state read failures preserve both files and explicit repair/reload resumes initialization`
- `Encryption becoming available never replaces a snapshot that could not be decrypted`
- `Valid legacy login configuration and encrypted cookies restore without rewriting files; missing files initialize safely`
- `Encryption becoming available restores valid saved cookies before a background capture can replace them`
- `Periodic login maintenance handles late decryption failure without an unhandled rejection or write`

#### `packages/platform/test/conversation-store.test.ts`

- `blank BMW Sessions are durable and visible before either external Agent starts`
- `provider identities cannot silently rebind or cross Project ownership`
- `restart marks incomplete executions disconnected without replaying or losing their resume anchor`
- `foreign, running and archived Sessions cannot be selected or reordered across their boundaries`
- `unreadable saved indexes and a second stale writer never overwrite existing state`

#### `packages/platform/test/driver-boundary.test.ts`

- `Project storage rejects native provider mappings without rewriting Project documents or saved bytes`
- `Global settings require the current format and reject retired sidebar fields without an automatic conversion`

#### `packages/platform/test/feature-contract.test.ts`

- `Feature lifecycle admits named hooks and propagates activation failures before wiring`
- `Product composition freezes one BMW feature set and rejects duplicate identities and extra tools`

#### `packages/platform/test/global-settings-store.test.ts`

- `global settings default to system proxy and Google search`
- `global settings persist manual proxy and generate selected search URLs`
- `global appearance accepts one shared dark, light or system theme`
- `Current settings reload preserves appearance without a native Agent sidebar setting`
- `custom search templates require HTTP(S) and a query placeholder`
- `proxy settings apply to the persistent BMW browser session`
- `online narration defaults enabled and retains explicit boolean opt-out`
- `Qwen online narration is opt-in and validates saved consent`

#### `packages/platform/test/layout-docking.test.ts`

- `floating DSH docks when its upper-right corner reaches the target corner`
- `floating DSH does not dock near only one target edge`
- `dock detection rejects invalid window bounds`
- `Studio chat docks in the measured property area and free movement remains above the timeline`
- `Studio initial float avoids selected pixels and reserves resources; manual position stays authoritative`
- `Studio free float reserves actual transport while docking still uses the complete property area`
- `Studio automatic float fits a wide selected object and pins its chosen height across later selection and manual movement`

#### `packages/platform/test/layout-store.test.ts`

- `layout setup is required once and defaults to the sidebar`
- `floating DSH settings persist with bounded size and supported opacity`

#### `packages/platform/test/library-sources.test.ts`

- `Foreign and archived Project discovery never creates source directories or repairs missing resources`
- `Pinned collection lookup avoids catalog windows and a lost lease rolls back asynchronous source admission`

#### `packages/platform/test/menu-policy.test.ts`

- `builds safe webpage filenames and selects complete or single-file saves`
- `recognizes keyboard menu activation without stealing modified page shortcuts`
- `recognizes only the platform save-page accelerator`

#### `packages/platform/test/permission-policy.test.ts`

- `denies noisy ambient site permissions without prompting`
- `prompts once only for sensitive browser capabilities`
- `allows harmless presentation capabilities silently`

#### `packages/platform/test/permission-store.test.ts`

- `Agent grants/revocation and origin-specific allow/deny decisions survive reload without sharing mutable state`
- `Permission persistence failure leaves the prior file and in-memory grant unchanged`

#### `packages/platform/test/product-boundaries.test.ts`

- `BMW repository builds one app with a native Video foundation`
- `feature action collisions fail before Electron startup`
- `shared implementations never import apps; only the app selects an Agent driver`
- `BMW catalog retains one browser tool and its expected action boundary`

#### `packages/platform/test/project-panel-layering.test.ts`

- `an open Project Manager is re-raised after browser tab views change`

#### `packages/platform/test/project-source-store.test.ts`

- `Body metadata witnesses persist beside originals while old acquisitions stay unchanged and invalid witnesses cannot be admitted`
- `Source text content deduplicates across URLs while acquisitions, missing dates and candidate confirmation remain independent`
- `Concurrent source commits and cancellation after writing remove only current text outputs`
- `Source corrupt state, mutated original text and symlinked artifacts fail closed without overwriting evidence`
- `Closed source requests reject missing ranges, credentials, injected file receipts and fictional fact-check status`
- `Current source media and proof hashes report missing/changed/linked/legacy evidence without rewriting acquisition history`
- `Capture requests require a video selector and measured source evidence cannot cross the confirmed range or claim platform completeness`
- `Delivery preview is a closed preserve-only interval and cannot claim a capture or exceed the short preview budget`
- `Host video identities round-trip in candidates and capture witnesses while legacy sources remain readable`
- `Text-read codec rejects body injection, mismatched evidence, unsafe diagnostic URLs and oversized replies`
- `Text-read checkpoints durably preserve pending, failed and incomplete rows with fixed revisions and CAS`
- `Text-read immutable checkpoint corruption is rejected without rewriting authoritative files`
- `Discovery checkpoints preserve excerpt domain and cannot be promoted to full-text batches`
- `Automatic finite video acquisition requires a confirmed-player selector and rejects archive preview options`

#### `packages/platform/test/project-store.test.ts`

- `requires the first real Project name without leaving a default BMW Browser project`
- `does not send existing BMW installations back through first-project setup`
- `creates, switches, updates and archives projects without deleting their files`
- `new projects accept an empty home URL and use a blank-page preference`
- `agent append is limited to memory documents and records provenance time`
- `tab state keeps only bounded HTTP(S) URLs`
- `Project persistence contains only BMW ownership and keeps independent documents across reload`
- `Project tab ownership persists without reclassifying research pages as user pages`

#### `packages/platform/test/qwen-credentials-store.test.ts`

- `Qwen credentials persist encrypted with private permissions and only a Shell status projection`
- `Qwen refuses weak encryption and preserves existing ciphertext on encryption/decryption failures`
- `Corrupt or linked Qwen ciphertext remains intact until explicit clear; secrets and arbitrary endpoints are rejected`

#### `packages/platform/test/record-capacity.test.ts`

- `Sources exceed both legacy catalog limits, preserve the baseline, pin pages during new collection and rebuild every indexed revision`
- `Published source evidence survives a directory durability warning; pre-commit cancellation and corrupt journals never remove prior work`
- `Stable filtered scans report empty intermediate pages, reject foreign cursors and preserve authoritative data when caches disappear`
- `A cache torn after record publication keeps the new original and resumes through a new preserved generation`
- `A legacy page cursor keeps its baseline after the first sharded write, including navigation back to the first page`

#### `packages/platform/test/remote-control-boundary.test.ts`

- `default products reject chat connector actions and retain one browser tool`
- `default desktop exposes no chat connector UI, IPC or automatic relay startup`

#### `packages/platform/test/restart-policy.test.ts`

- `allows restart when BMW has no active non-durable work`
- `blocks restart while media or scheduled tasks are active`

#### `packages/platform/test/scheduled-task-store.test.ts`

- `daily scheduled tasks use their IANA time zone and survive restart`
- `scheduled task runs are project isolated, durable, and recover interruption`
- `scheduler serializes due and manual Agent task execution`
- `Schedules require explicit driver ownership and unbound tasks can only be enabled after a BMW binding`
- `trusted hourly cadence persists, bounds its interval and coalesces missed hours without replaying an active run`
- `busy video defers hourly scheduled execution, preserves queue time and never starts duplicates`
- `Scheduler diagnostics cannot fail a task or expose raw error text`

#### `packages/platform/test/session-continuity.test.ts`

- `encrypts and restores session cookies only for explicitly enabled origins`
- `disabling continuity removes the encrypted snapshot without clearing live cookies`
- `background keepalive uses HEAD first for an enabled origin`
- `background keepalive falls back to a bounded GET when a site rejects HEAD`
- `cookie matching includes parent-domain cookies but excludes unrelated sites`

#### `packages/platform/test/shell-ipc.test.ts`

- `Shell IPC admits only its trusted live main frame before invoking any privileged handler`

#### `packages/platform/test/state-load.test.ts`

- `Existing malformed and unsupported state never becomes a first-run replacement`
- `State read failures preserve the file and reject writes for all startup stores`
- `Missing state initializes once and BMW Project identity, documents and explicit task ownership survive reload`
- `A failed layout reload blocks updates until explicit repair without overwriting its original bytes`

#### `packages/platform/test/workspace-runtime.test.ts`

- `Host activates both independent workspaces, dispatches visibility and context, and awaits all cleanup`

#### `scripts/agent-assembly.test.ts`

- `BMW composes all four official backends through the neutral Host contract without starting them`
- `BMW default composition derives profiles from its overridden userData and rejects physical aliases`

#### `scripts/agent-data-migration.test.ts`

- `Explicit migration preserves display history, stable owners and native anchors including removed archived Workspaces`
- `Migration rejects missing native anchors and foreign Studio ownership before any state writes`
- `Failed multi-file migration restores original bytes and leaves the old Profile requiring explicit migration`
- `Migration detects stale plans and rollback preserves a concurrent edit rather than overwriting it`
- `Current Profile creation and mutation locks never silently accept or initialize an old Profile`
- `Explicit migration preserves native-only selection, infers schedule driver from BMW ownership and detaches credential links`
- `Migration refuses to overwrite an existing different harness Workspace mapping`

#### `scripts/test/module-boundary.test.ts`

- `Every authored module uses declared public interfaces, acyclic runtime dependencies and classified guarantors`
- `Dependency guard rejects private imports, driver leakage and privileged renderer imports even when the target exists`
- `Unclassified tests and missing interface guarantors cannot silently lose coverage`
- `Architecture rejects production-to-test indirection, bare Node renderer imports and unbounded production loaders`
- `Normal harness startup cannot import the explicit migration entry`

#### `scripts/test/test-selection.test.ts`

- `Desktop workspace runs once and library edits retain the existing workspace coverage`
- `Renderer read change selects its direct/consumer guarantees and background runtime without unrelated codecs or speech`
- `Public contract changes include consumers; deleted/unknown/config changes fail toward full offline coverage`
- `AST dependency analysis recognizes multiline aliases, exports and dynamic imports while ignoring comment/string decoys`
- `Git selection preserves both rename paths, staged/uncommitted deletions and untracked files`
- `Browser interfaces use the neutral model-side driver fixture while DSH integration follows implementation and assembly scope`
- `Runtime validation helper changes select every dependent entry without pulling concrete DSH into Browser contracts`
- `Image decoding and visual segment contracts select their actual Studio and native runtime checks`
- `Drawing implementation and public image actions select native pixel checks and model-side MCP coverage`
- `Studio cover changes remain affected-only while retaining native/runtime and safety checks`
- `Studio effects, mute and object-state implementation changes retain their native GUI/export guarantors`
- `Every Studio smoke environment branch is admitted by a classified runtime entry`
- `Media audio evidence changes select the native processor that invokes media.audio.sample`
- `Studio shared timeline, renderer and codecs retain dedicated branch and schema publication guarantees`
- `Dedicated Studio editors and the current Assistant preload retain their runtime checks`
- `Every product source has functional test ownership and every exact watch path exists`
- `Workspace manifest changes stay on the conservative full-coverage path`
- `A timed out test that handles SIGTERM and exits zero cannot be reported as passed`

#### `scripts/workbuddy-runtime.test.ts`

- `WorkBuddy official runtime gates real browser schema, executes browser and resumes the immutable provider Session`

<!-- END GENERATED CAPABILITY AND TEST INVENTORY -->

## 制作条件覆盖字段的解释

StudioReadiness.scenes 的 availableSeconds／gapSeconds 来自 sceneCoverage，表示画面素材覆盖，不是音频解码或静音检测。纯文字卡片不能仅凭 gapSeconds 判定缺少旁白；旁白状态通过 narration-stale、audio-duration 等检查，实际听感仍需独立核听。实现见 feature-video/src/studio-contract.ts 的 sceneCoverage／draftReadiness。

## BMW 内部成片审核

唯一 `browser` 新增闭合动作 `video.review`。`reviewRequest` 的 `start` 仅接收当前所属 `draftId/expectedRevision`；`status` 仅接收 `runId` 及可选 `pageOffset`（0–96），每页至多8镜。模型不能提供 driver/model、actor、路径或通过结论。Studio 的“实际成片 · 手机尺寸审片”提供同一内部审核入口和手动刷新结果，不替用户勾选试听或验收。

Host 先验证当前 Project/Session、revision、可复用实际 MP4、原生验证报告与指纹，再把固定审核说明排到原 Session 的官方 AgentHost FIFO。模型选择沿用该 Session driver 的设置；回执记录请求时的显式 modelId 或 null（官方默认选择，不是具体服务端模型证明），显式模型在执行前变化则拒绝。准备阶段继续核验有效目录只有 BMW browser，且官方 runtime 支持图片。Host 只提交一次输入，不实现推理或工具循环，不增加第二个模型/MCP工具。

start 返回后调用方必须结束当前 turn，不能占住前一任务等待审片。Host 在已有 version2 输入回执中先保存可选 task 元数据（闭合 kind=video-review、SHA256 key、至多8192字符 payload、modelId）；输入和元数据一同原子持久化后才排队。去重键绑定策略版本、草稿 revision 和实际成片指纹；同目标重复请求复用原回执，包含已失败／中断／不确定状态，不自动再次投递。内部审核不能递归新增内部任务。现有 Assistant 停止入口取消所属 Session 的任务，并等待实际工具和 worker 清理；失败清理仍隔离资源。Project/Session 转换、归属、未知投递恢复和 FIFO 不变。

审核指导要求所有场景的当前 MP4 关键状态分页重新实际查看，逐镜记录并独立作整片判断；覆盖视觉支撑、信息密度、层级、节奏、结尾、手机字幕、来源身份日期、新闻事实、书面稿、保留原声与译文，并对实际最终 MP4 采样音频、按可用能力核对 ASR。策略v2追加上述AI受众、45秒／120秒目标、术语简释、原声与有据解读、画面类别实际区间及相关性／比例、全片禁止纯文字段落；不可凭模板名推定通过，不可编造比例。新任务去重包含策略v4，旧v1/v2/v3回执仍可查询但不能替代新标准的审片。缺失、低置信度、抽样边界及能力缺口必须报告。Agent 审核不是连续音视频感官认证，人工听感和用户验收另记。

成片审片 version2 账本的 Agent assessment 可附 Host 绑定的 runId，普通模型请求不能提供。内部通过需要本次 run、晚于启动基线的全部逐镜及独立整片声明、当前样本完整、原生技术通过、任务成功且真实清理结束。历史声明、其他 run 声明、运行时成功或 PNG 生成本身不能成为本次通过；稿件 revision／实际 MP4 变化返回 stale。status 的结构结果保留原生技术、版式、Agent 和用户声明并分页返回完整意见；缺少本次结论为 incomplete，失败和 uncertain 不包装成通过。

制作避免项：结尾不能长期停在孤立文字、空旷底色，尤其不能连续两张基础文字卡收尾。至少应提供相关真实画面／证据图或流程、对比、时间线等视觉信息；装饰和文字飞入不算支撑。原生结构筛查对最后两镜中持续至少3秒、无主素材／有意义画面图层且为默认或 title/basic 的卡片标记 needs-fix，拒绝 Agent 的相关镜头／整片通过声明；它是结构风险规则，不是像素语义认证，用户声明独立保留。其他模板通过筛查仍需实际视觉审核。DSX POD 的部署条件与未来交付计划不能只用两张白底文字卡表达，详见 NEWS_DAILY。

内部审片活动期间，Host 标识实际审核 run，Video 动作在执行层拒绝 Agent 修改草稿／素材描述、合成、旁白、设置和递归审片；仍允许读取、原生取帧／语音证据及成片审核账本。审片的只读上下文仅约束当次输入，完成或取消并实际清理后失效；后续用户授权的制作／返工使用新的当次输入上下文。Codex 恢复同一不可变原生锚点时，通过官方 thread/inject_items 将当次开发者上下文追加到已保留的原生历史之后，明确替换先前输入的任务限制；只传 resume 参数不足以覆盖历史开发者条目，不能据此声称修复。注入失败即停止输入，不建立新锚点，避免已结束的审计角色阻止返工；此说明不替代工具目录准入或 Host 运行期权限。用户 GUI 编辑不受此模型限制，继续走原 CAS 并使审核目标失效。入队后立即返回持久回执，不在返回回执前再次异步读取，以免 GUI 并发编辑掩盖已投递任务。人工试听状态来自当前独立用户整片声明，不由 Agent 代签。

新闻流程的当前编辑要求与复核见[新闻制作流程复核](plans/NEWS_PRODUCTION_RESET.md)：普通快讯默认中文串讲加约8–15秒完整原声；末镜原生动态图解属于允许的编辑形式，但绑定草稿版本的逐态预览证据尚待实现，当前未据声明放行，见[图解准备方案](plans/NATIVE_DIAGRAM_PREPARATION.md)。

- 文字快扫：`pages.read` 仅接受1–60个显式HTTPS地址，固定3个隔离原生页面；单页导航8秒、整批180秒，截止与取消等待真实清理，不操作用户页或获取媒体。逐页保存Project原文及来源ID，返回有界文字/可见链接与受限、失败、未完成计数；账号页快照不等于完整动态或趋势覆盖。普通导航也在同一地址的可读DOM稳定后停止并排空无关资源加载，不再强制等待整页load；资源排空失败仍隔离。Codex原始模型目录只在进程内按CLI内容/config/model指纹缓存5分钟，副本篡改/缺失/过期、退出登录使其失效；有效单browser目录门禁与每轮实时账户、MCP名称禁用仍执行。

- Startup and Project restoration retain saved tab URLs, order, ownership and selection without making page network requests. Restored tabs expose deferred state and load only when selected or required by a page action; listing and closing do not trigger navigation. Required loading retains bounded native navigation and awaited cleanup. Temporary collection pages are destroyed after the batch, while original text remains Project-owned.

- Page diagnostics enable the existing native network observer before navigation, pair request IDs with bounded URL/type metadata, and report document/script/fetch status, terminal failures and at most 30 pending requests. Diagnostic URLs omit query strings and fragments; headers, cookies and request/response bodies are not exposed. Fixed document startup fields distinguish parsed-but-empty SPA state from navigation readiness.

- Native navigation diagnostics distinguish full-load completion from Host DOM-ready stop and deadline/cancellation stop, with elapsed times. Account snapshots include only navigation entries for the requested document; an initial `about:blank` completion cannot be attributed to the account page. This provenance must be checked before attributing aborted SPA scripts or requests to the publisher or network.

- Ordinary tabs retain the native load lifecycle and do not call stop merely because a stable shell/header contains text. X/Twitter collection navigation likewise preserves application startup requests; account snapshots inspect the current committed main frame while other resources are still loading. Fixed body, metadata, diagnostic and scoped-link reads use `mainFrame.executeJavaScript`, avoiding WebContents' load-completion queue, while renderer-change guards reject navigation during a read. Load completion, a spinner, an error page or profile header alone never establishes successful account coverage. Navigation deadlines are unchanged.

- Text account snapshots prioritize same-account status links in the bounded returned link list, so navigation/profile links cannot displace the evidence needed for news attribution; the saved original and success classifier remain unchanged.

- Text-page batches persist ordered pending, read, restricted, incomplete and failed rows as immutable Project checkpoints with a SQLite index. Every row retains its source/acquisition identities or bounded negative diagnostic evidence. Model reads use a fixed batch ID/revision/SHA and bounded pages for metadata, original text, links and diagnostics; each response is at most 3000 serialized characters and never silently drops its middle. Checkpoints do not replay collection.
- Section delivery starts at zero and is tracked by Host Session, Project, immutable checkpoint, section and row. `TEXT_READ_PAGE_ORDER` rejects an offset beyond the contiguous delivered frontier; already delivered pages can be replayed without network access. Responses include `coverage` with the delivered frontier, total, completeness and next required offset. Only contiguous returned ranges can establish `coverage.complete`; this is delivery evidence, not a claim of model understanding. The bounded in-memory ledger forgets progress on restart/eviction and requires offset zero again. Oversized-link fallback remains incomplete until exact details are read.
- Negative diagnostics retain bounded renderer read failures rather than silently replacing them with an unexplained unknown state. Network failures include native request identity, cancellation and blocked-reason fields when supplied by Chromium; these flags alone do not attribute a cancellation to the page or Host. Native load/stop timestamps and isolated caller tracing must be compared before making that attribution. Per-row start/read/save times are recorded separately from the batch and cleanup duration.
- X temporary reads retain a native navigation lease until visible real posts and same-account status links can be captured consistently; unrelated loading is stopped only after that snapshot. Missing/empty accounts and header-only pages remain incomplete. Before deadline cleanup, bounded diagnostics are retained. Ordinary user tabs keep their normal load lifecycle.
- Each collection lane owns a dedicated show:false offscreen parent window with an attached offscreen child surface so real rendering/IntersectionObserver can run without foreground changes. The native page and parent surface are destroyed before the batch releases FIFO; cleanup failure remains quarantined. The shell separately displays saved, loaded, deferred and research page counts.

### 轻量热点发现

- `pages.discover` 是单一 BMW browser 目录下的原生动作，只接收1–60个显式公开 X 账号URL（不接受用户tab、代码或超时覆盖）。复用3路隔离页面和原有8秒单页/180秒整批预算；FIFO释放前等待真实清理。它不滚动、不展开长帖、不打开文章、不枚举或采集媒体。
- 每账号最多5条渲染可见且有同账号规范status链接的帖子，每条摘要最多360 UTF-16字符；保存显示时间、可取得的原始datetime、置顶标记与截断标记。未取得真实摘要与对应链接的页面仍为未完成/受限/失败，不用HTTP200、账号标题或其他来源替代覆盖。发现成功仅表示当前可见快照，不承诺完整动态、最近72小时全覆盖或平台热榜。
- Project保存带 `mode:discovery` 的不可变批次检查点和来源/acquisition凭证。发现来源使用 `visible-post-excerpts` 提取域，强制 `truncated:true`，原文文件只包含明确标注的摘要投影，不冒充全文、事实核查结果或连续原文引用。旧 `visible-text-nodes` 原文及严格分页规则保留。
- `pages.read-result section:leads` 每页返回一个账号的紧凑线索、来源ID和状态，含delivery receipt最多7000字符；Host连续分页仅证明该投影已送达，绝不证明原文或诊断全部阅读。诊断保存在批次，失败或需要时单独读取，日常发现不逐页拉取诊断。首次发现是基线快照，尚不承诺增量游标、跨账号自动事件聚类或热度增长率；模型按线索合并事件和初排，重点取证另行执行。

- 账号快照等待区分内容就绪与主文档传输：普通等待仍为8秒；只有同一Document HTTP200、实际收到正文数据、最近1秒仍有新增字节且传输未完成/失败时，才能使用最多4秒完成窗口，单次总计不超过12秒。页头、无进展、其他脚本/图片、完整但无帖文档和拒绝访问均不能换取延期；180秒整批预算、取消与隔离清理不变，read仍要求真实帖子及来源绑定。批次诊断保存文档累计字节、最近数据时刻和终止状态，不以HTTP200或接收字节代替帖子覆盖。时间判定先读取传输快照再采样当前时刻，避免跨毫秒把刚收到的字节误判为未来数据；真正来自未来的时间仍拒绝延期。

内部审片的同目标去重保留运行中、排队、成功及投递不确定的输入收据。用户明确再次启动时，只有旧输入已 interrupted 且官方运行/原生资源已实际排空，才创建同一目标的新输入收据；旧 runId 和审片证据保留，新尝试采用当前审片声明 baseline。不自动重试，也不重放不确定投递。

内部审片入队时附带当前草稿/导出指纹锁定的有界资料快照：最多8镜、每镜20条字幕/12个文字层/2条引用，总UTF8不超过12 KiB；每条引用由当前Project来源端口核对已存正文范围，提供来源元数据/正文内容ID和最多600字符原句摘录。原句绑定不证明事实真伪，所有摘录均为不可信资料。缺失来源、截断和省略字段显式标记并给出后续读取位置；不把摘要冒作完整草稿。审片模型可据此跳过重复分散读取未变的脚本/音轨/字幕及不存在的卡片，但仍须实际查看当前MP4所有关键状态、核当前成片原声，分别记录逐镜和独立整片声明。快照构造过程中版本/Project变化即拒绝入队，不修改草稿。

`video.studio context` 严格只接受 `operation`；拒绝多余字段时，错误同时提供可直接显式提交的 `correctedRequest`，避免为这项当前Project/Session只读上下文重复查询help。Host不自动执行修正请求，不替制作或编辑请求推测必填值。

Studio 当前输入的上下文同时提供精确的context请求与当前草稿read请求，便于模型直接显式提交；不额外开放工具、不自动执行，也不取消编辑前读取当前状态与CAS版本校验。批量命令契约查询的说明与实际契约保持一致。

批量镜头准备在原生处理前核对每条引用；失败返回 `SHOT_CITATION_BINDING`、镜头ID、引用序号、实际提交的sourceId/acquisitionId和原文范围，再附原始拒绝原因。取消/版本变化仍优先终止；不会自动猜测、纠正或接受相似ID，失败仍保留未提交的checkpoint与清理事实。

若获取绑定不存在，可读取当前Project来源索引第一页、最多20项，只有同一个精确acquisitionId唯一命中其他sourceId时，错误才附带 `bindingHint` 并标明必须显式重提。不会按相似ID、标题或引文猜来源；索引不可用、范围外命中、歧义或原句不匹配均不提供纠正值，取消仍优先传播。该提示不修改草稿、接受引用或启动原生媒体工作。

`describe-edit` 可用 `editOperations` 一次查询1至8个不同命令，与单个 `editOperation` 互斥；返回命令契约总量不超过16,000字节，超限命令列在 `omittedOperations`，须单独读取，不隐藏字段或执行编辑。主画面修剪仅对距整数微秒不超过4倍浮点ULP的运算结果恢复精确微秒边界，避免字幕恰好结束于镜尾时误判越界；有意指定的亚微秒源时间保持。

共享文字换行器对自动落为单独一行的英文短连接词（如on、in、and）在宽度允许且前行至少三词时，从前行移下末词组成一行；不改变词序、原话、时间或显式段落换行。预览、导出和文字预检共用此布局，仍须检查真实手机尺寸成片。

页面原文定位：唯一 browser 的 page.text.find 接受显式 selector、1–200 字元 text、findOffset 与至多16个排除选择器，读取当前 Project 页面真实可见文本，按忽略大小写和归一空白的子串定位。单页至多扫描200个元素／20000个文本节点、返回8个匹配，整体元素索引限10000；每元素读取至多2000字元、返回至多1000字元预览。结果保留真实 selector/index、nextOffset、partialElementIndices 与 budgetExhausted；截断／超预算不能证明不存在。隐藏、输入控件、可编辑区和明确排除内容不作为原文匹配。定位不保存来源、截图或授予证据权限；须用返回定位重新 collect 与 sourceBinding 截图，原有 URL/文本/SHA、CAS、FIFO 和实际清理边界不变。不接受调用方脚本或凭据访问。

来源操作字段恢复：library.sources 的 sourceRequest 帮助列出每个操作实际必填／可选字段；read/list 不接受 expectedRevision。额外字段继续拒绝，错误仅返回至多8个、每个至多80字元的字段名及该操作允许字段，不回显字段值；明确本次未执行，需修正后显式重提，不自动删除字段或重放。

单一 browser 工具的传输 schema 使用确定性的共享定义去重：只在标准 schema 位置识别重复子树，生成资源内 $defs/$ref，嵌入 $id 资源独立处理，含该资源的上层节点不移动。旧方言、自定义方言、片段标识符，以及已有引用、锚点、定义或未知词汇的资源保持不变；const/default/examples 等数据不作为 schema 遍历。节点及定义数量有界，若结果不更小则保留原 schema。完整原生 action schema、归属、字段校验、权限、help 与有效工具目录唯一 browser 的验证不变；不使用开放请求对象代替契约。与 action 描述完全重复的 Feature 总览不在工具说明中再重复，所有原 action 描述仍完整保留于 schema 分支，额外上下文不删除。该优化减少重复结构，不表示全流程时长已达标。


### 冷启动制作与返工的有界恢复

新闻准备文本拒绝返回 `NEWS_PREPARATION_FIELD`，精确指出镜头ID和字段路径、类型、长度、空值/控制字符状态及原有上限；不回显原文。原声模式的原文/中译及不用原声时的理由仍须非空，不改变原先门禁；批量请求解析拒绝时没有保存任何声明。

`describe-edit` 的未知命令拒绝同时列出实际闭合命令名，以及 `media.segment → video.studio attach → scene.set` 的已有素材替换路径，明确不执行猜测命令。`prepare-shots` 对新请求中已有镜头ID，在创建checkpoint和原生处理前以 `SHOT_SCENE_EXISTS` 拒绝并返回明确的替换流程；不覆盖镜头、不改历史、不自动改用另一操作。原有显式resume/不确定投递/版本/归属/预算检查保留。

制作指引要求在写稿配音前先看实际开场短窗，确认前三秒有相关真实运动且新闻主体可见，并保留完整原话语境。寻找短原声时优先选20–45秒候选窗口，必要时再定向扩展；不限制合法长窗，更不缩短最终当前MP4完整保留原声的核验。成功记录全部必需镜头后可直接进入 `narrate-pending`，由其内部重新核对当前准备门禁，避免额外重复相同preflight往返。最终修改仍刷新受影响证据，check/render仍执行各自当前校验，独立全片审片不变。

### 新闻素材采集恢复与页面归属

`click` 返回点击时的 `sourceTab` 和原生 DOM 观察到的 `href/target`。普通 HTTP(S) `target=_blank` 链接在同一已准入操作内打开，返回实际 `destinationTab` 与 `openerTabId`；调用方必须使用该目标标签页继续查证。脚本弹窗继承来源 Project/研究页归属，保持后台且延迟加载，不能抢走当前来源页；`tabs.list` 暴露其 `openerTabId`。普通同页点击仍需重新观察页面，不承诺导航完成。

YouTube 导航采用同一45秒就绪预算：核对 watch 目标、播放器数据和响应中的 videoId；广告期只执行正常播放或实际可见且可用的跳过广告按钮。广告、其他目标和未解码内容不能认证为就绪，loadURL 提前结束也必须继续验证。所有出口等待播放器暂停确认；清理失败隔离该页直至显式关闭。

原文件下载继续要求精确资源 URL 和配对音轨。下载资源过期后，只有实际下载工作已清理，才允许重新验证同一页面、确认范围与唯一 YouTube 逻辑视频身份，再进入缓冲及采集；不要求旧的临时流/blob URL 继续有效。来源 evidence 仍保留原候选 URL 和确认身份，不改写为其他来源。其他平台继续精确资源绑定，换视频、广告、范围歧义、Project 变化或清理失败均拒绝。采集开始后播放器 URL、身份、范围和广告检查保持不变。

自动获取的采集兜底最多45秒（显式更短 maxDurationMs 继续生效），不再因长原片默认录制整段；超过窗口仍由既有 partial-preview / source-clock evidence 表明局部获取。显式 capture 与完整归档接口不受这一自动兜底窗口替代。

采集缓冲预检按本次窗口取值：自动采集只预缓冲 min(请求上限,10秒,原片时长)，仍须从片头连续覆盖并实际解码；不再对8–10秒请求固定要求30秒。未就绪、取消或身份变化仍需暂停确认，不能绕过实际采集和输出检查。

自动获取的入口及文件解码后的最终来源提交同样核对唯一已确认逻辑目标，覆盖确认后、下载前和解码期间的流地址刷新。该放宽只对带已确认身份的同一YouTube播放器生效；普通页保持资源精确匹配。实际下载仍通过 prepareVideoTransfer 对本次刚观察的资源地址及音轨配对实施精确检查，最终来源提交还核对产物身份。不得把旧候选的临时地址有效性当作逻辑视频身份，也不得把其他视频的新流地址接到旧来源。

## 新闻往返与交付优化（v2.1）

唯一browser的help支持helpQueries一次读取1–8个当前有效目录精确Schema目标，字段闭合且不执行目标动作；不能与单目标forAction/forOperation/forSubOperation混用。回复预算12KiB，整项超预算明确omitted并列omittedIndices，不截断Schema冒充完整，不缓存其他运行时的Schema。已有完整core目录字段不要求预先help；Studio深层字段按当前阶段批读，真实错误才补读。

Studio render（包括缓存复用）直接返回原生计算的export.sha256，不要求为取哈希另行assets搜索或materials索引。video.review策略v4在Host固定target.sha256，并随审片上下文给出原生导出报告已有的尺寸、封装时长和各可解码音/视频轨首尾摘要；缺失字段保持缺失。ASR/PCM使用音频轨范围，motion使用视频轨范围，容器时长不能作统一轨尾；范围门禁不放松，也不静默截短请求。仍需当前全部关键态、本轮逐镜及独立整片通过，人工试听另记。

操作员CLI `node scripts/prepare-news-delivery.js PROJECT_DIRECTORY HISTORY_FILE DRAFT_ID REVIEW_RUN_ID NEW_OUTPUT_DIRECTORY` 对已完成成片进行确定性文件准备：核官方终态/Project和Session归属/当前draft及导出指纹/Host固定SHA/逐镜和整片新声明/全部关键帧哈希/结构与原生技术门禁，复制MP4并核副本SHA，导出当前时间轴稿、字幕、来源及manifest至源Project以外的新目录。失败不覆盖既有交付；不编辑源Profile、不运行模型、不恢复模型设置、不渲染、不重审、不替用户试听；不注册为模型工具。详细耗时复盘在交付之后，不能再由模型现场编写新整理脚本阻塞成片交付。

### 独立导出审片批量声明

`video.studio / record-export-review` 支持互斥的单项 `exportReview` 和整批 `exportReviewBatch`。批结构固定当前exportFingerprint、全部当前sceneId的独立status/notes以及独立film status/notes；scene集合必须完整且唯一，不含actor/runId权限字段。沿用revision、当前导出、实际关键帧哈希覆盖、视觉支撑、逐镜及整片通过门禁。所有校验成功后单次原子journal写入；失败不产生部分声明。每镜sequence独立增长，film随后，Host绑定同一审片runId。批回执只回确认与逐镜/整片状态，不重发完整视觉政策和旧报告；确认后无需再读status。单项与用户GUI语义保持。内置审片提示v2.2/任务策略v5要求完成独立判断后一次提交，保留旧策略读取，不启动或复用旧passed完成新任务。
