# BMW current handoff

视频取材按目标身份绑定；X／微博既有公开样本各2/2完成原生获取和独立完整性核对，YouTube原生工作标签、SABR／分离双轨实现及实测限制以[功能说明](docs/FUNCTIONAL_SPEC.md)和[计划](docs/plans/YOUTUBE_NATIVE_ACQUISITION.md)为准。保留HTTP/HLS，不引入yt-dlp与TikTok专用适配。

新闻发布者的当前实测中，Fox HLS完整保留720p、2音轨、1条英文字幕；Yahoo Finance保留1080p、3音轨、en与en-US两条字幕。字幕为独立WebVTT，原始分片和时间索引留证，未知／缺失轨整体失败并清理，禁止自动降为无字幕MP4／录屏。独立逐cue、全音视频解码、身份/取消/Project清理及所需回归通过，详见[验证记录](docs/verification/NEWS_HLS_SUBTITLES_DOWNLOADS.json)。CNBC与CNN对应样本及版本范围见[发布者记录](docs/verification/NEWS_HLS_CNN_DOWNLOADS.json)。

BMW 当前提供浏览器、素材库、Video Studio 三个并列工作区。素材库自动聚合各 Project 的已保存来源和媒体，支持全库检索、日期/状态筛选、收藏、标签、批量整理、历史新闻批次和跨 Project 完整证据复制；素材仍归各自 Project，目标副本及其说明独立保存。新闻收集与选题位于素材库，可信选择后进入原生 Studio；旧草稿、会话、来源和投递记录保留，唯一模型工具仍为 browser。

素材库组织、作品溯源与来源/事件容量六阶段已实现：Project 专题、全局方向、独立用途及参考/计划关系；Studio与直接合成自动记录独立导出版本、实际采用材料SHA、角色、文件/输出区间及复制来源身份。成品按作品分组，支持版本→材料及材料/来源→成品双向查询；缓存复用不新增，旧成品采用未知，原资料、新闻批次和草稿保留。来源/事件采用不可变分片、可重建SQLite增量索引和固定快照分页，来源流/事件记录提供完整检索与可信维护；旧来源目录只读兼容。来源订阅已支持有界手动巡检、线索与事件修订、可追溯归并/拆分、采集游标及X/YouTube可见指标观察；严格十题事件推荐快照、方向策略、专题筛选和旧news交接也已接通；已接通明确Project/Session/driver绑定的周期采集、用户任务优先、重启回执核对、失败退避及健康通知；资源空闲时可在独立隐藏页采集未激活绑定，不切换前台工作区；用户任务先等实际清理，未知输入不自动重投，见[设计](docs/plans/LIBRARY_STREAMS.md)。验证范围与报告见[验证说明](docs/VERIFICATION.md)。

增量批量采集提供可信素材库勾选至多九源的一次官方输入，2–3路隐藏页面读取、串行来源CAS、保留pending的URL检查点和一次批量线索提交；X趋势可保存带明确缺口的观察，完成游标始终不推进。原单源采集、事件整理、十题推荐及制作入口保留，周期计划不自动启用。不确定输入不重投，取消等待实际页面／驱动清理。设计与分层实测见[批量采集方案](docs/plans/COLLECTION_BATCH_OPTIMIZATION.md)和[验证说明](docs/research/COLLECTION_BATCH_VALIDATION.md)；已登录主Profile官方驱动的九源验收与隔离实测分别记录。

AI新闻固定来源目录提供24项可选订阅，默认暂停、稳定预设ID重复保全；新增社媒观察类型并拦截登录/挑战页推进游标。真实公开网页的72小时采集、原文、线索/事件及推荐验证使用隔离Project，X/YouTube访问限制独立记录，见[真实来源验证](docs/research/AI_NEWS_REAL_SOURCES.md)。

主Profile实际续验保留九项订阅及初始72小时九题不足快照，已完成约41秒DSX POD首片、原生SRT、完整稿件、111帧／五镜／整片Agent意见、独立画面检查及实际采用双向查询；旧数据SHA保全。后续第一轮更新六个入口并整理为23条线索、17个事件，新72小时快照核验合格严格十题，沿原入口完成31.5秒开放模型新片、六镜／68帧与独立整片画面检查、原生SRT及12项采用双向查询，PHP修复第二条亦完成40.04秒、五镜／59帧与独立整片画面检查、原生七条SRT和11项采用双向查询；合计后续2／4条、完成1／2轮，第二轮已恢复有界采集。流程有GUI辅助，人工听感／用户接受待验，见[实际验证](docs/research/AI_NEWS_MAIN_PROFILE.md)与[首片证据](docs/research/NEWS_DSX_POD_DELIVERY.json)。

