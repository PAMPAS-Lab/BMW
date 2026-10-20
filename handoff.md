# BMW current handoff

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

2026-10-20 当前整合后的完整 `--all` 为 **173 passed／0 failed／12 opt-in not-run**，报告为 `.bmw-runtime/news-daily-main-integration/full-final/result.json`，受测输入以本次提交前冻结的源码 SHA 为准。构建、check、功能／架构与边界检查通过；逐项结果和源码指纹见[CURRENT](docs/verification/CURRENT.json)。WorkBuddy 已作为第四驱动接入：固定官方 ACP 实际目录预检、系统加密 API Key、配置／实际任务验证分离、串行事件与原生回执、同一 provider 续聊及失败清理隔离。官方 CLI＋本机模型夹具完成三模型目录和两轮真实 Bridge 调用；离线基线没有真实 Key／付费服务覆盖；其后用户授权的 WorkBuddy／deepseek-v4.1-flash 单次 browser 实际调用成功，见[脱敏记录](docs/research/WORKBUDDY_BROWSER_DELIVERY.json)，不扩大其他模型或制作验收。六个冻结类型例外未增加。

覆盖unit／contract／boundary、官方DSH冷检查、desktop、Studio、media、video及narration；六个专用本地素材夹具和六个外部入口未在完整回归中启用。真实付费模型、在线Qwen调用与用户接受另有交付证据，不计入离线通过数。测试使用一次性Profile／Home／Workspace及mock keychain，没有生产Profile或系统凭据提示覆盖。GitHub尚无Actions，不宣称远程CI已运行；可选Codex CLI另行发现安装，本机成功不代表全新`npm ci`自带它。

后续运行时改动按AGENTS串行构建并执行check、unit／boundaries与相关原生检查；测试增删后运行`npm run docs:features`。构建清理生成输出，先退出仍使用它们的BMW进程。

历史DSH三主片见[SI新闻](docs/research/DSH_SI_DELIVERY.json)和[科普／学术](docs/research/DSH_SCIENCE_RESEARCH_DELIVERY.json)；原Qoder主片、换题短片和AK组合片见[P1／AK交付](docs/research/P1_AK_DELIVERY.json)。它们保留各自版本及人工验收范围。`.bmw-runtime`媒体、完整日志与凭据配置被Git忽略，不随文档移动或上传；可移植交付记录只保存来源、状态及指纹。

当前AI养老新闻已补入官方《知否》身份资料，草稿v53／导出v52，最终文件为`media-18ad3303-fd8c-4acf-8334-f6ff3fe18f00-converted.mp4`。官方微博经用户登录补查未定位曹翠芬本次隐私原声，不将角色资料当采访；[修订证据](docs/research/NEWS_ELDERCARE_FOOTAGE_UPDATE.json)登记原6WAV／23字幕／主画面和旁白轨道完全保留、新导出138帧逐镜与整片Agent通过、开头声音技术采样及暂停状态。高级编辑已通过GUI开启，三个独立图层仅在开头0–2.6秒显示；保持该模式和原素材，不重跑研究/TTS。人工听感与最终接受仍待用户。
