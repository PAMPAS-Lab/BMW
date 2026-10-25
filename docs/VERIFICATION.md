# BMW 验证说明

核对日期：2026-10-25。当前功能以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准，分类与运行配置见 [ARCHITECTURE.md](ARCHITECTURE.md)。通过结果须绑定当时源码，不能按文档日期推断完整覆盖。

## 后台广告就绪与播放策略回归（2026-10-25）

周期新闻实际续作暴露后台暂停策略与YouTube正常广告推进冲突。隔离回归先复现：视频已解码（64×64、1秒），4秒内19次播放均被暂停，currentTime约0.004秒，未能就绪。Host现只在原45秒目标导航就绪阶段允许静音推进；不抢前台、广告不认证内容，成功／失败／取消后撤销并暂停，恢复失败仍隔离。实际播放过程原生静音、取消清理及普通后台播放拦截均有断言。

build/check通过；unit/contract/boundary/type层 **133 passed / 0 failed / 98 outside-layer or opt-in not-run**。另顺序通过10个原生命令：标签/广告生命周期、后台、后台采集、媒体录制/处理、视频、Studio、本地旁白、DSH及完整桌面（四组加Project重启）。初始修复真实来源复测在跨Frame策略恢复时失败并显式关闭恢复；最终将静音例外限主Frame、主播放器暂停/撤权单独核验，子Frame从未获播放例外，其失败保留静音与诊断，不伪称已暂停。新增无关Frame故障回归先失败后通过；最终另通过102个浏览器契约、9条边界记录及同10个原生命令。最终代码与全部生成输出SHA核对通过，见[专项记录](verification/BACKGROUND_READINESS.json)。没有再次重跑完整所有层；原全量基线与已解决夹具失败分别保留。均为一次性Profile/Home及mock keychain；该受控广告回归不代表真实YouTube或生产Profile验收，真实来源将在更新后另行复测，未据此宣称新成片通过。

## 当前合并与 Harness 升级验证（2026-10-25）

现存分支的提交均包含在本次集成历史中，其他工作树无未提交改动。锁文件固定官方 Codex CLI0.164.0、Qoder CN CLI/Worker1.1.78及SDK1.0.56、WorkBuddy CLI2.176.0；DSH0.2.1-rc.2已是查询时的官方latest。Codex/DSH改用BMW自己的官方npm运行时，显式Codex覆盖仍受版本与实际目录门禁约束；清理BMW旧Codex0.160.1运行时和被替换的已安装依赖，不删除用户Project、素材、凭据、会话锚点或其他应用的全局运行时。

最终build/check通过。完整非外部基线为 **215 passed / 3 failed / 14 opt-in not-run**：三条失败对应两处测试夹具问题——媒体点击使用空receiver，桌面弹出页来源断言写成agent；desktop-suite汇总随Project组失败。全量结束后只改这两个测试文件，重新build/check并重跑完整媒体采集及完整桌面套件（四组及Project重启）全部通过，**无未解决失败**。未再次重跑整轮，不能将不同运行混称为一次218全通过。最终实现相对完整基线未变；核对全部构建输入及生成输出SHA，基线、变更范围、复验和日志指纹分别保存在[升级报告](verification/HARNESS_UPGRADE.json)与[CURRENT](verification/CURRENT.json)。

前一轮中断报告保留200通过/6失败；实际修复了本地TTS隔离页面漏放行motion-contract依赖、后台采集误挂前台窗口、未进入播放器就绪阶段却触发清理，以及延迟加载/有限播放器测试夹具。最终完整基线已覆盖这些修复。独立审片与真实动态素材门禁未放宽，类型冻结例外未增加。

官方运行时验证：Codex五个维护模型通过实际请求目录捕获，只有browser，本地sink始终503；WorkBuddy使用本地HTTP夹具验证三模型目录、两次browser执行与原生续聊；DSH验证实际固定运行时与冷控制；Qoder验证新SDK/Worker无登录拒绝、输入不释放和清理，并通过适配器契约，未覆盖登录后的真实init目录。全部原生测试使用一次性Profile/Home/Workspace与mock keychain，不代表付费模型、外部服务或生产Profile覆盖，也不是全新npm ci验收；既有影片与人工听审的接受状态分别保留。

## 历史合并源码验证（2026-10-22）

本轮已将所有现存本地／远端分支头纳入 main；WorkBuddy 冲突保留实际 browser 目录门禁、系统加密、事件串行化和清理隔离，旧设计归档。社媒研究保留已补充的日期与能力边界。运行中的 BMW 使用原检出目录，验证使用独立 Git 索引、与提交 `04bf356` 文件树完全一致的源码副本；只复用已安装的第三方依赖，BMW workspace 链接指向副本，复制固定本地 TTS／Whisper 资源，不代表全新 npm ci 验收。

最终顺序 build、check 与完整 --all 通过：**196 passed／0 failed／14 opt-in not-run**。196 个记录组包括 191 项登记检查、4项门禁和1项桌面汇总；覆盖 unit／contract／boundary／type、四驱动、DSH、素材库、desktop、Studio、media、video 和 narration。最终运行源码与生成输出重新逐项计算 SHA；文档收尾后另核对类型、清单、边界与链接。六个冻结类型例外未增加。[CURRENT](verification/CURRENT.json)保存逐项结果、源码／输出身份、分支审计及本机完整日志指纹；不是远程 CI。

首轮完整运行是 **190 passed／7 failed／14 opt-in not-run**，原报告保留。Studio next 失败来自隔离副本缺少 Whisper 模型；其余六个失败记录来自 library.desktop 与 desktop.workspace 重复登记同一组，使桌面入口拒绝参数，并非六个独立功能故障。已将素材库覆盖合入 desktop.workspace、移除别名并补唯一四组及变更选择断言，18个测试选择用例通过；补齐模型后重新构建并完整重跑，最终结果不与首轮混计。

公开视频取材结果另见[实测](research/SOCIAL_DOWNLOAD_VALIDATION.md)：X、微博各2/2，两个真实 X 回复资源被拒绝；YouTube 0/2，SABR/UMP或403阻止完整文件获取。同目标分离合并的隔离夹具通过不能代替真实网站，用户要求暂缓并登记[YOUTUBE-01](plans/YOUTUBE_NATIVE_ACQUISITION.md)。没有引入 yt-dlp 或 TikTok 专用适配。运行检查使用一次性 Profile／Home／Project及mock keychain，不测试生产Profile、系统凭据提示或付费模型，人工听感和用户接受分别记录。

此前完整173组基线保留在[整合前快照](history/2026-10-22-before-library-social-integration/CURRENT.json)；以下专题记录仍保留各自日期和范围，不累加为本次通过数。

## 主 Profile 实际发现的大截图读取问题

实际候选准备暴露Source screenshot登记将最多32MiB PNG一次传给每次最多1MiB的ArtifactJobIO.read，超过1MiB时被正确拒绝。修复为有界分块读取，逐块检查取消和Project边界，仍检查完整静态PNG结构、解码尺寸、所读字节SHA、实时文件指纹及同源正文；不提高读取/图片/像素上限。准备指引同时明确复用事件原获取、排除推荐侧栏和无关缩略图，并将未核实录制日保留null，不抄发布日期。

最终build/check、**114项离线分类通过/0失败/90未运行**。19项隔离原生用例首轮18项通过，sources用例在生成自身短视频输入时缺少视频轨、尚未进入被测流程，原失败保留；其他检查退出后，该用例独立重跑通过，实际来源/解码/引用/GUI与清理均完成。不能写成19项首轮全通过。汇总 `.bmw-runtime/main-profile-news-2026-10-21/screenshot-regression.json`，保留首轮 `runtime-after-screenshot-chunks/result.json` 及 `source-retry-after-screenshot-chunks.log`。受测554项输入/520项输出未变。真实DOM大截图证明为 `runtime-after-screenshot-chunks/source-screenshot/large-screenshot.json`：1,621,852字节、608×4848，实际PNG、来源关联与解码核验通过；一次性测试Profile，不是主Profile新闻素材。

主Profile的实际准备输入 `29639146-f34c-4e8a-86fd-3a1e355f9419` 经GUI停止并等待清理，回执finished/interrupted，保留已提交5个edition、15条线索和12个事件。正常退出主实例后才构建及回归；后续以不同的新输入继续，不重投旧输入。源获取不匹配、截图陈旧、日期/预览及CAS门禁仍严格拒绝。实际候选的预览相关性和录制日期仍需编辑核对，尚不能据本节认定快照或视频已交付。

