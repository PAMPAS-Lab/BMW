# BMW current handoff

核对日期：2026-10-17。TYPE-01、来源／改稿及AK增量已实现于2.10；当前DSH适配基线为官方候选版0.2.1-rc.2，升级后分类回归162 passed／0 failed／12 not-run。各历史报告只适用于各自源码。三类视频重制与人工验收分别登记。Qwen TTS、设置内加密保存凭据和试听已实现，新闻推荐音色为闻怀之；使用步骤见 [README](README.md#qwen-配置与试听)。
当前三类主片为新闻V4 57.792秒、科普V2 215.083秒、学术V2 229.483秒，均由BMW＋Qoder CN／DeepSeek-Flash制作。新闻按用户提供的“牧语手记”技能重写，以“只换一个字母，预期大了一截”为观察，保留半屏原帖、大书封与问答，六段旁白换成真实Qwen安明远男声（口播合计51.52秒、0%语速）；字幕拆短，书名统一。科普加入杯子／夹爪／条件变化，学术加入计算器／KV对象和原生对照图；科普只重配一段，其余七段声音保留。当前指纹的审阅范围见交付清单，主观听感、观众复述和最新版本的用户接受仍待确认；旧版与原始材料保留。

## 接手入口

用户指定的DSH版SI新闻另见[交付记录](docs/research/DSH_SI_DELIVERY.json)：官方deepseek-flash、同一可编辑草稿revision34、57.664秒、720×1280／24fps；复用六段真实Qwen安明远WAV，未重复TTS。当前144帧及六场／全片Agent记录已齐，结尾红条间距已复核。用户对该版表示基本满意，认为优于此前Qoder CN版；此对话反馈不代替专项核听、复述或Studio人工验收。原Qoder主片、旧MP4与素材均保留。

先读 [AGENTS.md](AGENTS.md)、[文档导航](docs/README.md)、[当前状态](docs/PROJECT_STATUS.md)和[功能规格](docs/FUNCTIONAL_SPEC.md)。当前工作树支持 Video Document 2.0–2.10、正式全片分析、720秒／96分镜、有界混音、文字包装与有限科学图解。已完成阶段见 [历史索引](docs/history/README.md)，不要按旧设计的“待实现”重复开发。

本轮P1功能及P2的AK功能已接入；新闻V4、科普／学术V2完整主片、三条换题短片和27秒AK组合片的可编辑工程、MP4、SHA与范围见[交付清单](docs/research/P1_AK_DELIVERY.json)。文案结构与模板见[工作表](docs/plans/VIDEO_TYPE_TEMPLATES.md)，剩余事项统一见[下一步](docs/plans/NEXT_STEPS.md)。TYPE-01、来源关系、改稿影响、句目标、独立人／Agent审阅、事件／测量／分组／预合成／外部版本链均已实现。四条较早的技术／换题导出仍是renderer9历史证据，不冒充renderer10缓存复用。小字／停读、来源采集缺口和人工内容验收继续单列；既有素材导入不等于外部生成服务实测。不增加模型工具或Host模型循环。

## 代码与证据

| 范围 | 入口与约束 |
|---|---|
| 官方循环／唯一 browser | apps/bmw/agent-assembly.ts、agent-contract、各 harness；有效目录准入不能由提示词替代 |
| 文档／类型命令 | feature-video 的 video-document.ts、video-edit-contract.ts、studio-discovery.ts；owner、CAS、可信高级权限和有界模型读取 |
| 全片分析 | source-analysis-contract/service/store；独立任务 revision、SHA、8图分页，提取与作者审阅分开 |
| 长篇／包装／图解 | media-native 的 composition-limits.ts、media/composition-audio.ts、layer-text-treatment.ts、layer-packaging.ts、science-spec.ts |
| 采集／音频 | capture-timeline.ts、capture-source-index.ts、media-preservation.ts、audio-evidence-contract.ts；源时间、文件 PTS、呈现时钟与核听状态分开 |
| 改稿与复用 | studio-service.ts、studio-store.ts、studio-timing-diagnostics.ts、studio-card-speech.ts；不要另建时间线或执行器 |
| Qwen 配置与试听 | platform 的 qwen-credentials-store.ts、main.ts、Shell/preload；media-native 的 qwen-narration.ts、narration-processor.ts、media-controller.ts。凭据只经受信 Shell 保存及原生回调读取，不回传 Key，不使用凭据环境变量 |

当前DSH升级相关分类报告为162 passed、0 failed、12 not-run，覆盖2.10、Qwen夹具和相关原生入口；[验证说明](docs/VERIFICATION.md#dsh-021-rc2-与-si-新闻)记录当前源码、独立真实DSH制作与覆盖边界。P1冻结、旧154／142项基线及失败修复过程保留各自版本，不叠加通过计数。真实 Qwen 三份女声样本、六段许言初与六段安明远男声旁白已在隔离 BMW 中成功合成；本次DSH复用六段安明远文件，未新请求TTS。男声音色的历史76项相关回归仍单列；主观音质与模型直接核听未完成，Veo根因未最终归属，样片播放、PCM与ASR均不能替代听感验收。

本地 .bmw-runtime 证据被 Git 忽略；原研究、V1／V2、量子位原版与修订版均保留。媒体与证据文件没有随文档移动。仓库保存可移植的验证摘要，原始媒体和完整日志不随提交上传。

## 后续验证

Qwen 的自动回归使用隔离 HTTP 夹具和 mock keychain，不证明真实 Key、额度、地域权限或人工听感。另行执行的真实制作中，用户在一次性 BMW 的原生表单填写凭据，加密保存及固定试听成功；BMW＋Qoder CN／DeepSeek-Flash又生成三份女声同文样本、六段许言初和六段安明远男声旁白，原生媒体检查均可解码。真实制作不计入162项自动回归，也不构成听感通过或生产 Profile 覆盖。专用本地素材夹具及其他外部生成服务继续按未运行范围保留。下一次运行时改动按 AGENTS 完成相关 DSH、desktop、Studio、media、video、narration 检查；建立当前完整基线时冻结源码并运行 verify:stability。所有构建命令串行，测试使用一次性 Profile／Home／Workspace，不操作系统凭据提示。
