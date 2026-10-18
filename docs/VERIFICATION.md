# BMW 验证说明

核对日期：2026-10-18。当前功能以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准，分类与运行配置见 [ARCHITECTURE.md](ARCHITECTURE.md)。通过结果须绑定当时源码，不能按文档日期推断完整覆盖。

## 当前源码完整离线基线

2026-10-18对NEWS-01及Qwen新增男声音色工作树重新清洁构建，执行`npm run check`及完整`node scripts/test-runner.js --all`，全部通过：**166 passed／0 failed／12 not-run**。161个分类项与5个门禁／桌面汇总合计，不将汇总当作额外独立保障，也不叠加历史轮次。[本机原始结果](../.bmw-runtime/classified-tests/2026-10-18-codex-qwen-men/result.json)与[可移植逐项摘要和源码SHA](verification/CURRENT.json)绑定本次实现；逐文件SHA绑定本次提交的受测实现，sourceBaseRevision只记录变更前基底。

覆盖unit／contract／boundary／type、官方DSH冷控制、Assistant与计划任务、desktop四组及Project重启、Studio全部非opt-in分支、媒体采集／处理、视频／语音、本地Matcha与Qwen HTTP旁白夹具。NEWS-01的video.news、studio.news和browser.sources进入同一完整范围：广泛个人／组织／地区、72小时边界与日精度、原始引用与真实预览、重复／不足／缺失／过期、可信选择、防伪造、重复点击、独立记录恢复、冲突与取消，以及确认前旧改稿入口／TTS／合成门禁。GUI实际检查任务结束恢复按钮、真实PNG、单次投递、脚本局部保存／独立字幕保留及配音面板跳转。

运行期间469个受测文件SHA保持一致；构建收据含463个输入、433个生成输出，说明文档回填后再逐项核对。6个历史测试替身类型例外未扩大。Video Document未升级；没有新增模型工具或Host模型循环。

十二个未运行项为六个专用本地素材夹具（source-analysis、frame-sampling、long-composition与三项量子位样片）和六个外部入口（Qoder制作、三驱动付费Assistant、vision、Edge），逐项ID见摘要。runner统一写“External opt-in required”，不表示本地夹具都是外部服务。本轮完整回归使用一次性Profile／Home／Workspace及模拟钥匙串，不访问生产Profile或系统凭据提示，不证明真实API额度、音质、GitHub CI或人工接受。`npm ls --depth=0`退出0；可选Codex CLI仍由本机另装，未声称全新`npm ci`覆盖。之前162项基线及164项中间轮次各保留自身源码范围。

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