## 正文可见元数据位置绑定

主Profile实际采集中，Hugging Face及OpenAI文章的正文有可见日期/署名，但局部元素选择器未能定位，旧获取明确保留null及缺口。新增可选metadataRanges回退：Native从本次完整可见正文的精确UTF16区间取值，保留quote和位置；字段与selector互斥，正文变化、截断、缺失、错误偏移和裁剪Updated/录制/转载日期拒绝。位置证据随新获取保存，read/import重新核对正文与SHA。旧获取零回填；位置绑定不认证发布者权威或事实正确。browser只负责DOM及边界检查，未添加到media-native的运行时依赖。

最终build/check、**16个定向用例**、**114项离线分类通过/0失败/90未运行**及**19项隔离原生回归**通过。新增真实DOM用例证明无专用日期元素仍可绑定，修改页面日期后旧见证失败，旧获取字节保持；原生来源/媒体、素材库、新闻、推荐、周期/后台、Studio恢复、制作、DSH、桌面、旁白及驱动均纳入。报告在本机 `.bmw-runtime/main-profile-news-2026-10-21/unit-after-metadata/`、`runtime-after-metadata/`，真实DOM证明为后者 `sources/metadata-witness.json`。默认受限启动曾在Electron启动前被终止（143，日志为空），该次失败报告单独保留为 `runtime-after-metadata-sandbox-launch/`；通过结果来自获准的隔离原生重跑，不混计启动失败或真实外部服务覆盖。

主Profile于全部输入正常终结、清理并空闲后正常退出，完成隔离回归再更新。此前只读保全复核：原13,429个材料、173份Studio/新闻状态及95份历史文件字节未变，108个旧会话的Project/driver/原生恢复锚点未变。后续元数据补采、严格72小时推荐与视频交付仍须以主Profile真实驱动回执核验。

## 主 Profile 实际驱动发现的社媒参数说明修正

主Profile只做用户授权的实际使用与只读兼容核对，不运行夹具。兼容核对覆盖29个Project、108个会话、95份已存历史、124份草稿、18个新闻批次、220次来源获取及266条导出记录，格式错误为零；207份原文SHA及13,429个材料文件已核对/记录。元数据副本和逐文件基线留在本机。11条既有unknown输入保留，不重投。真实Qoder CN首次X趋势访问成功保存原文，但错误的platformId参数反复被拒绝，本轮以failed正常终结，游标保留；不能将Host轮次success混称采集success。

据真实失败补充原文URL路径标识、空指标、入口观察范围及整组finish证据说明；身份与指标错误独立，返回原URL允许标识，缺证据字段明确拒绝。没有放宽原文、指标、租约或游标，也未改变存储版本。最终build/check、12个目标用例、**114项离线分类/0失败/90未运行**和**18项隔离原生回归**通过；未运行项不算通过。受测非Markdown源码及生成输出与本次修正逐项SHA一致。所有这些回归使用一次性Profile/Home/Workspace，与主Profile实际结果分列，不据夹具宣称真实访问或制作完成。

报告 `.bmw-runtime/main-profile-news-2026-10-21/unit-after-social-help/result.json`、`runtime-after-social-help/result.json`、`social-help-regression.json`。旧108个Session的Project/driver/原生恢复锚点在修正后逐项未变。主实例正常退出更新后已重新启动，真实采集、推荐及后续视频目标仍在继续，见 [主Profile工作记录](research/AI_NEWS_MAIN_PROFILE.md)。

## 固定来源与真实近72小时链路验证

固定目录、可信添加、社媒类型和受限页门禁已实现；规格及测试清单已更新。最终build/check通过，六个冻结类型例外未增加。离线分类 **114 passed / 0 failed / 90 not-run**；not-run是层级外或显式opt-in，不计通过。**18项隔离原生回归全部通过**：固定来源GUI、隐藏后台采集、周期采集、推荐、rolling、旧素材库选题及成品采用、原文截图、Studio生产恢复、原生视频、DSH、桌面workspace、标准Studio、旧news、媒体采集/处理、Qwen HTTP旁白、驱动/MCP契约及普通浏览器后台。

新增契约核对24项目录、闭合请求、用户/CAS/Project准入、重复添加不增提交且保留修改/游标、旧social可选字段原样读取、观察类型与原始URL一致、真实指标原文及登录/挑战页不能成为内容或成功游标检查。GUI核验默认暂停、明确勾选、并发修改后停止、显式刷新后重复保全，不建立计划或投递模型输入；截图已查看。沿用回归继续验证用户输入先等后台实际清理、未知输入不重投及旧素材/批次/快照/草稿/导出与实际采用关系。

真实公网另列：[固定来源与真实链路](research/AI_NEWS_REAL_SOURCES.md)及[机器摘要](research/AI_NEWS_REAL_SOURCES.json)。在全新隔离Profile/Project中，经真实Chromium、Host/认证Bridge、原文/rolling/推荐服务访问9项预设，保留28篇不同文章、30次原文观察、27个活动事件和2个归并退休事件；17份候选通过准备核验，最终近72小时 **complete / 严格10题**，原文SHA、原页PNG及事件身份逐项断言。旧完整、七题和九题不足快照独立保留；“10月19日”无时区日精度在UTC10:00后自然退出保守72小时边界，没有补时区、改日期或生成七天快照。两次明确正文变化后的新获取仍因截图超时被排除，没有当作恢复成功。

X只取得公开账号观察，趋势/实时搜索登录跳转；YouTube频道/搜索未取得可用正文。全部五项社媒订阅保留游标，不宣称真实热点榜、增长或社媒全量覆盖。最终十题偏科技报道与图文资料，不代表编辑多样性或成片验收。目录24项不是24项在线成功证明；实际原文范围明确保存，不冒认整站/整篇覆盖。

回归报告 `.bmw-runtime/ai-news-real/unit-final/result.json`、`runtime-final/result.json`；最终真实报告 `live-72h-verified/result.json`，源码核对 `source-audit.json`，汇总 `summary.json`。整轮后仅显式opt-in外网验证脚本调整了18篇预算、单次确定性正文重取、有限DOM就绪等待和正常浅色视口，再独立build/check并完整实测。离线报告552个非Markdown输入中551个未变，原生构建553个输入中552个、519个生成输出中518个未变；唯一变化为该外网脚本及其JS输出，生产实现及所有离线/原生回归源码和输出逐项一致。新版外网报告绑定的553个构建输入、519个输出全部与最终文件SHA一致。文档回填不改变受测实现。

所有技术回归为一次性Profile/Home/Workspace与受控服务夹具，真实公网验证用确定性队列适配器；没有付费模型自主研究、在线TTS、生产Profile、实际成片制作、长期无人值守或人工音画接受覆盖。中间元数据/地区跳转/截图故障、初始隐藏GUI截图错误和预期CAS拒绝均保留，未混入最终通过计数。本机运行材料被Git忽略，换机需单独保留。

## 第六阶段未激活绑定扩展验证

最终 build/check、功能与架构清单、类型/源码边界检查通过，六个冻结类型例外未增加。离线分类 **113 passed / 0 failed / 88 not-run**；not-run 为层级外或opt-in，不计通过。Host与Bridge补强覆盖固定非活动Project/Session/driver准入、普通外部租约仍拒绝、用户输入等待真实清理、后台交互变unknown且不显示前台问题，以及本轮动作/原文预算和只读刷新门禁。

**17项隔离原生回归全部通过**：新增跨Project隐藏采集、周期采集GUI、推荐GUI、滚动采集GUI、原素材库选题及成品采用、原文截图、Studio生产恢复、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news、媒体采集、媒体处理、Qwen HTTP旁白、真实BMW主程序的中立驱动/MCP契约、普通浏览器后台渲染。新增场景使用真实AssistantService、Host、认证Bridge、素材库运行时和Chromium DOM，核验未激活绑定的原文只写原Project、固定驱动、后台副作用/跨run拒绝、隐藏页静音且不进入窗口、只读素材查询不取消、用户输入在原生drain等待期间只保存prepared回执、隐藏页销毁、unknown恢复不重投、原游标保留、前台Session/页签/未提交输入及旧文件字节不变。周期健康GUI截图已查看，绑定、等待/核对原因和恢复入口可读。

