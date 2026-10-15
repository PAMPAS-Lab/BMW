# BMW 验证说明

当前契约以 [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md) 为准；所有自动测试及其运行配置从 scripts/test-catalog.ts 生成在 [ARCHITECTURE.md](ARCHITECTURE.md)。报告中的源码哈希决定结论适用版本，历史通过记录不能替代当前源码回归。

## 当前生产可靠性验收状态

局部编辑、有界模型读取、完整字幕底框、指纹绑定审片记录、实际进度与显式恢复、2.5 时间方法及句级节奏诊断已实现。相关 video.schema/video.studio 单元测试 155 项通过；原生手机阅读与图解、实际 WAV 节奏只读检查和恢复专项有对应证据。Codex/GPT-6.1 Sol 与 Qoder CN/Qwen3.8-Max 已分别完成独立制作、最终指纹的完整关键帧分页及单独整片 Agent 意见，并在实际 BMW 中连续播放到片尾。独立审帧、实际音轨解码／本地转写和产品播放按下述范围通过；用户已看／已听声明仍为 pending，未声称人工核听或逐词声学精度。

实际 BMW Codex 运行 `1ce36346-7815-4c0f-b680-a62b26b3b53b` 正常结束。新稿 `f06c507f-97f4-4ca0-961b-de4607b000ee` v23 为 720×1280@24fps、七场、实测 102.315 秒，全部旁白独立本地生成；访问长句经诊断后局部修改、重新配音并重绑。当前指纹 `d49cca9b2f6b26b62f24a31e61ed5e9232c0e39b5cb1d05319dcf6e408392ab4` 的 21 页、168 张手机帧完整，七场意见及其后的独立整片 Agent 意见已保存，用户意见仍为 pending。运行中三次参数错误均自行纠正，不计为零失败制作。旧草稿和素材指纹未变。

另在一次性解码环境只读复核实际最终 MP4（SHA-256 `e615eb8b4c7205730fa6a8f3cfdd4e2928b193e4ee22d65e67be8f4b21c1a541`）：看完包含全部原生关键样本、独立字幕中点／阅读阶段／节点／边界的 207 张 390px 帧，未见多行字幕底框重叠、原文裁切或出处水印碰撞。两处原文五阶段完整，17 个图解节点及两个阅读目标保持句关联。并列关系明确注明箭头仅为阅读顺序。最终音轨实际解码及本地 Whisper base 转写覆盖到结尾，但存在 ASR 替换字，不代表核听或逐字声学准确。证据位于 `.bmw-runtime/production-reliability/live/codex/review-d49cca9b2f6b26b6/`；实际 BMW 已从 0:00 连续播放至 1:42 自然结束，中途观察到并列因素节点切换；当前 MP4、指纹及旧资料哈希均保持不变。

最新源码的 build/check 通过；`.bmw-runtime/production-reliability/review-order-core/result.json` 覆盖全部 80 个 unit/contract/boundary/type 分类项及四个检查门，共 84 passed、零 failed。其余 runtime/desktop/external 不在该次分层范围，不能把本报告当作完整基线；报告保留实际运行时的源码哈希，随后本段验证说明更新不改写报告。

2026-10-15 解锁桌面后，重新顺序执行 build、check 和冻结源码的完整 `--all` 回归，报告 `.bmw-runtime/production-reliability/full-unlocked-2026-10-15/result.json` 为 139 passed、0 failed、5 external opt-in not-run，runner 退出码为 0。覆盖原生前台焦点／鼠标、Assistant 浮窗、Studio 分支、恢复、媒体／视频／ASR／本地配音、DSH、桌面分组及 Project 实际重启。报告保留运行时源码哈希，随后验证说明更新不改写报告。

真实成片打开随后发现 GUI 素材清单仍在筛选前截取目录前一千项，导致大量审片输出挤掉 MP4 或验收报告；完整清单现已修正，模型读取仍使用原有有界分页。新增断言验证一千余素材后的 GUI MP4／报告／原图可见、symlink 排除及模型分页边界；一次性原生 Studio 实际播放 MP4 并确认播放时间前进。配方／录屏撤销用例等待对话框关闭和撤销按钮就绪后再执行，避免把磁盘提交等同于 GUI 操作收尾。当前 build、check、该完整 Studio 专项均通过，见 `/tmp/bmw-production-reliability-inventory-settled-{build,check,native}.log`。

