# BMW 当前实现

社媒视频取材已补 Host 目标身份绑定及同目标完整直链的原生分离音视频合并；当前公开样本 X、微博各2/2完成获取、双轨完整解码与画面核对，X实际回复资源被拒绝。YouTube当前SABR/UMP分发0/2通过，用户要求将真实获取改进记为[YOUTUBE-01待办](plans/YOUTUBE_NATIVE_ACQUISITION.md)，本期暂缓。保留HTTP/HLS，不引入yt-dlp和TikTok专用适配；[实测范围](research/SOCIAL_DOWNLOAD_VALIDATION.md)不扩大为全站或人工听感验收。

BMW 当前提供浏览器、素材库、Video Studio 三个并列工作区。素材库自动聚合各 Project 的已保存来源和媒体，支持全库检索、日期/状态筛选、收藏、标签、批量整理、历史新闻批次和跨 Project 完整证据复制；素材仍归各自 Project，目标副本及其说明独立保存。新闻收集与选题位于素材库，可信选择后进入原生 Studio；旧草稿、会话、来源和投递记录保留，唯一模型工具仍为 browser。

素材库组织、作品溯源与来源/事件容量六阶段已实现：Project 专题、全局方向、独立用途及参考/计划关系；Studio与直接合成自动记录独立导出版本、实际采用材料SHA、角色、文件/输出区间及复制来源身份。成品按作品分组，支持版本→材料及材料/来源→成品双向查询；缓存复用不新增，旧成品采用未知，原资料、新闻批次和草稿保留。来源/事件采用不可变分片、可重建SQLite增量索引和固定快照分页，来源流/事件记录提供完整检索与可信维护；旧来源目录只读兼容。来源订阅已支持有界手动巡检、线索与事件修订、可追溯归并/拆分、采集游标及X/YouTube可见指标观察；严格十题事件推荐快照、方向策略、专题筛选和旧news交接也已接通；已接通明确Project/Session/driver绑定的周期采集、用户任务优先、重启回执核对、失败退避及健康通知；资源空闲时可在独立隐藏页采集未激活绑定，不切换前台工作区；用户任务先等实际清理，未知输入不自动重投，见[设计](plans/LIBRARY_STREAMS.md)。验证范围与报告见[验证说明](VERIFICATION.md)。

增量批量采集提供可信素材库勾选至多九源的一次官方输入，2–3路隐藏页面读取、串行来源CAS、保留pending的URL检查点和一次批量线索提交；X趋势可保存带明确缺口的观察，完成游标始终不推进。原单源采集、事件整理、十题推荐及制作入口保留，周期计划不自动启用。不确定输入不重投，取消等待实际页面／驱动清理。设计与分层实测见[批量采集方案](plans/COLLECTION_BATCH_OPTIMIZATION.md)和[验证说明](research/COLLECTION_BATCH_VALIDATION.md)；已登录主Profile官方驱动的九源验收与隔离实测分别记录。

AI新闻固定来源目录提供24项可选订阅，默认暂停、稳定预设ID重复保全；新增社媒观察类型并拦截登录/挑战页推进游标。真实公开网页的72小时采集、原文、线索/事件及推荐验证使用隔离Project，X/YouTube访问限制独立记录，见[真实来源验证](research/AI_NEWS_REAL_SOURCES.md)。

主Profile实际续验保留九项订阅及初始72小时九题不足快照，已完成约41秒DSX POD首片、原生SRT、完整稿件、111帧／五镜／整片Agent意见、独立画面检查及实际采用双向查询；旧数据SHA保全。后续第一轮更新六个入口并整理为23条线索、17个事件，新72小时快照核验合格严格十题，沿原入口完成31.5秒开放模型新片、六镜／68帧与独立整片画面检查、原生SRT及12项采用双向查询，PHP修复第二条亦完成40.04秒、五镜／59帧与独立整片画面检查、原生七条SRT和11项采用双向查询；合计后续2／4条、完成1／2轮，第二轮已恢复有界采集。流程有GUI辅助，人工听感／用户接受待验，见[实际验证](research/AI_NEWS_MAIN_PROFILE.md)与[首片证据](research/NEWS_DSX_POD_DELIVERY.json)。