报告见 `.bmw-runtime/library-streams-phase6-detached/unit-final/result.json`、`runtime-final/result.json` 与 `summary.json`。最终轮次冻结全部555个受测输入SHA一致，文档回填后548个非Markdown实现/测试/配置SHA一致。中间结果另存：首次后台夹具的前台页自身弹窗导致页签断言失败；随后补强自动只读刷新门禁时，旧轮次来源完整性检查如实拒绝变化的TS；标准Studio等待动态控件时直接读取空节点，已改为存在且可用的就绪检查。中间轮次未计入最终通过数；最终完整重跑，未降低业务断言。

全部使用一次性Profile/Home/Workspace、本地协议页面、官方队列及服务夹具；保持唯一browser有效工具目录和官方运行时自有循环。没有付费模型、真实在线社媒/登录账号、真实在线TTS、系统通知实际投递、生产Profile、实际断电或人工听审覆盖。不切换前台不等于另开并发Agent循环；全局仍仅一个官方输入执行，清理失败继续隔离。旧素材、批次、推荐快照、草稿、成品和采用账本的格式及入口保持。

## 长期采集第六阶段验证

最终 build/check、源码边界、视频Schema及功能/架构清单通过，六个冻结类型例外未扩展。最终离线分类 **112 passed / 0 failed / 87 not-run**，包括unit/contract/boundary/type；87项为该分类轮次的层级外或显式opt-in，不计通过。新增10个调度契约案例、2个Host优先级案例和1个快速采集完成案例；相关三个文件共32个案例通过。覆盖明确Project/Session/driver、方向公平轮转和多来源、非激活绑定等待、用户忙碌/到达时让行、精确run取消和真实drain、失败隔离、重启合并补查、未知/缺失输入不重投、保存顺序、未投递预备项恢复、5分钟至24小时退避、受限来源轮转、独立截止唤醒及超时退避、证据与游标保全、通知去重/静音/已读、显式恢复/跨Project重配、闭合输入/CAS/损坏/链接保全与空读不初始化。

最终 **14项隔离原生回归全部通过**：周期采集GUI、推荐GUI、滚动采集GUI、旧素材库新闻/成品采用、原文截图、Studio取消/CAS恢复、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news、媒体采集、媒体处理、Qwen HTTP旁白。新增调度桌面链路实际建立两个方向及固定绑定、通过真实DOM检查后提交游标、使用实际AgentHost输入收据、持有真实drain等待证明用户输入尚未执行、清理后恢复FIFO、保留游标、未知投递不重发、持久健康通知/系统通知夹具、显式结束旧轮次与已读。健康GUI截图已查看；既有批次、快照、草稿、作品、导出版本和采用关系回归保留。

最终报告在 `.bmw-runtime/library-streams-phase6/unit-final/result.json`、`runtime-final/result.json` 和 `summary.json`。冻结源码上完成整轮，回填前552个受测输入SHA全部一致；文档回填后545个非Markdown实现/测试/配置SHA全部一致。中间结果独立保留在同目录带 `before-` 的报告中，不混入最终通过数。收尾补齐了超时与用户让行的退避区分、快速官方完成仍保存dispatchId；Studio回归暴露了实际在途句锚点引用保存提前重开字段的问题，已对新增/移除和字段保存统一持有编辑门禁，失败保留输入；旧夹具还存在磁盘保存早于GUI就绪的点击时序，现统一等待控件可用后只点击一次。标准Studio另独立完整通过，最终整轮也重新通过。早期分类未包含type层，最终显式纳入，不沿用早期统计口径。

只在一次性Profile/Home/Workspace和mock keychain上运行。官方模型与系统Notification使用受控夹具，旁白使用Qwen HTTP夹具；没有付费模型、真实在线新闻/社媒账号、真实系统通知投递、真实在线TTS、生产Profile、实际断电或人工听审覆盖。调度仅在绑定已激活且资源空闲时运行，不自动切用户Project/Session；退出应用不运行，重启不无限补跑。手动任务没有被自动转换成周期任务，既有方向/订阅也不会自动启用采集或对外发布。

## 事件推荐第五阶段验证

最终build/check通过（TypeScript、六个冻结类型例外未扩展、源码边界、视频Schema及功能/架构清单）。最终离线分类 **111 passed / 0 failed / 86 not-run**；86项是所选层级外或显式opt-in，不计通过。新增7个推荐契约案例：严格十题与三事件/步预算、Project/方向/专题及策略窗口、冻结事件/edition/排除/策略序号与索引重建、原始事件键/来源/正文/证据去重、不足与明确接受、旧news资料复用和字节保留、取消/CAS续建、源文变化拒绝、当前事件重核和已选草稿保持、168小时侧车/旧72小时隔离、跨Project单题证据复制、普通news错误码和Project目录别名锚定/改绑拒绝。过期或不符合策略的元数据在原生预览核验前过滤；list只返快照头，Agent read不传长证据向量，跨Project不返回引文。

最终13项隔离原生回归全部通过：新推荐GUI、滚动采集GUI、原素材库新闻/成品采用、原文截图、Studio取消/CAS恢复、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news、媒体采集、媒体处理、Qwen HTTP旁白。新GUI夹具核验55专题分页、严格十题、方向168小时策略、专题仅一题的不足/明确接受、固定快照历史、后台进度及隐藏返回、隐藏的未提交策略不阻挡新闻更新、原批次归档字节及旧草稿/文件保留、真实PNG解码、可信第十题选择与重复选择不重发、所选事件后续修订不替换草稿，以及实际MP4与独立导出账本。十题和不足截图均已查看；样本均明确标识隔离测试，不是实际新闻质量认证。退出时可能出现取消及并发读的CAS诊断，通过依据是业务断言、真实资源清理等待与完整退出状态，不宣称线上无错误。

最终报告 `.bmw-runtime/library-streams-phase5/unit-final/result.json`、`runtime-final/result.json` 和 `summary.json`。冻结源码上完成整轮，回填前546个受测输入SHA全部一致，回填后非Markdown实现SHA全部一致。中间曾发现旧NEWS_EXPIRED错误码、快照历史沿用空分页游标、恢复夹具过早判断DOM就绪及新闻侧车对Host目录别名不兼容；已修复并新增/补强回归。另按当前可见分类限制未提交表单保护，防止隐藏策略阻挡旧新闻刷新。早期契约/GUI及`unit-before-compatibility-fix`、`runtime-before-compatibility-fix`结果独立保留，不混入最终通过数；最终全部重新运行。

全部使用一次性Profile/Home/Workspace和mock keychain；官方Agent投递与旁白服务为受控夹具，无付费模型、真实在线TTS、生产Profile或真实外网新闻/社媒账号验证。没有实际断电或人工听审。方向策略的地区值按候选标识（如CN/US）匹配，专题按已存关联筛选，不把编辑标签或社媒指标冒认事实/语义认证。周期调度仍属第六阶段，不启动自动采集或对外发布。

## 滚动采集第四阶段验证

最终 build/check（类型、六个冻结类型例外不增、源码边界、视频Schema、功能/架构清单）通过。离线分类 **110 passed / 0 failed / 85 not-run**；85项为所选层级外或显式opt-in，不计为通过。新增rolling契约6个案例覆盖闭合schema及用户/Project/Session准入、X/YouTube精确可见指标与URL身份/SHA、同任务幂等、原文检查与游标原子提交、部分/受限/损坏/CAS保全、uncertain不重投、真实清理失败保留、期限与20次观察预算、修订历史/归并拆分完整证据分区/快照重建，以及方向暂停/改绑使旧租约失效。沿用前三阶段旧数据及容量/导出溯源测试。

最终12项隔离原生回归全部通过：新增滚动采集GUI、原素材库新闻/Studio/成品采用、来源截图、Studio取消/CAS恢复、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news、媒体采集、媒体处理、Qwen HTTP旁白。新增桌面夹具通过可信GUI配置两平台订阅和方向、三次单一官方队列投递、真实Chromium DOM保存原文（本地HTTPS协议响应）、隐藏指标拒绝、保存检查游标、线索整理、事件归并/拆分/历史与停止时等待实际清理；终态之前保留采集锁与旧游标。事件历史截图已检查，显示可读修订、状态、依据和前后事件入口。原生旧素材库夹具继续核验旧选题门禁、唯一草稿/单次投递、真实导出版本和采用区间双向查询。