上述修正后，解锁桌面并冻结源码重新运行完整 `--all`，最新报告 `.bmw-runtime/production-reliability/full-unlocked-inventory-final-2026-10-15/result.json` 为 **139 passed、0 failed、5 external opt-in not-run**，runner 退出码为 0。覆盖此前受锁屏影响的 studio.card-pair、studio、browser.background、desktop.native 及 desktop-suite，以及修正后的大素材库原生播放、撤销重做、媒体、视频、语音、本地配音和 DSH。此前锁屏导致的 134/5 报告仍保留在 `full-final-inventory-2026-10-15`；受执行环境限制的 85/54 报告及配方测试等待错误的 138/1 报告保留在 `full-inventory-2026-10-15`、`full-inventory-native-2026-10-15`，不改写历史结果。后续文档更新不改变各报告实际源码哈希。

Qoder CN／Qwen3.8-Max 的独立新稿 `2a0b9e02-91a0-400a-b229-43459d8c4350` 最终为 v47、十场、实测 96.107 秒；实际 BMW 运行 `243d3dc5-9559-4e6e-8d4c-17f88142257f` 正常结束。内容已去除制作验收说明，访问条件与三种同时存在的体验分开；首版两处长静止由短标题、原帖截图缓推与结尾逐条揭示改善。最后一次仅将 a3 英文摘录改为原文连续子串 `Free-tier, paid-tier, internal.`，消除 internal 断词；完整句子仍保留在真实截图与原矩形，旁白及有效图解未变。

Qoder 最终 MP4 `media-5fc05358-27bb-498b-ac4f-0edfd4d1478b-converted.mp4` 的 SHA-256 为 `9af14963fabe91b54710e2bf174b75e4fa48328648eee6cc4a3e1d3476f29bee`，当前指纹 `6721dffce8237f31777b6dda3ad041b7f19ed328d2a10939b01f916d6a1a22d6`。模型按新指纹重新实际查看全部 196 张关键手机帧、十场意见 sequence 1–10，再单独保存整片意见 sequence 11；没有沿用旧指纹通过，用户意见仍为 pending。独立最终解码 224 张手机帧：192 张 PNG SHA 与上一版已完整目检的样本相同，32 张变动帧全部重新查看并保留对比清单。原文五阶段、图解句关联、英文引句完整性与字幕／署名／水印间距按已查看样本通过；最终音轨实际解码、本地转写覆盖到结尾，ASR 有替换字，不代表核听或逐字准确。实际 BMW 从 0:00 连续播放至 1:36 自然结束，中途观察四层漏斗节点高亮，未跳转／暂停。证据位于 `.bmw-runtime/production-reliability/live/qoder-cn/review-6721dffce8237f31/`；前两份中间版及发现的问题记录原样保留。基线旧草稿／素材 SHA 均未改变。

此前诊断报告 `.bmw-runtime/production-reliability/full-regression/result.json` 的 125 passed、14 failed、5 external not-run 原样保留。它发现的紧凑模型结果与旧来源／Assistant／参考／录屏夹具适配及前台窗口问题已经修正并纳入上述完整复测。付费双驱动制作走用户授权的 BMW 产品操作，和一次性 Profile/Home/Workspace 的自动测试分开记录。

审片意见顺序另有确定性回归：冻结同毫秒及回拨时钟，验证镜头重新通过不恢复旧整片意见、旧 Schema 1 日志只读不改写及明确写入 Schema 2 后的状态；保留 `/tmp/bmw-production-reliability-review-order-red.log` 的真实失败与修正后的 unit/check/native 日志。原生 GUI 验证新镜头意见清除旧观看勾选，并要求再次明确整片确认；这仍是一次性夹具，不是用户或付费模型成片验收。

## 当前视频功能验收

视频改进涵盖实际 MP4 手机尺寸审片、关键状态文字/节奏提示、阅读/重点/图解/数字/关键词的句引用、Project 素材索引与源区间 ASR、原声转解说、单镜头本地配音恢复和录屏段落整理/放大镜。契约预算、来源与拒绝规则维护在功能规格；质量提示不能代替人工视觉/核听或事实检查。