NEWS-DAILY已修复Studio预览／新闻核验争用共享解码worker，以及映射采集终帧被WebM默认时长压短的问题；末个Opus包未知时长保持原值。来源夹具改为显式绘制／请求首帧并独立核对真实编码轨道，保留加载诊断。这批改动在旧分支的完整离线回归为**167 passed／0 failed／12 opt-in not-run**，466项非Markdown受测输入与437个生成输出另核对；两次先前失败完整报告保留，不合并计数。见[修复证据](research/NEWS_DAILY_FIXES.json)与[当前验证](verification/CURRENT.json)。

日常系列优先BMW＋官方Qoder CN／DeepSeek-Flash（dfmodel）、Qwen龙安朗及AIpardonSI News；[日常操作手册](NEWS_DAILY.md)说明选题、取材、审片与收工恢复。10月19日有人指导的制作中，用户选定AI养老沙龙，可信Studio入口后完成约49秒图文新闻及逐镜／整片Agent审阅，见[交付证据](research/NEWS_ELDERCARE_DELIVERY.json)。人工听感与最终接受待确认；原始采访未取得，十个研究线索未全部进入候选卡，不表示无人值守或研究覆盖已经验收。

IMF Jack Clark两版继续保留：DSH47.744秒、Qoder53.867秒；用户认为Qoder CN版更清楚。比较清晰度不等于声音、画面或整片最终接受，见[交付与反馈](research/NEWS_IMF_CLARK_DUAL_DELIVERY.json)。Replit原声修复、八条旧龙安朗WAV和已接受Chuck Lorre作品保持原记录，见[保留证据](research/NEWS_REPLIT_DUAL_DELIVERY.json)。

NEWS-01已完成技术实现、真实制作与用户验收。当前接受基准为BMW＋官方Codex 0.160.1／gpt-6-astra制作的54.61秒竖屏新闻，Qwen龙安朗男声；结尾以作者本次DeepSeek $1.25／Opus 5.5 $16.36的作品花费对照，回扣低花费也能完成精细动画。仅重配末镜12.4秒，前五镜全部数据及声音SHA不变，793个历史文件保留；136个当前成片关键帧、逐镜／全片Agent意见与用户“这个版本可以了”分别登记。旧公告片与DSH对比片的未接受状态保留，见[验收证据](research/CODEX_NEWS_REWORK.json)。用户接受不补造逐字声学对齐或专项发音评分。

NEWS-02本轮功能与真实样片已交付，当前43.03秒Chuck Lorre新闻已获用户“这个版本可以了”的接受。候选上限扩至十项，优先采访／演讲原声；素材库支持本次Qwen音色覆盖与真实预览按需加载，Studio保留制作进度。本轮研究只取得IMF总裁与Reuters采访两张合格卡，不以旧闻凑数；用户选择Chuck Lorre后，BMW＋官方Codex／Qwen龙安朗完成9:16可编辑新闻，以两段原声解释其对强于人类的智能及捕食者／昆虫类比的担忧。字幕修改为大号可编辑双语，音频和区间保持不变；73张当前关键帧、逐镜／全片Agent意见、60个研究文件及72个初期制作文件的SHA保留检查见[成片与接受证据](research/NEWS_02_LORRE_DELIVERY.json)，[选题与未入选原因](research/NEWS_02_TOPICS.json)单列。用户接受不补造专项发音、声学对齐或复述分数。研究覆盖、署名日期格式兼容与有约束的未变镜头审阅复用仍待后续，现行审阅规则保持；下一主线为SCIENCE-01，再到RESEARCH-01。

核对日期：2026-10-21。当前行为与 Schema 见 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md)，模块／接口／测试分支见 [ARCHITECTURE.md](ARCHITECTURE.md)，报告见 [VERIFICATION.md](VERIFICATION.md)。
此前三类基准主片均已由 BMW＋DSH 0.2.1-rc.2／官方 deepseek-flash 制作：SI新闻57.664秒、机器人科普210.859秒、HybridAgent学术229.248秒。新闻的基本满意反馈已单独保存；科普与学术按量子位、AK参考重做画面，保留各八段原Matcha旁白，增加大幅厨房实拍、杯／夹爪条件变化、计算器／大h状态包／连续KV动画及论文对照。新片的实际MP4、来源、SHA与当前审阅范围见交付记录，人工听感、观众理解和接受仍待反馈。原Qoder版本和所有素材保留。