全部使用一次性Profile/Home/Workspace及mock keychain。社媒为本地可见页面夹具，官方Agent为受控队列夹具；不能据此宣称真实X/YouTube登录、全站趋势或在线覆盖、付费模型、真实在线TTS、生产Profile、实际断电和人工听审。十题快照适配及周期调度仍属于第五、六阶段。

最终报告 `.bmw-runtime/library-streams-phase4/unit-final/result.json`、`runtime-final/result.json` 与 `summary.json`；冻结源码上完成整轮，报告540个受测输入的SHA在回填文档前全部一致，回填后非Markdown实现SHA全部一致。中间夹具缺少原生媒体/页状态适配器曾失败或触发Electron错误弹框阻塞，补齐契约、研究页关闭及错误输出后完整退出；一次界面文案变量冲突导致构建拒绝，无编译入口的启动失败另存runtime-build-rejected，不计最终回归。最终整轮独立重跑，没有把中间成功断言或未运行项混入通过数。后续只回填本说明、当前规范与设计交付状态，未修改受测实现。

## 来源与事件容量第三阶段验证

当前行为见 FUNCTIONAL_SPEC，设计见 LIBRARY_STREAMS。新增容量契约覆盖超旧来源/获取上限、分片边界、旧基底字节保全、首次分片写入前后游标、实体修订与新增不改旧分页、短词空扫描续页、原始正文/媒体身份读取、索引损坏/丢失/中断及新代重建、发布后耐久性警告/撕裂缓存不撤销原文、可信维护边界，以及多方向通用观察和旧新闻幂等同步。原生素材库夹具扩展来源分页、全文检索、后台刷新稳定、隐藏返回及事件索引维护，保留旧专题/新闻/Studio/成品采用断言。最终 build/check（类型、源策略、视频Schema、功能/架构清单）通过；离线分类 **109 passed / 0 failed / 84 not-run**，84项是层级外/显式opt-in，不计为通过。新增8个容量/流契约案例覆盖204个来源、1026次获取（不含随后并发新增/修订）、跨1000提交分片边界及230个多方向通用观察；未扩大冻结类型例外。

最终原生11项顺序通过：素材库来源/事件/旧新闻/Studio/成品采用、原文截图绑定、Studio取消/CAS恢复、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news入口、媒体采集、媒体处理和Qwen HTTP旁白。真实页面的来源分页20+5、正文FTS检索20+4、后台刷新/返回首屏/隐藏恢复、事件观察及可信索引重建均通过；事件与素材反查截图已查看。均用一次性Profile/Home/Workspace和mock keychain，不涉及生产Profile、付费模型、真实在线TTS、实际断电或人工听审。发布后目录同步失败/撕裂缓存为注入故障夹具。

报告为 `.bmw-runtime/library-streams-phase3/unit-final/result.json`、`runtime-final/result.json` 与 `summary.json`，全部非Markdown受测输入与最终实现SHA逐项一致。中间 `runtime/result.json` 的素材库项曾因分类切换沿用来源关键词而失败；修复分类查询状态，并补强旧基底缓存及返回对象隔离后，最终整轮通过。中间结果独立保留，不混入最终通过数。后续仅回填说明文档，未改受测实现。

## 作品版本与实际采用第二阶段验证

当前实现见 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md)，设计及后续阶段见 [LIBRARY_STREAMS.md](plans/LIBRARY_STREAMS.md)。新增导出契约案例覆盖分段/变速/末帧停留、隐藏/静音/准备清单排除、超过30次独立版本、缓存不新增、旧回执只读未知、跨Project复制反查、SHA变化/缺失、损坏与链接保留、取消/CAS清理、账本失败保全成品、提交目标冲突和有界诊断。实际采用表示启用合成输入，不代表每像素可见性、人工听审或作品接受。

隔离原生素材库夹具保留原专题/新闻/选题/单次投递/Studio流程，并完成两次真实Studio导出、原始来源获取绑定、成品版本/采用区间和素材反向查询。原生视频夹具还核对直接合成自动记录、实际输出SHA和缓存复用；相关DSH、桌面、Studio、媒体和旁白基线使用一次性Profile/Home/Workspace与mock keychain，旁白为HTTP夹具，不调用付费模型、真实在线TTS或生产Profile。报告收集在 `.bmw-runtime/library-streams-phase2/`，最终报告为 `unit/result.json` 与 `runtime-final/result.json`，汇总为 `summary.json`。

build 与 check（类型、六个冻结类型例外不增、视频Schema、功能与架构清单）通过。最终离线分类 **107 passed / 0 failed / 84 not-run**，not-run为所选层级外或显式opt-in，不计为通过；素材库/组织/导出契约合计23个案例，其中新增导出9个。报告全部非Markdown受测输入与最终实现逐项SHA一致。最终原生十项顺序通过：素材库新闻及真实版本/采用双向查询、Studio自动制作取消/CAS恢复专项、原生视频、DSH冷目录、桌面workspace、标准Studio、旧news入口、媒体采集、媒体处理、Qwen HTTP旁白。

首次新增GUI夹具因版本文案匹配缺少“个”而超时，修正夹具并等待操作完成后重跑通过；未作为产品成功结果。最终版本截图查看了真实版本与采用区域；反向查询由原生页面实际按钮和DOM记录数断言覆盖。后续仅回填本说明和当前文档，未改受测实现。旧第一阶段结果在下方独立保留，不混入本阶段通过数。

## 专题与全局方向第一阶段验证

第一阶段当时实现的行为以其报告为准，当前实现见 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md)，设计与未交付阶段见 [LIBRARY_STREAMS.md](plans/LIBRARY_STREAMS.md)。build 和 check 通过；最终离线 unit/contract/boundary/type 分类报告为 **106 passed / 0 failed / 84 not-run**，not-run 属于其他层级或显式 opt-in，不计为通过。报告 `.bmw-runtime/library-streams-phase1/unit/result.json` 的非 Markdown 受测输入与最终源码逐项核对一致。新增组织与原素材库合计14个契约案例覆盖持久化/重启、跨Project摘要不扩大正文读取、GUI专属写入、CAS冲突、损坏/链接文件保留、旧资料零改写、非视频成品、方向引用分页、归档目标、取消和来源分组继承。

最终隔离原生GUI通过：真实页面创建项目专题、提升全局方向、保持正确导航高亮；将文字文件显式分类为成品、关联专题后显示继承方向、等待保存完成后再切换导航；原始新闻PNG解码、可信用户选题、显式音色、唯一草稿和单次投递继续进入Studio。截图和回执在 `.bmw-runtime/library-streams-phase1/library-native/`，最终跨Project桌面与Studio选材日志为 `desktop-final.log`。这两项在最后局部界面修改后重新执行。

兼容基线八项顺序运行并通过：官方DSH临时Home/Workspace冷目录、桌面workspace、标准Studio、旧news入口、媒体采集、媒体处理、原生视频导出及Qwen HTTP旁白夹具；日志在 `.bmw-runtime/library-streams-phase1/runtime-baseline/`。DSH目录另有 `dsh-final.log` 复验。技术导出、实际采用和用户接受分别判断；本阶段成品仍为用户显式分类，没有自动采用账本、持续采集或周期调度。

一次中间完整回归的测试断言通过，但运行期间修改了两个Renderer及原生夹具，source-integrity门禁拒绝该轮整体通过；记录保留为 `intermediate-source-integrity-rejected.json`，不混入最终通过数。冻结源码后重新运行的最终报告通过。所有Electron/DSH检查使用一次性Profile/Home/Workspace及mock keychain；未使用生产Profile、系统凭据提示、付费模型、真实在线配音或人工听感验收。

## 基础素材库验证（前一轮）

该轮源码的 build、check（类型、源策略、视频Schema、功能清单及架构）通过。unit/contract/boundary/type 105项通过、0失败，84项属于该层级之外，未混计为通过；报告 `.bmw-runtime/classified-tests/2026-10-20T23-43-03-721Z/result.json` 的所有受测输入SHA与当前非Markdown源码逐项一致。素材库新闻桌面夹具另核对已解码预览在 Assistant 活动刷新后仍保留同一元素；来源原生夹具核对可见机构Logo替代文本、隐藏/meta/aria拒绝和截断处理。两者未使用真实 Profile、模型或在线配音。