NEWS-DAILY已修复Studio预览／新闻核验争用共享解码worker，以及映射采集终帧被WebM默认时长压短的问题；末个Opus包未知时长保持原值。来源夹具改为显式绘制／请求首帧并独立核对真实编码轨道，保留加载诊断。最终完整离线回归为**167 passed／0 failed／12 opt-in not-run**，466项非Markdown受测输入与437个生成输出另核对；两次先前失败完整报告保留，不合并计数。见[修复证据](docs/research/NEWS_DAILY_FIXES.json)与[当前验证](docs/verification/CURRENT.json)。

当前日常流程采用BMW＋官方Qoder CN／DeepSeek-Flash（dfmodel）、Qwen龙安朗与AIpardonSI News；先读[日常手册](docs/NEWS_DAILY.md)。严格近72小时、最多十个独立事件，优先完整原声／动态演示，可信用户选择后才制作。最近记录的新闻会话“新闻速递 / Qoder Flash / 10-19 下午”已完成用户所选AI养老沙龙图文新闻，约49秒，逐镜／整片Agent审阅已记录，原WAV和旧成片完整保留，见[交付证据](docs/research/NEWS_ELDERCARE_DELIVERY.json)。历史交付记录包含暂停状态；嘉宾原声未取得、人工听感与最终接受待确认。扩展十题卡片和日常效率仍待补齐，不重跑既有配音或冒充无人值守验收。

NEWS-01的54.61秒DeepSeek对比片与NEWS-02的43.03秒Chuck Lorre片已获用户接受，分别见[NEWS-01](docs/research/CODEX_NEWS_REWORK.json)、[NEWS-02](docs/research/NEWS_02_LORRE_DELIVERY.json)。IMF两版用户仅反馈“Qoder CN版更清楚”，声音／画面／整片接受仍待反馈；[双版记录](docs/research/NEWS_IMF_CLARK_DUAL_DELIVERY.json)与[Replit原声修复](docs/research/NEWS_REPLIT_DUAL_DELIVERY.json)独立保留。

## 当前产品与下一步

先读[仓库约束](AGENTS.md)、[文档导航](docs/README.md)、[当前状态](docs/PROJECT_STATUS.md)和权威[功能规格](docs/FUNCTIONAL_SPEC.md)。BMW是唯一应用，DSH、Codex、Qoder CN和WorkBuddy各自拥有官方Agent循环；有效目录验证通过后才释放输入，模型工具恰好一个`browser`。Host不实现模型循环，不以提示词替代工具边界。

NEWS-01提供严格近72小时、广泛个人／组织主体、最多十个不同事件的真实素材选题卡，用户可信选择后建立所属Session的唯一草稿并单次投递，串联选题、稿件、证据画面、配音字幕、成片审阅。确认前不TTS或合成。默认30–60秒、9:16、Qwen安明远；本片显式覆盖为龙安朗，不修改产品默认。版本1选题记录独立保存在Project中，Video Document仍为2.0–2.10。

全局顺序只维护在[下一步计划](docs/plans/NEXT_STEPS.md)：

1. SCIENCE-01：参考量子位，用一个对象贯穿现象、机制和条件变化，先验20–30秒关键段，再做完整科普；沿用BMW＋Codex，声音按本次明确设置，不重配无关素材。
2. RESEARCH-01：参考AK，以具体例子贯穿研究问题、机制与结果图；核对论文／仓库版本，未实际执行不能写已复现。
3. NEWS-02后续：提高合格原声选题覆盖与预检效率，补署名日期格式兼容，合并关联修订后统一导出；有约束的未变镜头审阅复用需另行设计实现，当前继续既有新导出审阅规则。

三类分别验收；新闻接受不关闭科普／学术的人工听感、理解和条件预测。已有类型工作表、来源关系、改稿影响、句目标、独立人／Agent审阅、事件／测量／分组／预合成及外部版本链均已实现，不重复开发。参考[制作方案](docs/plans/VIDEO_TYPES.md)与[模板工作表](docs/plans/VIDEO_TYPE_TEMPLATES.md)。MEDIA-01音频准入和MEDIA-02音频时钟问题继续保留自身范围，不能用帧审阅代替核听。

