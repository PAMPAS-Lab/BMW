# BMW current handoff

核对日期：2026-10-18。**NEWS-01已完成技术实现、真实制作及用户验收。** 最新接受版本为BMW＋官方Codex 0.160.1／gpt-6-astra制作的54.61秒竖屏新闻，使用Qwen龙安朗男声。用户先认可旁白自然，再要求结尾回到DeepSeek新版低花费也能完成精细制作，最后明确回复“这个版本可以了”，并要求更新文档、提交和推送。接受记录、草稿／导出身份及SHA见[Codex新闻证据](docs/research/CODEX_NEWS_REWORK.json)。

结尾使用原作者本次DeepSeek $1.25／Opus 5.5 $16.36的作品花费对照，不作为官方单价或总体模型排名。局部改稿仅重配末镜12.4秒；前五镜全部数据、音频身份与SHA不变，793个历史文件保留。当前实际MP4的136个关键帧、六场及全片Agent意见与用户反馈分别登记；用户接受不补造专项发音、复述或声学对齐分数。早期[公告片](docs/research/NEWS_01_DELIVERY.json)和[36.16秒DSH动态片](docs/research/NEWS_01_VIDEO_TOPICS.json)保留未接受结果与改进原因。

## 当前产品与下一步

先读[仓库约束](AGENTS.md)、[文档导航](docs/README.md)、[当前状态](docs/PROJECT_STATUS.md)和权威[功能规格](docs/FUNCTIONAL_SPEC.md)。BMW是唯一应用，DSH、Codex和Qoder CN各自拥有官方Agent循环；有效目录验证通过后才释放输入，模型工具恰好一个`browser`。Host不实现模型循环，不以提示词替代工具边界。

NEWS-01提供严格近72小时、广泛个人／组织主体、最多三个不同事件的真实素材选题卡，用户可信选择后建立所属Session的唯一草稿并单次投递，串联选题、稿件、证据画面、配音字幕、成片审阅。确认前不TTS或合成。默认30–60秒、9:16、Qwen安明远；本片显式覆盖为龙安朗，不修改产品默认。版本1选题记录独立保存在Project中，Video Document仍为2.0–2.10。

全局顺序只维护在[下一步计划](docs/plans/NEXT_STEPS.md)：

1. NEWS-02：固化适合视频的选材、明确新闻主张和回扣本次变化的结尾，优化局部修订效率；用另一类近72小时事件验证，优先具备采访／演讲原声的材料。有约束的未变镜头审阅复用仍待设计实现，当前继续按既有规则审阅新导出。
2. SCIENCE-01：参考量子位，用一个对象贯穿现象、机制和条件变化，先验20–30秒关键段，再做完整科普。
3. RESEARCH-01：参考AK，以具体例子贯穿研究问题、机制与结果图；核对论文／仓库版本，未实际执行不能写已复现。

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

完整离线报告为`.bmw-runtime/classified-tests/2026-10-18-codex-qwen-men/result.json`：**166 passed／0 failed／12 not-run**。469个受测文件在运行期间SHA一致；文档回填后再次核对463个构建输入、433个输出。仓库保存[逐项源码摘要](docs/verification/CURRENT.json)及[验证范围](docs/VERIFICATION.md#当前源码完整离线基线)，逐文件SHA绑定受测实现，`sourceBaseRevision`只记录变更前基底。六个冻结类型例外未扩大。

覆盖unit／contract／boundary、官方DSH冷检查、desktop、Studio、media、video及narration；六个专用本地素材夹具和六个外部入口未在完整回归中启用。真实付费模型、在线Qwen调用与用户接受另有交付证据，不计入离线通过数。测试使用一次性Profile／Home／Workspace及mock keychain，没有生产Profile或系统凭据提示覆盖。GitHub尚无Actions，不宣称远程CI已运行；可选Codex CLI另行发现安装，本机成功不代表全新`npm ci`自带它。

后续运行时改动按AGENTS串行构建并执行check、unit／boundaries与相关原生检查；测试增删后运行`npm run docs:features`。构建清理生成输出，先退出仍使用它们的BMW进程。

历史DSH三主片见[SI新闻](docs/research/DSH_SI_DELIVERY.json)和[科普／学术](docs/research/DSH_SCIENCE_RESEARCH_DELIVERY.json)；原Qoder主片、换题短片和AK组合片见[P1／AK交付](docs/research/P1_AK_DELIVERY.json)。它们保留各自版本及人工验收范围。`.bmw-runtime`媒体、完整日志与凭据配置被Git忽略，不随文档移动或上传；可移植交付记录只保存来源、状态及指纹。