独立运行通过：官方DSH临时Home/Workspace冷目录，neutral driver/MCP/Shell，三个工作区与跨Project来源/媒体/证明复制、Studio选材，素材库真实PNG预览/可信选题/唯一草稿/单次投递，标准Studio，旧新闻入口兼容，原页来源截图，来源Studio，媒体录制、转码、原生成片和Qwen HTTP旁白夹具。主要证据位于 `.bmw-runtime/desktop-workspace/`、`/private/tmp/bmw-library-news-verified/` 及本次 `/private/tmp/bmw-library-*.log`；这些是隔离夹具，未调用真实付费模型或TTS，不宣称人工核听或内容接受。

整片夹具最初在静态录屏阶段超时，保留原日志；改为与实际BMW一致的WebContentsView后，两段真实颜色录屏及原有像素、时长、音轨、取消和导出断言全部通过。标准Studio夹具对预填消息按 `bmw-assistant-prefill` 通道计数，工作区上下文事件另行投递，不改变原有仅填入原会话输入框的断言。退出后的旧页面状态事件不再触碰已销毁窗口。中间失败没有计为通过。

## 整合前完整验证基线

2026-10-20 当前整合后的完整 `--all` 为 **173 passed／0 failed／12 opt-in not-run**，报告为 `.bmw-runtime/news-daily-main-integration/full-final/result.json`，受测输入以本次提交前冻结的源码 SHA 为准。构建、check、功能与架构清单、unit／contract／boundary、官方 DSH 冷检查、desktop、Studio、media、video、speech、本地旁白与 Qwen HTTP 夹具通过。逐项结果、全部非 Markdown 输入的 SHA、依赖和报告指纹见 [CURRENT](verification/CURRENT.json)。本节与状态说明在报告后回填；受测实现文件指纹逐项复核一致。

WorkBuddy 使用官方 CodeBuddy Code 2.169.0，经实际认证 BMW MCP／Bridge 验证三模型的完整 browser schema、两轮工具调用及不可变原生 Session 续聊；探测固定输入只到本机拒绝端点，任务链路使用本机 SSE 模型夹具。另覆盖额外工具／其他命名空间工具、schema／模型／版本漂移、空工具伪证、Project 服务覆盖、准备取消、慢事件写入、失败模型 outcome、原生输入回执、系统加密测试替身、明文／损坏文件保留、进程组清理和失败后仅显式恢复。默认入口验证四个独立空会话、WorkBuddy 缺失 Key 状态与重启归属。WorkBuddy 的 configured／unverified 可选择路径不改变其他引擎的 ready／verified 门槛。

此前WorkBuddy接入的首轮完整报告 `.bmw-runtime/workbuddy-integration-final/result.json` 为 172 passed／1 failed／12 not-run，仅 Studio 的瞬时冲突状态轮询超时；独立复查另暴露撤销后预览尚未清理时点击禁用时间轴的夹具竞态。现等待真实控件就绪，并捕获实际冲突 DOM 更新；播放头／像素、CAS 外部修改保留与本地输入断言保留。独立复查与上述最终完整基线均通过；中间失败没有计为通过，也未用于替代最终源码覆盖。

12 项 opt-in 未运行；真实 API Key、服务权限／额度、付费模型、在线配音、生产 Profile 和系统凭据提示均不在本轮覆盖内。Electron／DSH 使用一次性 Profile／Home／Workspace 与 mock keychain。Windows WorkBuddy 进程树清理尚未验证，输入前保持不可用；图像／音频准入和原生桌面历史未宣称支持。六个冻结类型例外未增加。

本轮整合保留两次中间完整报告（均172通过／1失败／12未运行）：首次为新增媒体关闭故障测试的固定次数预期，改为核对每次显式恢复增量与隔离／状态；第二次为Studio分隔条按下已收到但移动未改变高度，输入／合成时序只是推测。夹具现在等待实际捕获和绘制、验证中间真实拖动，再保留最终高度、Escape、持久化与内容不变断言。原生媒体专项及两次独立卡片专项均通过；上述失败不计为通过，最终完整源码以本节基线为准。

## WorkBuddy 真实 browser 调用

2026-10-20，用户在 BMW 中填写 Key 并授权最小连通验证。官方 WorkBuddy 2.169.0／deepseek-v4.1-flash 完成一次实际任务，Host 记录恰好一次 browser 开始／成功完成、官方输入回执、本轮 success 和清理后的 idle；显式刷新设置后显示当前 Key／模型已通过真实任务验证。验证请求为 browser status，不采集页面正文或创建媒体。脱敏证据见 [WorkBuddy 调用记录](research/WORKBUDDY_BROWSER_DELIVERY.json)。此项使用真实服务，与上方 173 项离线基线分开；不扩大到其他模型、图像／音频、Studio 制作或 Windows。Key、原生转录及 Project 内容均未写入仓库。

## 新闻日常媒体修复与交付

共享媒体worker以至多16项FIFO协调GUI／Agent解码核验，取消等待实际清理。映射采集写显式视频BlockDuration并独立解复用验证终帧；未知时长Opus包保留原值及编码负载。尾部视觉时间与原片视频终点比较，不能混入AAC填充；原有蓝色尾帧、源／文件中间帧像素、音轨、暂停恢复和取消回滚继续核对。来源测试夹具显式请求帧，并保留原片、轨道及帧数诊断。

首轮完整165通过／2失败发现零时长Opus包误拒绝；补正后166通过／1失败发生于来源夹具元数据加载，尚未开始采集。最后补齐首帧生产及预检后，旧分支完整167项通过；历史源码见[新闻验证快照](history/2026-10-20-before-news-daily-integration/NEWS_DAILY_CURRENT.json)，不作为当前主线覆盖。各次原始失败、旧166／1尾帧基线及当时源码保留，不合并通过数；详见[历史快照](history/2026-10-19-news-daily-before-fixes/CURRENT.json)。12项未运行是六个专用素材夹具及六个外部入口；付费模型、在线Qwen、人工听感与内容接受另记。所有离线Electron／DSH使用一次性Profile／Home／Workspace与mock keychain，6个冻结类型例外不变。

真实Qoder／Qwen的AI养老新闻与资料片段修订分别见[交付](research/NEWS_ELDERCARE_DELIVERY.json)和[素材修订](research/NEWS_ELDERCARE_FOOTAGE_UPDATE.json)。历史文件指纹与Agent意见保留，人工听感和最终接受仍待用户；不计入离线基线。

## NEWS-01 真实新闻验收

**当前54.61秒BMW＋官方Codex新闻已获用户接受。** 技术完成、真实检索与制作、局部改稿保留、Agent画面审阅、旁白自然度反馈和最终接受分别保存在[Codex验收记录](research/CODEX_NEWS_REWORK.json)。用户先选定龙安朗并认可旁白自然，再要求结尾回到DeepSeek新版的低花费与精细制作，最后回复“这个版本可以了”。该接受绑定当前导出，不补造逐字发音、声学对齐或观众复述分数，也不反向改写旧片结果。

| 版本 | 实际制作与保留检查 | 用户结果与证据 |
|---|---|---|
| DeepSeek公告片，59.648秒 | BMW＋官方DSH／deepseek-official/deepseek-flash，Qwen安明远；可信选择只投递一次，中段局部改稿保留191个既有文件及无关音频／图层／字幕 | 用户认为更适合图文，未接受；[原记录](research/NEWS_01_DELIVERY.json) |
| 同题3D电机对比，36.16秒 | BMW＋官方DSH，Qwen安明远；保全1080×1376完整40秒平台分发文件，以真实运动区间制作；局部改稿保留446个文件 | 用户认为声音不自然、新闻重点不清楚，要求改用BMW＋Codex；[原记录](research/NEWS_01_VIDEO_TOPICS.json) |
| 同题对比重做，54.61秒 | BMW＋官方Codex 0.160.1／gpt-6-astra，Qwen龙安朗；720×1280／24fps AVC＋AAC。末镜重配12.4秒，前五镜全部数据、音频身份与SHA不变，793个历史文件保留 | 当前导出136个关键帧、六场及全片Agent意见，开发侧另看末镜三帧；用户已接受，详见上方Codex记录 |

