# BMW current handoff

核对日期：2026-10-17。TYPE-01、来源／改稿及AK增量已实现于2.10；DSH适配基线为官方候选版0.2.1-rc.2。当前源码清洁构建、check及完整离线回归通过：162 passed／0 failed／12 not-run，包含最后append格式修正；[逐项摘要与源码SHA](docs/verification/CURRENT.json)可随仓库核对。各历史报告只适用于各自源码。三类视频重制与人工验收分别登记。Qwen TTS、设置内加密保存凭据和试听已实现，默认音色为闻怀之，当前新闻使用安明远；使用步骤见 [README](README.md#qwen-配置与试听)。
当前三条主片均已由 BMW＋DSH 0.2.1-rc.2／官方 deepseek-flash 制作：SI新闻57.664秒、机器人科普210.859秒、HybridAgent学术229.248秒。新闻的基本满意反馈已单独保存；科普与学术按量子位、AK参考重做画面，保留各八段原Matcha旁白，增加大幅厨房实拍、杯／夹爪条件变化、计算器／大h状态包／连续KV动画及论文对照。新片的实际MP4、来源、SHA与当前审阅范围见交付记录，人工听感、观众理解和接受仍待反馈。原Qoder版本和所有素材保留。

科普／学术最终文件及可编辑工程见[交付记录](docs/research/DSH_SCIENCE_RESEARCH_DELIVERY.json)。DSH预设现含官方自动压缩及工具结果裁减；历史替换不作为新工具完成回执，普通append保留调用配对。恢复保持原Project、BMW Session和原生resume anchor，不重放未知投递。

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

当前完整报告为`.bmw-runtime/classified-tests/2026-10-17-current-state/result.json`，162 passed／0 failed／12 not-run；459个运行时受测文件SHA一致，文档回填后再核对453个构建输入及423个输出。[验证说明](docs/VERIFICATION.md#当前源码完整离线基线)列出全部范围和未运行项，替代此前仅以两文件增量补证的当前状态描述。P1冻结、旧154／142项及失败过程保留各自版本，不叠加计数。真实Qwen女声样本及安明远旁白仍引用原交付；DSH新闻复用六段安明远，两条新主片各复用八段Matcha，均未重复TTS。主观音质与模型直接核听未完成，Veo根因未最终归属，播放、PCM与ASR不能替代听感验收。

本地 .bmw-runtime 证据被 Git 忽略；原研究、V1／V2、量子位原版与修订版均保留。媒体与证据文件没有随文档移动。仓库保存可移植的验证摘要，原始媒体和完整日志不随提交上传。

## 后续验证

Qwen自动回归使用隔离HTTP夹具和mock keychain，不证明真实Key、额度、地域权限或人工听感。历史真实调用另有交付证据；本轮只运行离线检查，六个本地素材夹具与六个外部入口未启用，不构成生产Profile覆盖。当前完整基线已更新，后续运行时改动按AGENTS完成相关DSH、desktop、Studio、media、video、narration检查，构建串行，测试使用一次性Profile／Home／Workspace。独立Codex CLI需另发现安装；本机0.160.1未列入lockfile，不能按本机成功推定全新安装具备它。GitHub没有配置Actions，本地报告不冒充远程CI。