| 范围 | 当前实现与边界 |
|---|---|
| 桌面与 Agent | 一个 BMW，浏览器／素材库／Video Studio及共享 Assistant；DSH、Codex、Qoder CN、WorkBuddy 各拥有官方循环，唯一 browser 模型工具 |
| Project 与 Session | Project 共享页面和媒体；稳定 Session 固定 Project／driver，Studio 草稿固定唯一 owner；CAS、FIFO、取消清理和 unknown 不重发 |
| 浏览器与媒体 | 页面交互、后台取材、截图、录屏、有限下载、HTTP／明文有限 HLS VOD 分发资源保全、图像检查／标注／绘图、抽帧、裁剪缩放与转换 |
| 视频采集与源时间 | 修正有限视频结束时范围校验；逐帧保存源时间→录制文件 PTS 映射并核对成品；支持按源时间取中段／尾段帧，尺寸切换按初始画布等比适配留边，保留实际源尺寸 |
| 模型动作发现 | 认证 browser 目录、闭合 Action Schema、Studio 操作／source 子操作帮助和执行前参数错误恢复；Codex 根据实际目录发现与纠错 |
| 音频证据 | 按文件 PTS 提取至多 10 秒原采样率／声道 PCM16 WAV，核对输入输出 SHA、样本数、RMS／峰值／越界／缺失和窗口指标；可打开不自动播放的试听控件，指标不等于核听 |
| Qwen 旁白与设置 | 北京地域固定 `qwen-audio-3.1-tts-flash`，七种闭合音色；设置内加密保存凭据、试听、默认／模板及Studio参数可选。当前接受新闻显式采用龙安朗，三份其他男声试听真实生成；没有自动改写全局默认。离线HTTP夹具与真实配音、用户自然度反馈分别登记 |
| NEWS-01 新闻流程 | 广泛主体、严格近72小时、原三题在NEWS-02扩至十题、真实来源预览、可信用户选题后唯一草稿与单次投递、五阶段制作引导；技术／真实制作／当前54.61秒Codex样片已获用户接受；默认仍30–60秒9:16／Qwen安明远，可显式覆盖 |
| 视频数据约定 | 单份 Video Document 2.0–2.10；可逆简洁子集；类型 CAS 命令／试算、owner 保护、v1 原字节备份；未知/未实现结构拒绝 |
| Video Studio 默认视图 | 卡片内脚本、画面、预览；目标／素材与细节按需展开，统一交付入口 |
| Video Studio 高级视图 | 全窗口资源／画布／属性／多轨、同一 Assistant 浮框／停靠；主轨、独立对象、有限关键帧、整镜头分割、基础颜色／模糊与静音 |
| 全片分析与长篇 | 正式2fps分页任务、选定区间8fps加密、亮度候选及独立覆盖/审阅账本；单源30分钟/512 MiB；成片720秒/96分镜、有界音频窗口，提取完成与语义审阅分开 |
| 原生包装与科学图解 | 逐字素/多行时序、描边、六对象错时卡片、有限翻牌/方向及放射模糊/RGB glitch、源裁切；数据驱动曲线、条/饼/环、钻井/流向与至多64对象分组，文档能力分别2.7/2.8/2.9；不含通用3D或科学仿真 |
| 语音与字幕 | 真实旁白、原音频播放区间、句级校正／聚焦／板书、原声 ASR 与人工双语字幕；完整字幕底框与共享安全布局；2.5 时间方法记录及只读句级节奏诊断；完整音轨 ASR 最多 180 秒；30 分钟源文件可按区间索引，自动词／字精度未批准 |
| 参考与审阅 | SHA 绑定的实际抽样参考 PNG、分析记录与背景采用；可选逐项文本／字幕样式审阅为测试功能，需人工判断 |
| 交付与恢复 | 实际 MP4 手机审阅、指纹绑定的覆盖记录与独立技术／版式／Agent／用户意见、关键状态文本检查、原声转解说、单镜头本地恢复、选择性更新失效旁白、实际 MP4 与内容指纹复用、封面 PNG、SRT/VTT／来源清单、取消后明确续做与签名撤销 |
| 计划任务 | 固定 Project／Session／driver；失效绑定报错，排队／运行时禁止重绑 |
| 研究与内容创作 | 已完成 Simon 鹈鹕记录整理、两册报告及两版真实素材短片；[AK 十条视频](research/AK_X_VIDEOS.md)完成开发侧抽样研究，未核听／逐条复刻；写稿与叙事质量仍需增强，已有三类版本化原生制作指导／工作表；通用外部 skill 与原生图文长篇制作／导出未开放 |
| 类型／来源／改稿增量 | 2.10 可选类型工作表，三类内置指导和有限配方预览／采用；明确作品／版本／主张关系、句目标身份与只读SHA绑定影响计划；UI编辑保留；实际内容／MP4绑定的独立类型审阅账本与人工试听／复述声明，Agent不能代填人工通过 |
| AK 原生增量 | 事件联动、节点／记忆／代码／聊天及有限父容器；独立测量分组柱图／线性对数散点；1/2/4方阵的四解码器分块预合成与SHA配方；外部素材版本链，实际服务调用另验 |
| 当前未实现 | 专用 AI 图片／视频生成暂缓；没有通用 NLE、任意 HTML、远控客户端、签名安装器与自动更新 |