首次真实研究在BMW展示Apple 10月16日规则强化和DeepSeek 10月17日更新两张合格卡片，用户选择后才配音与合成；随后用户明确换为X原作者当天发布的3D对比案例。日期、真实原页预览、可信选择与独立Session所有权均有记录。X中文发布时间可带本地时钟前缀，日期只取日精度并保守检查72小时；新闻专项21个用例通过，已纳入当前完整离线基线。此前静态停留、小字及字幕editorial-estimate等限制仍保留在各片原记录。

最终新闻把作者本次DeepSeek $1.25／Opus 5.5 $16.36花费与作品效果联系起来，金额只代表该作者本次案例，不作为官方单价或总体排名。原高清素材、全部旧声音、草稿及导出保留。真实付费模型、在线Qwen及人工接受不计入166项离线通过数；当前用户反馈不等同模型具备音频准入。

## DSH 科普与学术重制

两条完整新主片使用隔离 BMW Project／Session、官方 DSH `0.2.1-rc.2` 与 `deepseek-official/deepseek-flash`，实际请求工具恰好一个 `browser`。科普参考量子位S10的实物主体与局部图解；学术参考AK A01的生成流、工具返回和连续KV。保留各八场全文与八段真实Matcha WAV，原生导入、逐字节核对，不重复TTS。原Qoder工程、原素材与全部旧导出保留。实际MP4、来源SHA、完整字幕核对、当前关键状态帧及Agent意见见[交付记录](research/DSH_SCIENCE_RESEARCH_DELIVERY.json)；人工听感、理解和接受单列。

长篇图像历史触发过DSH上下文溢出。BMW预设补入官方Agent内的自动压缩与旧工具结果裁减；正式wire的`append`照常配对调用，只有相邻裁减声明及来源序号吻合的替换才作为历史投影处理，不能替当前工具完成。原始媒体与宿主回执保持。科普同一原生会话实际记录了367项历史／约291939 token的压缩摘要，并继续完成制作；只导出事件类型和序号元数据，不导出私有推理或摘要正文。

两片实测分别为210.859秒和229.248秒、1280×720／24fps、H.264/AAC；当前各192张关键状态PNG、八场与独立全片Agent意见均齐。根侧另实际查看各16张及学术5张定点帧，确认亮底描边、Table6末行和KV两项保留；自动小字／静置提示及少量次要标题／引用上缘裁切保留在交付记录。学术字幕为直接指定的编辑估计时间，未保存句锚；科普句锚另核对文件SHA。两者都不代表声学对齐或人工核听。

制作阶段的两次完整离线回归均为162 passed／0 failed／12 not-run；[后一次阶段报告](../.bmw-runtime/classified-tests/2026-10-17-dsh-compaction-events/result.json)冻结于最后`append`格式补正之前，随后两文件另通过94项单元／契约／边界、36项DSH专项与官方冷检查。它们保留各自源码范围，当前补正后的完整基线以上方新报告为准。预设YAML已纳入源码图，另核对两份实际安装副本SHA。制作日志、指纹及中断证据保存在交付记录；真实模型制作不并入离线计数。

## DSH 0.2.1-rc.2 与 SI 新闻

当前DSH安装与适配基线为官方 `0.2.1-rc.2`（npm `next` 候选版）。新版预设继承全局工具；BMW在官方 `agent/created` 初始化中将该Agent的继承能力限制为唯一 `browser`，预设使用native呈现，Host准入与逐次请求装配检查实际 `wireSchemas`，并核对真实请求header。冷检查覆盖异步MCP就绪后的实际目录、私有凭据设置／清除、无Key时隐藏模型及配置后目录恢复，不发送模型输入。

构建、check、功能／架构发布及[SI阶段分类报告](../.bmw-runtime/classified-tests/2026-10-17T12-12-10-501Z/result.json)通过：**162 passed／0 failed／12 not-run**，含unit／contract／boundary及DSH、desktop、Studio、media、video、speech、本地／Qwen旁白夹具。该报告按明确变更文件选择到完整离线范围，运行期间源码一致；不将其称作一次 `verify:stability --all` 基线更新。最初受限环境启动Electron得到143退出的报告保留，后续在允许原生启动的环境重跑通过，断言未放宽。

独立真实制作见[DSH SI交付](research/DSH_SI_DELIVERY.json)：隔离Profile／Home／Workspace，实际请求为 `deepseek-official/deepseek-flash`、唯一browser，官方运行时拥有循环。官方10月17日更新将该路由指向V4.1-Flash-1017，回执只独立证明路由，不声称另行探测服务端checkpoint。新建自有草稿后在同一Session续做，最终revision34／export33，实际MP4为57.664秒、720×1280、24fps、H.264/AAC。六段先前真实Qwen安明远男声WAV逐字节复用，原生记录为imported，不冒充本轮新TTS。原脚本标题误作分段的问题已通过明确停止、纠错续做修复，最终六场script、audioText、文件及native anchor SHA逐项相符；不自动重放未知投递。

最终指纹 `b88fb04af048c74079c671069cf25e68d3c5058bc66da70bb946d91b4932ff65` 的144个关键状态PNG均有原文件SHA及六场Agent声明，另有较晚的独立film声明；开发侧另查看最终六场实际帧，确认结尾问句与右侧红条分开。用户随后在对话中表示“基本满意，比之前qoder CN要好多了”，反馈已绑定该指纹保存在交付记录；不据此补造专项核听、ASR、观众复述或Studio人工验收。原Qoder V4、所有中间导出与来源保留；既有P1交付清单继续指向其原有版本。

## 2.10 类型与 AK 增量

新增 production、production-assessment、research-diagrams、precomposition 专项共14项已通过；覆盖版本往返、显式类型采用、源文件变化、影响矩阵、句目标重绑、来源环、六版外部结果身份、审阅来源与CAS，以及预合成取消／隔离／晚回执回滚。原生专项实际检查事件／双序列测量／对数散点／代码行和聊天分组，逆序与剪切 Canvas 像素差为0，实际MP4抽样帧相同；16格代理完整解码，并通过 MediaController → Studio 的真实回执入库。技术夹具使用重复源，不冒充16份独立实验。原生报告在 `.bmw-runtime/p1-ak/native/2026-10-17T06-00-27-797Z/result.json`。

当前Schema／功能／架构生成及check通过；[最终冻结完整报告](../.bmw-runtime/classified-tests/2026-10-17-p1-ak-frozen/result.json)为 **162 passed／0 failed／12 not-run**，逐项结果和source-integrity以该报告为准；[可移植交付清单](research/P1_AK_DELIVERY.json)保存计数与458个受测文件的源码指纹。覆盖unit／contract／boundary及DSH、desktop、Studio、media、video、speech、local narration、Qwen夹具；157分类项加5门禁／桌面汇总不重复计数。十二个opt-in未运行项包括六个专用本地素材夹具和六个外部入口；Qoder真实制作是单独显式执行，不将其算进离线项。冻结后的视频内容修订仅修改隔离Project；451个非Markdown受测文件的SHA保持一致。最后清洁构建与输出比较结果单列于交付清单。

中间报告均保留：04-33-08完整断言通过，但修复原生代理回执缺少fps并调整图表期间source-integrity正确失败；04-42-34的中间冻结基线为162 passed／0 failed／12 not-run；04-57-44在多制作窗口并行时出现assistant.application播放头断言失败，且诊断修改导致source-integrity失败。播放头用例随后单独复查通过，原断言未改，未据此认定并发就是根因；随后在所有付费制作窗口退出后复查。第一次收尾报告`2026-10-17-p1-ak-final`为161 passed／1 failed／12 not-run，source-integrity通过；在制作窗口全部退出后仍复现同一播放头问题，排除了先前将其直接归因于并行窗口的解释。现已捕获操作前逻辑时间，串行持有对象选择／保存／预览事务并禁用准备期间主轨操作；脚本等待真实操作完成后仍保留原1秒断言，专项通过。这些中间结果不作为最终源码覆盖，不将多轮通过数相加。新增精确quoteSpans和只读cover候选入口均进入最终构建。 renderer10的首轮完整报告`2026-10-17-p1-ak-complete`为161 passed／1 failed／12 not-run，source-integrity及assistant.application通过，仅Studio未保存输入冲突用例失败。该用例此前只等待任一属性可用，现等待确切对象与选择／预览事务完成；独立复查保留原冲突、输入保留、音轨CAS和播放头断言并全部通过。测试准备期间曾把DOM数值0.5误写为.5，导致前置等待失败；已纠正，未作为产品失败或通过证据。renderer10的后续`2026-10-17-p1-ak-v2-final`仍为161 passed／1 failed／12 not-run，源码一致性通过，失败位于重做后立即选择右旁白片段。随后核对发现主轨控件在预览准备时仍显示可点，但选择逻辑已拒绝；现已在准备开始和重绘时同步禁用真实主轨控件，准备清理完成后恢复。GUI测试统一等待确切时间轴目标可操作及保存／预览事务结束，再执行一次点击；原版本、输入、音轨、像素和播放头断言不变。该版本独立Studio复查通过；最新完整报告仍以实际结果为准。