分类入口为 video.material-index、video.schema、video.studio、studio.export-review、video、speech、localNarration，以及既有 DSH、桌面与 Studio 分支。studio.export-review 通过实际 DOM/IPC 校验卡片引用、素材说明保存/检索、配方/录屏分段撤销重做和真正的本地 WAV 恢复；video 实际编码/解码验证原声切换音量、保留全画面的局部放大及显式压缩后的时长；speech 校验 182 秒 WAV 的末尾区间、固定本地 ASR、原源时间投影、素材语音检索与取消清理。

本任务验证汇总保存于 `.bmw-runtime/video-improvements/final-verification.json`，保留原分类报告及它们各自的源码哈希，不改写历史失败记录。四类卡片实际 MP4 和八张手机帧存于 card-slots；三份既有本地样片的九张手机帧存于 prior-samples，原文件指纹保持不变。夹具使用临时 Project/Profile/Home 与模拟钥匙串；合成音频/人工锚点只证明原时钟和渲染行为，真实本地语音测试不证明声学精度或付费模型质量。专用 AI 素材生成、自动逐词时间和完整视频语义审批不在当前覆盖内。

## 共享视频 schema 基线（2026-10-08）

该基线实施单份 Video Document 2.0、简洁编辑可逆子集、可信高级权限、类型命令、原字节备份与无损迁移。没有继续扩展 UI 工作流或专用 AI 素材生成；原生复测发现的模式切换播放位置和时间轴末端手柄被原生滚动条遮挡问题已修正。旧分支中“独立对象可返回卡片”的断言按批准的共享约束改为阻止返回并保留内容；原始时钟、实际鼠标、CAS、签名撤销及原生媒体精度断言继续保留。

2026-10-08 同版完整离线原生回归已完成，报告为 `.bmw-runtime/classified-tests/2026-10-08-video-schema-accepted/result.json`：130 个离线分类项、四个检查门与桌面汇总全部通过，共 135 个 passed、零 failed；五项 external 未运行。runner 退出零并更新完整 test-baseline.json，运行期间源码与编译输出保持冻结。测试后仅本验证说明更新，随后 npm run check 通过；完整基线保留 runner 实际运行时的哈希，不手工改写为文档更新后的哈希。

两份机器 JSON Schema 经独立 Draft 2020-12 校验器检查，三份文档／命令示例均有效；运行时代码生成的 Schema 和示例纳入 npm run check。video.schema 的九项契约测试与既有 Studio 的 111 项测试共同通过，覆盖完整字段往返、原字节备份、亚微秒迁移、时间权威、身份／未知结构拒绝、简洁闭包、owner／CAS、原子提交、无写入试算及实际高级授权。studio.schema 验证真实鼠标创建对象、UI／IPC 返回限制、陈旧 selection／revision、签名撤销恢复简洁、Agent 拒绝绕过、试算和真实 MP4；完整原生分支继续验证源字幕／语音、切割／缓动／淡入淡出、特效／音轨、Assistant、恢复、Project 和导出。

初始作者文件、HEAD 和 index 保护审计与补丁、机器 Schema 独立校验、报告副本存于本次任务 bmw-video-schema-implementation 输出目录。此次未提交／推送，也未修改生产 Profile 或用户 Project。保护审计另发现八个带编号的源码／文档副本，未由本次补丁产生，来源未确认；已记录哈希并保留，不作为活动入口或权威文档。

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
| npm run test:affected -- --files … | AST 依赖、行为 watch 与接口保障选择并执行；未知／删除／共享配置保守升级 |
| npm run verify:stability | 一次 fresh build 后串行全部离线分类测试，包括各 Studio 环境分支；external 不运行 |
| npm run docs:features / docs:architecture | 刷新源码生成清单；刷新本身不是测试通过 |

所有含构建的命令顺序执行。资源受限时使用 GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1。直接调用 test-runner 必须匹配最新 build receipt；源码在验证中变化使 source-integrity 失败。完整通过时才更新 test-baseline.json；失败保留旧完整基线和本次失败日志。

## 证据边界

Electron 使用临时 Profile／Project，DSH 使用临时 Home／Workspace；macOS 测试使用 mock keychain。真实生产 Profile、系统钥匙串授权、实际用户使用体验及设备／网络差异不能由隔离夹具证明。原生鼠标事件、DOM／IPC、共享 Canvas、实际 MP4 和音频验证按各日志范围解释，不扩展为完整用户验收。