Project 素材索引支持来源/说明/原始语音检索；录屏支持事件绑定的操作/等待/结果候选、显式两倍速压缩与保留全画面的放大镜；卡片表现可绑定已编辑句锚点；时间方法和作者分别记录，不认证声学精度。模型结果使用有界摘要和分页，局部命令保留无关内容与 Host 证据；恢复区显示实际事件与保存事实，明确准备续做输入，不自动重发。

Studio 详细映射见 [VIDEO_STUDIO_SCOPE.md](VIDEO_STUDIO_SCOPE.md)。实现与自动测试通过不等于付费模型、生产钥匙串、完整视频语义或用户体验验收。

DSH三条主片独立保存：[SI新闻](research/DSH_SI_DELIVERY.json)、[科普／学术](research/DSH_SCIENCE_RESEARCH_DELIVERY.json)。新闻获用户基本满意反馈；新两条的八场及全片Agent审阅与人工验收分开记录。DSH官方Agent拥有上下文压缩，宿主只规范化工具回执及历史投影。



## 当前代码与验收

2026-10-20 当前整合后的完整 `--all` 为 **173 passed／0 failed／12 opt-in not-run**，报告为 `.bmw-runtime/news-daily-main-integration/full-final/result.json`，受测输入以本次提交前冻结的源码 SHA 为准。构建、check、功能／架构及边界检查通过，覆盖四驱动装配、官方 WorkBuddy／本机模型夹具、新闻 FIFO、DSH、desktop、Studio、media、video 和 narration。当前源码与逐项结果见[CURRENT](verification/CURRENT.json)。WorkBuddy 已接入输入前有效目录门禁、系统加密 Key、实际任务鉴权状态、事件串行化、原生续聊及清理隔离；另有用户授权的 WorkBuddy／deepseek-v4.1-flash 单次 browser 实际调用通过，见[脱敏记录](research/WORKBUDDY_BROWSER_DELIVERY.json)，不计入离线通过数；其他模型、额度、完整生产 Profile 和 Windows 进程树未验收，Windows 保持不可用。六个冻结类型例外未增加。

量子位四阶段已完成全片分析、长篇、文字包装及有限科学图解的实现和对应技术验收，记录已[归档](history/qbit/IMPLEMENTATION.md)。10 月 17 日样片副本修订后：新闻时间线 40 秒、PIP 34.666667 秒并改为 1280×720，S10／S09 为 32／24 秒；实际文件时长另有编码尾部。原版、工程和审阅证据保留。S04 未下载／全片分析；长篇只验证了 640×360／12fps，不推断 1080p／30fps 性能。新闻叙事、细字阅读与音频核听仍有缺口。