用户已明确授权本次BMW已配置的Qoder CN账号。真实视频使用官方目录`dfmodel`／DeepSeek-Flash，初始化有效工具仅`browser`，官方运行时拥有循环。开发侧入口`scripts/qoder-production-case.ts`提供明确任务、隔离Project和本次授权鉴权；临时鉴权在退出时清理，原生产Project未改动。Qoder阶段的三条完整主片为：Musk SI新闻V4 57.792秒、机器人科普V2 215.0827秒、HybridAgent学术V2 229.4827秒，均为24fps、renderer10；当前抽样与逐场／全片Agent意见、SHA和可编辑工程见[交付清单](research/P1_AK_DELIVERY.json)。新闻V4使用用户提供的“牧语手记”写作技能重写，保留已认可的引用尺寸，当前六段真实Qwen安明远男声旁白合计51.52秒；字幕与图层按新音长调整。初稿“少了一个字母”经根审阅发现后已改为“只换一个字母”，仅重配hook，其余五段保留身份与SHA。科普只替换第5场18.4322秒旁白、保留其余七段；只读影响计划的真实两页结果确认七段keep／一段rebuild及句锚rebind。字幕时间仍为编辑估计，不冒充声学对齐或模型核听。

另四条历史技术／换题证据为AK组合27.072秒、韦布新闻50.4107秒、吸管科普44.736秒、WEDGE学术56.1493秒，renderer9下实际抽样31／95／72／72张及Agent意见保留，不冒充renderer10当前复用；后两条短片只证明换题迁移。所有旧版文件、重制前草稿快照、中断及失败证据保留。部分小字／停读与来源采集缺口继续记录，科普结尾的原素材人类持吸尘器引入不作为机器人实验证据。用户观看过V1并否定形式，随后肯定新闻V2的引用尺寸与节奏，否定其声音和通用点评；新闻V3针对重做后，用户表示许言初音色可暂用；V4再按用户新要求试写并换安明远男声。最新版本的专项听感、复述、预测和接受仍待确认，Agent视觉passed不关闭内容验收。

真实调用曾发现cover-only影响试算缺少公开输入，现已补齐可选`cover`闭合候选；新增服务级不写入／不编码检查及Qoder实际5次browser调用证明cover rebuild／video keep、32个场景项keep、revision41和原MP4不变。AK三份16格代理使用A03同一源的16区域，完成360p／720p和输入改变重建；A04通过显式2x再1.5x映射，未放宽单字段2x上限。A06/A08/A09导入保留实际文件SHA，但外部生成服务未调用，六轮链为契约夹具。此前24秒试片及45分钟中断均保留，后续使用新明确输入核对已存状态，只完成缺失工作；不将旧导出或中断轮次冒充最终版本。人工听审、复述／预测均未执行；[音频准入矩阵](research/AGENT_AUDIO_ADMISSION.md)仍无三个驱动已核听的证据。

## 既有三方对齐完整基线

该完整基线早于 Qwen TTS 接入，适用于归档所绑定的源码。具体修复及失败过程见[验收归档](history/2026-10-17-alignment/README.md)，可移植的[逐项摘要与源码指纹](history/2026-10-17-alignment/verification.json)随仓库保存；Qwen 的增量范围单列如下。

| 本次执行 | 结果与范围 |
|---|---|
| npm run build、npm run check | 通过：编译、冻结源策略、Schema／示例、功能与架构清单一致性 |
| docs:video-schema、docs:features、docs:architecture | 已重新生成并检查；生成行为本身不计作测试通过 |
| npm run verify:stability | [完整报告](../.bmw-runtime/classified-tests/2026-10-17-alignment-final/result.json)：154 passed、0 failed、11 not-run；149分类项＋5门禁，包含unit／contract／boundary及相关运行时；桌面汇总不另算独立保障 |
| 修复专项 | 音频首次中段／重叠PCM对照、音轨菜单预览和AAC、来源GUI、96镜头Assistant、版本发现契约通过；这些已被最终完整回归包含，不叠加计数 |
| 文档与提交校验 | 提交前复查链接、锚点、git diff --check和全部非Markdown受测文件SHA；两条旧本机日志缺失仍明确保留在历史归档 |

六个未运行项依赖显式本地素材：media.source-analysis-case、media.frame-sampling-case、media.long-composition-case、video.qbit-playback、video.qbit-stage4-samples、video.qbit-stage3-samples。另五项为external.assistant.dsh/codex/qoder-cn、external.vision和external.edge。runner的统一原因文字不代表六个素材夹具属于外部服务。

Electron使用一次性数据和模拟钥匙串。首次受沙箱启动限制及之后定位到的三项失败均留档；不是重试掩盖失败。正式基线绑定修复后源码；完成后仅回填说明文档，受测代码／配置／Schema的430个SHA保持一致。原始日志、截图和媒体留在本机，GitHub仅保存摘要及指纹，不宣称远程CI已运行。

## Qwen TTS 验证范围

BMW＋官方Codex 0.160.1／gpt-6-astra另外通过唯一browser生成三条同文、0%语速的真实Qwen男声试听：霍拙石10.40秒、龙安朗8.96秒、龙三叔12.00秒，均经原生inspect验证24kHz单声道PCM16 WAV可解码。原生HTTP夹具验证三种新增voice经browser入参、固定模型请求及解码路径；desktop验证设置内男声试听。三条实际音频与SHA见[Codex重做记录](research/CODEX_NEWS_REWORK.json)。真实服务成功与离线回归分列；用户已选定龙安朗、认可本片旁白自然，并接受上方54.61秒最终新闻。其他音色不因此被认定为人工音质通过。

Qwen 增量已通过构建、`npm run check`、单元／契约／边界，以及相关 DSH、桌面设置、Studio 资讯设置、媒体处理、视频导出、本地旁白和 Qwen 旁白夹具。分类报告为 `.bmw-runtime/classified-tests/2026-10-17T03-15-55-791Z/result.json`，90 passed、0 failed，选择范围是 unit／contract／boundary；后续 Shell 调整另通过检查及最终桌面设置回归，不将这些结果称为一次新的完整 `--all` 基线。

| 检查入口 | 已验证内容 |
|---|---|
| platform.qwen-credentials | 密文持久化、0600 权限、重新读取、空 Key 保留、配置投影不含 Key；弱加密／解密失败／损坏或链接文件拒绝覆盖，显式清除 |
| media.production、video.settings、video.boundary | 固定模型／音色／地域／语速、模板及 Studio 参数、独立在线许可；下载来源、大小和 WAV 校验；不携带 Key 下载、不重试、不接受模型凭据参数 |
| qwenNarration | 固定 HTTP 响应下的原生 WAV 保存与真实解码时长、试听回传、失败／取消清理、清理失败隔离及显式恢复 |
| desktop.settings | mock keychain 下从真实 Shell 表单保存／重读／留空保留 Key，Key 不回显；设置内实际解码与播放器播放、未保存修改阻止试听、错误脱敏、取消／关闭清理、Project 切换排他及清除配置 |
| 相关 DSH／Studio／媒体／视频／本地旁白 | 既有驱动和编辑入口、实际媒体编解码与导出、本地禁网络配音及取消回滚的回归范围 |

构建后可单独复现 Qwen 夹具与桌面设置检查：

```bash
BMW_TTS_TEST_PROVIDER=qwen-fixture node scripts/run-electron-script.js scripts/narration-smoke.js
node scripts/desktop-suite.js --groups settings
```

这里的 `BMW_TTS_TEST_PROVIDER` 只选择测试分支，不是用户凭据配置；正式配音从 BMW 设置读取凭据。检查始终使用一次性 Profile／Project 和模拟凭据，不读取生产配置。桌面证据保存在 `.bmw-runtime/desktop-suite/`，包含 `qwen-settings-audition.png`；本机原始日志不随提交上传。