离线测试不使用付费模型或 Edge 网络语音，不证明 OAuth／Key 有效性、余额、所有模型额度、翻译／建议质量或完整视频语义。external.assistant.*、external.vision、external.edge 是独立 opt-in；本轮不重新运行。专用 AI 素材生成暂缓，无对应服务接入或验收。

## User-listened Whisper base adoption

十段 base 音频和十二个可编辑锚点的用户核听采用属于既有历史证据，原记录见 [采用记录](history/2026-10-07-consistency/VERIFICATION.md#user-listened-whisper-base-adoption)。它证明当时的手动采用路径，不是独立声学金标或 P95 准确率；自动句／词／字同步精度未获批准。

## 历史报告

共享 schema 前的一致性报告保留在 `.bmw-runtime/classified-tests/2026-10-07-consistency-*`；这些历史结果不证明当前 schema 版本：

| 后缀 | 范围与解释 |
|---|---|
| audit | 首次全量；发现过时 HTML5 拖放测试 |
| final | 修正后全量；原生卡片夹具失败，其余项按原哈希解释 |
| focus | Studio／边界；保留原生输入和旧草稿等待失败 |
| card-isolated / card-fixtures / card-diagnostics | 单独原生尝试与事件诊断；buttons=0、captured=false 暴露缺失左键按住状态 |
| card-native | 原生卡片专项通过；实际 buttons=1、指针捕获、真实失焦／Escape／越界、CAS 与媒体断言均保留 |
| fixtures | Studio／Assistant／启动恢复／边界；素材替身缺少 updateTabState，延迟保存触发原生错误弹窗；分割等待顺序错误及最后原生焦点因锁屏失败。日志与进程栈保留 |
| dom-repair | 当前编译版本的素材延迟页签保存、带绑定／普通整镜头分割均通过；DOM／IPC／原生媒体证据，非前台指针验收 |
| 2026-10-08-consistency-native（独立完整目录） | 同版 --all 全量通过，132 passed／0 failed／5 external not-run；真实焦点与指针、所有 Studio／Assistant 分支、四组桌面及 Project 重启、原生媒体通过；完整基线已更新 |

修正包括等待原生／页面焦点稳定，所有原生拖动移动携带 leftbuttondown，卡片外释放坐标仍在所属 WebContents，独立分割 scene ID 与所属草稿七秒预览等待，以及隔离 ProjectStore 页签保存契约。未捕获测试异常直接打印并失败退出，避免 Electron 原生错误弹窗阻塞验证。素材截图采用现有的有界 renderer evidence 路径。产品失焦取消、归属、CAS、历史与媒体规则没有因此放宽。

2026-10-08-consistency-native 是引入共享 schema 前的完整基线。当前 schema 调整后的早期全量报告保留在 `2026-10-08-video-schema`、`2026-10-08-video-schema-final`、`2026-10-08-video-schema-verified` 和 `2026-10-08-video-schema-complete`；这些尝试包含失败，不能当作本轮通过证据。`.bmw-runtime/video-schema-corrected` 保留真实鼠标、预览绘制时序、缓动裁剪手柄和语音绑定切割的独立复测／诊断。最新完整结论以本文顶部指定的 accepted 报告与其源码哈希为准；没有覆盖早期失败日志或手改测试基线。

2026-10-05 的 Agent 数据／GPT-6／登录报告、已授权真实 Profile 迁移与付费模型快照、2026-10-06 至 10-07 各 Studio 专项、失败尝试及锁屏等环境限制完整保存在 [核查前验证原文](history/2026-10-07-consistency/VERIFICATION.md)。[驱动实施证据](AGENT_DRIVERS_IMPLEMENTATION.md) 保持对应版本解释。旧结果的源哈希和适用范围不因此次整理改变。

当前功能不再重复标为待开发。历史“仍未完成／待解锁／继续推进”仅属于该阶段；后续 UI 优化现已暂停。产品状态见 [PROJECT_STATUS.md](PROJECT_STATUS.md)，Studio 能力与测试对应见 [VIDEO_STUDIO_NEXT.md](VIDEO_STUDIO_NEXT.md)。