Simon 两册研究、98 个记录组与 V1／V2 已交付对应范围；98 不是去重作品数。V2 实测 152.064 秒、14 场景、275 张当前关键帧，并不代表用户已认可叙事或完成核听。实际模型与成片记录见 [历史验证](history/2026-10-17-documentation/VERIFICATION.md#simon-研究与叙事重剪)，内容不足转入下一步计划。

NEWS-01早期[公告片](research/NEWS_01_DELIVERY.json)及[36.16秒DSH动态片](research/NEWS_01_VIDEO_TOPICS.json)均保留技术证据和用户未接受的原因；最终[Codex新闻](research/CODEX_NEWS_REWORK.json)另有用户接受记录，不反向改写历史片的结果。来源预览、高清平台分发文件及所有旧音频／导出保留。

## 后续改进与验收目标

[下一步](plans/NEXT_STEPS.md)中此前类型／来源／改稿P1功能及P2的AK功能均已实现；NEWS-01已获用户接受；NEWS-02当前样片也已接受；后续先做SCIENCE-01科普、再做RESEARCH-01学术，NEWS-02研究与效率余项继续单列，验收仍按三类分别记录。已有功能包括：类型指导／工作表／配方、来源关系、改稿影响、句目标、独立人／Agent审阅、事件／测量／分组／预合成／外部版本链。原Qoder三类主片、换题短片和AK组合技术片见[阶段交付](research/P1_AK_DELIVERY.json)；当前DSH三主片见上方独立记录。新闻获基本满意反馈；新科普／学术的人工听感、复述与条件预测待反馈。小字号、少量引用裁切与停读段继续记录；图文长篇、更大范围UI与外部素材生成暂缓。

不重复安排已实现的 2fps 分页分析、720 秒／96 分镜、文字包装和 scienceState；不把样片技术完成或旧 P1 通过解释为内容与音频问题全部关闭。

## 运行与认证

固定版本为 Node.js 24+、Electron `44.5.1`、Mediabunny `1.61.0`、DSH `0.2.1-rc.2`、Codex App Server `0.160.0` / `0.160.1`、Qoder CN SDK `1.0.50` / Worker `1.1.64`。依赖安装版由 lockfile 固定，外部 CLI 还需通过运行时版本准入。

默认入口由 `scripts/product-entry.ts` 调用 `apps/bmw/agent-assembly.ts`。新 Profile 默认 DSH，之后按 Project 保存 driver 选择。启动沿用已有选择，不自动发起登录；GUI 切换时检查认证。

Profile 为 `BMW`，浏览器分区为 `persist:bmw`。三个引擎分别使用 `dsh-home`、`agent-drivers/codex`、`agent-drivers/qoder-cn`；BMW 保存会话索引、显示历史、回执与模型偏好。DSH 初次初始化可复制普通 CLI 凭据，后续凭据写入只落在 BMW 的独立文件；Codex/Qoder 不读取原生桌面的私有凭据。

DSH 提供 DeepSeek API Key，Codex 提供 ChatGPT 浏览器登录，Qoder CN 调用官方 CLI 登录。Codex 可识别独立 CLI 中的既有 API Key，BMW 当前没有 API Key 输入表单。Qoder 没有已验证的非交互退出控制，退出按钮禁用。DSH 检查的是 Key 是否配置，不验证 Key 有效性或余额。

支持名单与官方目录匹配后才可选择：Codex 为四个已封装 GPT-6 型号与 GPT-5.5；DSH 为两个官方 DeepSeek 路由；Qoder CN 为维护的 14 个启用型号，完整 ID 见功能规格。支持名单不等于账号推理额度，也不代表全部型号逐一完成付费验收。设置不发送模型输入；Qoder 冷控制会话仍内部核对 SDK 初始化目录，实际输入前所有引擎均要求有效工具目录恰好一个 browser。

## 数据与运行限制

正常启动只接受 v2 Agent 数据，历史转换通过 [显式迁移命令](AGENT_DATA_MIGRATION.md)，不自动导入或认领。已授权的本机迁移记录属于历史证据；历史迁移核查保持只读；用户授权的新闻实际作业仅新增本次材料和制作记录，旧资料保全另见主Profile验证记录。

原生桌面列表同步、fork、steer、Agent 原生审批与 nativeOpen 未启用。损坏状态保留原文件并提供重试／退出，清理失败隔离资源。设备编码能力、Edge 服务及 Qwen 账号权限／额度／网络影响成功率；实际 alpha 视频抽帧／转换拒绝。ASR macOS 分支有实测，Linux 分支未实测。

## 文档入口

[文档导航](README.md)区分当前规范、研究、规划、附件和历史。功能总契约仍是 FUNCTIONAL_SPEC，架构／测试映射仍由源码生成。迁移归档 ../Agent in Browser 与独立 BMWDev 不属于当前 BMW 的权威来源。

## 本机调研与交付记录

[补收审计](research/LOCAL_RECORDS_AUDIT.md)已补齐量子位、下载实验、Musk／博客／多驱动迭代及早期实验的入口。DELIVERY-01 可编辑交付包与 MEDIA-04 有界获取恢复继续保留，当前优先级由三类视频考核统筹，见[下一步](plans/NEXT_STEPS.md)；历史交付不等于当前功能或内容验收通过。