安明远男声音色增量的相关检查为 **76 passed／0 failed／98 not-run**（71 个选中分类项及 5 个门禁／汇总），报告 `.bmw-runtime/classified-tests/2026-10-17-news-muyu-male-native/result.json`。覆盖封闭音色枚举与跨提供方拒绝、实际 Shell 男声试听、Studio 参数持久化、原生 Qwen 男声请求及 WAV 解码、取消／隔离恢复和相关媒体／视频／边界回归。此前受限环境下原生进程启动即退出的报告另行保留；原生运行环境补跑全部选中项成功。该增量报告不替代此前 162 项完整基线，也不计入真实服务调用或人工听感。

上述自动回归不证明真实百炼 API Key 有效、账号有额度、模型权限已开通或实际合成音质合格；正弦音频夹具的播放不等于中文音色核听。另行真实制作已执行：用户在本次一次性 BMW 的 [Qwen 设置](../README.md#qwen-配置与试听)表单填写凭据，原生加密保存与固定短试听成功；BMW＋官方 Qoder CN／DeepSeek-Flash通过唯一 `browser` 生成闻怀之／许言初／许玉远三份同文样本（5.28／4.32／5.52秒），再生成六段许言初旁白，合计46.88秒。V4另生成六段安明远男声旁白，并为开头事实修正重配一段；最终六段口播合计51.52秒。十六个 Project WAV（含保留的旧hook）均由原生 `media.inspect` 或视频合成层验证可解码，音色与音频身份见[交付清单](research/P1_AK_DELIVERY.json)。此记录证明本次真实服务调用成功，不计入自动回归项；未覆盖生产 Profile，主观听感、发音和用户接受仍待人工确认。

## 已有证据与适用范围

| 证据 | 已记录的范围 | 当前解释 |
|---|---|---|
| .bmw-runtime/classified-tests/2026-10-15T14-06-49-153Z/result.json | 完整 --all：142 passed／0 failed／5 external not-run | 首次文档整理时，旧报告的410个文件中55个已变化，不覆盖之后新增文件；保留为历史完整快照 |
| .bmw-runtime/qbit-final-report/completion-audit.json | 2026-10-16 四阶段；89项 unit/contract/boundary、桌面五个结果（含重启）及相关运行时 | 来源11条、4268基础帧／4494总帧，夹具 reviewed=0；长篇640×360／12fps；不是全视频语义审阅或新版完整 --all |
| .bmw-runtime/qbit-playback-review/review-evidence.json | 2026-10-17 四条样片副本修订、72张关键帧和实际播放器 ended 记录 | acousticListeningCompleted=false；PIP已改横屏，实际文件34.730667秒，时间线34.666667秒；不沿用旧40秒全竖屏说明 |
| .bmw-runtime/pelican-p1/verification-summary.json | 实际 BMW Codex＋GPT-6.1，3回合／76调用，唯一 browser；资源保全／采集／音频技术证据 | 技术门通过，allRequestedP1Resolved=false；模型未接收音频，Veo最终归因未闭环 |
| Simon V1／V2 及双驱动生产可靠性 | 实际制作、当前指纹关键帧及单独整片 Agent 意见 | 历史版本的内容验收范围；不能推断用户已认可或已核听，详见下方历史入口 |

首次文档整理读取了量子位审计、播放证据和旧完整报告，并比较旧报告中的源码SHA；后续完整离线回归也没有重新解码全部专用样片或重复视觉／音频审核。样片和原来源哈希保持属于各阶段报告的证据声明，不扩写成本轮全量实测。

## 历史记录入口

- [媒体P1、Simon、生产可靠性、共享Schema及失败过程](history/2026-10-17-documentation/VERIFICATION.md)：保留整理前的详细原文。
- [三驱动实施验收](history/agent-drivers/IMPLEMENTATION.md)：固定版本和真实模型历史快照，部分临时路径可能不在当前机器。
- [量子位四阶段与播放修订](history/qbit/IMPLEMENTATION.md)：完成范围、样片版本、S04缺口、声音与叙事限制。
- [更早的一致性／P0记录](history/2026-10-07-consistency/index.md)：原文与相对路径按当时上下文解释。

<a id="simon-研究与叙事重剪"></a>
Simon 的两册研究、98个记录组与V1/V2详见[原记录](history/2026-10-17-documentation/VERIFICATION.md#simon-研究与叙事重剪)。研究完成、技术完成、Agent意见和用户满意度分别记录。

<a id="user-listened-whisper-base-adoption"></a>
十段base标注的用户核听采用见[原记录](history/2026-10-07-consistency/VERIFICATION.md#user-listened-whisper-base-adoption)，不是独立声学金标或自动词／字精度批准。

## 命令与覆盖

| 命令 | 实际范围 |
|---|---|
| npm run build | 编译所有作者 TypeScript、正反类型消费者，生成源码／输出哈希收据 |
| npm run check | noEmit 编译、源语言／冻结例外检查、视频 Schema／示例、功能与架构生成清单一致性 |
| npm test | 分类 unit、contract、boundary；不是全部 runtime |
| npm run test:contracts | contract 与 type 分类 |
| npm run test:studio-e2e | video-studio-smoke 默认分支；不自动触发其各个专用分支 |
| npm run test:desktop-e2e | 四个 desktop 分组及 Project 实际重启；各组独立报告 |
| npm run test:media-e2e | 后台页面、采集、处理；不含全部视频／语音分支 |
| npm run test:video-e2e | 原生视频 smoke；实际混音、H.264/AAC、轨道／时长与验证回执 |
| npm run test:tts-e2e | 默认 local-matcha 本地旁白；Edge 需显式 opt-in |
| npm run test:affected -- --files … | AST 依赖、行为 watch 与接口保障选择并执行；未知／删除／共享配置（含 workspace manifest）保守升级 |
| npm run verify:stability | 一次fresh build后串行全部非opt-in分类，包括各Studio环境分支；专用素材夹具和external单列未运行 |
| npm run docs:features / docs:architecture | 刷新源码生成清单；刷新本身不是测试通过 |

所有含构建的命令顺序执行。资源受限时使用 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。直接调用 test-runner 必须匹配最新 build receipt；源码在验证中变化使 source-integrity 失败。完整通过时才更新 test-baseline.json；失败保留旧完整基线和本次失败日志。

`studio.export-review` 等包含真实本地旁白合成的分支需要本地 TTS 模型；缺失时先执行 `npm run setup:local-tts`，网络环境需要时配置代理。资源缺失应在报告中与代码回归区分，未成功执行仍记录失败或未运行；不得以桩替代宣称真实本地合成覆盖。

## 证据边界

Electron 使用临时 Profile／Project，DSH 使用临时 Home／Workspace；macOS 测试使用 mock keychain。真实生产 Profile、系统钥匙串授权、实际用户使用体验及设备／网络差异不能由隔离夹具证明。原生鼠标事件、DOM／IPC、共享 Canvas、实际 MP4 和音频验证按各日志范围解释，不扩展为完整用户验收。

离线测试不使用付费模型或 Edge 网络语音，不证明 OAuth／Key 有效性、余额、所有模型额度、翻译／建议质量或完整视频语义。external.assistant.*、external.vision、external.edge 是独立 opt-in；本轮不重新运行。专用 AI 素材生成暂缓，无对应服务接入或验收。

## 维护当前基线

VERIFY-01已按上述范围完成并[归档](history/2026-10-17-alignment/README.md)。下一次实现或测试改动按AGENTS重新验证；不得把旧142项、阶段89项和当前154条记录相加。当前优先级见[下一步设计](plans/NEXT_STEPS.md)。本机运行产物被Git忽略，换机需单独保留；路径存在不代表完整内容已审阅。

## 本机记录补收验证（2026-10-17）

[补收审计](research/LOCAL_RECORDS_AUDIT.md)仅改变文档、规划及证据索引。npm run build、npm run check、单元／契约／边界 89 项全部通过，75 项不在本次选择范围；[可移植回执](history/local-deliveries/verification.json)保存结果和源码身份，本机完整报告为 `.bmw-runtime/classified-tests/2026-10-17T02-36-42-643Z/result.json`。430 份源文件与此前完整隔离基线一致；不把本次 89 项称为重新执行完整 154 项。链接无新增缺失、21 个既有规范锚点通过；两份历史驱动日志缺失保持原标注。未新增或移动测试，不需改写测试生成清单。