## 代码入口与边界

| 范围 | 入口与约束 |
|---|---|
| 官方循环与唯一browser | `apps/bmw/product.ts`、`agent-contract`及各harness；核心不导入具体provider协议、凭据或原生客户端存储 |
| 新闻选题 | `feature-video/src/news-contract.ts`、`news-service.ts`、`news-store.ts`、`renderer/studio-news.ts`；可信用户选择、版本／指纹、Project／Session归属、单次投递与取消清理 |
| 来源与真实预览 | `browser-capability/src/collect-page-source.ts`、`source-screenshot.ts`、`page-navigation.ts`及`platform/src/project-source-store.ts`；原始发布日期、页面身份、PNG／文件SHA和有界采集 |
| 草稿与局部编辑 | `feature-video/src/studio-service.ts`、`studio-store.ts`及`studio-runtime.ts`；CAS、FIFO、GUI冲突、既有影响计划，不另建时间线或执行器 |
| Qwen配置与试听 | `platform`凭据存储和受信Shell，`media-native`旁白契约与原生处理；七种Qwen音色闭合校验，密钥不回传模型或日志 |
| 媒体与审阅 | `media-native`负责解码、处理、旁白和导出；来源分析、Agent画面审阅、人工核听与最终接受分别记录 |

稳定BMW Session ID与不可变原生resume anchor分开保存；不跨Session改写草稿，不重放未知投递。退出或切Project前必须等待实际工具／worker清理，失败隔离至显式恢复；`ready`仅允许用户明确继续，`uncertain`／`failed`不自动重发。所有旧来源、音频、草稿与导出保留。

## 验证与本机交付

2026-10-22 当前合并代码的 build／check 和完整 --all 为 **196 passed／0 failed／14 opt-in not-run**，包含 191 项登记检查、四项门禁及桌面汇总。源码副本与提交04bf356文件树一致，避免清理运行中BMW的生成文件；[CURRENT](docs/verification/CURRENT.json)保存源码／输出SHA和逐项结果。首轮190通过／7失败单独保留；隔离Whisper资源补齐、桌面workspace重复登记合并并增加选择断言后，重新构建及完整重跑通过。WorkBuddy目录门禁、加密Key、事件／续聊／清理隔离保持；[既有单次真实调用](docs/research/WORKBUDDY_BROWSER_DELIVERY.json)不计入离线通过数。

覆盖unit／contract／boundary、官方DSH冷检查、desktop、Studio、media、video及narration；本轮14项显式opt-in未运行，包含指定本地素材夹具及外部服务入口。真实付费模型、在线Qwen调用与用户接受另有交付证据，不计入离线通过数。测试使用一次性Profile／Home／Workspace及mock keychain，没有生产Profile或系统凭据提示覆盖。GitHub尚无Actions，不宣称远程CI已运行；可选Codex CLI另行发现安装，本机成功不代表全新`npm ci`自带它。

后续运行时改动按AGENTS串行构建并执行check、unit／boundaries与相关原生检查；测试增删后运行`npm run docs:features`。构建清理生成输出，先退出仍使用它们的BMW进程。

历史DSH三主片见[SI新闻](docs/research/DSH_SI_DELIVERY.json)和[科普／学术](docs/research/DSH_SCIENCE_RESEARCH_DELIVERY.json)；原Qoder主片、换题短片和AK组合片见[P1／AK交付](docs/research/P1_AK_DELIVERY.json)。它们保留各自版本及人工验收范围。`.bmw-runtime`媒体、完整日志与凭据配置被Git忽略，不随文档移动或上传；可移植交付记录只保存来源、状态及指纹。

当前AI养老新闻已补入官方《知否》身份资料，草稿v53／导出v52，最终文件为`media-18ad3303-fd8c-4acf-8334-f6ff3fe18f00-converted.mp4`。官方微博经用户登录补查未定位曹翠芬本次隐私原声，不将角色资料当采访；[修订证据](docs/research/NEWS_ELDERCARE_FOOTAGE_UPDATE.json)登记原6WAV／23字幕／主画面和旁白轨道完全保留、新导出138帧逐镜与整片Agent通过、开头声音技术采样及暂停状态。高级编辑已通过GUI开启，三个独立图层仅在开头0–2.6秒显示；保持该模式和原素材，不重跑研究/TTS。人工听感与最终接受仍待用户。
