# Agent 视频编辑接口

BMW 仍只有一个经过验证的模型工具 `browser`。视频编辑通过 `video.studio` 的闭合操作进行，不开放文件系统、shell、Electron IPC 或任意代码。文档定义见 [Video Document 2.0](VIDEO_DOCUMENT_V2.md)。

## 调用顺序

1. `context` 读取可信 Project、Session、当前模式和选中目标。
2. `describe-schema` 读取能力与命令索引；模型按 `describe-edit` 懒读单个命令，卡片参数用 `describe-template`。GUI／直接宿主响应与模型紧凑响应不同，模型不应假定拿到整份 Schema。
3. `list` 获取当前对话草稿、revision、兼容性与 Host 签名快照；`read-document` 携带 `draftId/expectedRevision` 获取摘要及可信 scope；模型用 `read-scene` 的 timeline 分区分页读取实际 clipId，准备资料用 `read-preparation`。
4. 针对读到的 sceneId/clipId 发出 `validate-edit` 试算；真实修改用 `apply-edit`。每次成功修改后重新读取 ID/revision，不把试算当作批准或实际成片。
5. 用 `check` 检查真实素材，再在用户已授权制作时 `render`；仅实际完成返回的 Project MP4 才是成片。

外层调用形状：

```json
{
  "action": "video.studio",
  "studioRequest": {
    "operation": "apply-edit",
    "draftId": "example-video",
    "expectedRevision": 1,
    "edit": {
      "version": 1,
      "commands": [
        {"op":"scene.set","sceneId":"opening","patch":{"script":"新的旁白。"}}
      ]
    }
  }
}
```

## 新闻选题与制作引导

Studio的“推荐新闻选题”先建立当前Project／Session的研究任务，再投递官方Assistant。Agent使用`news-topics`读取候选revision，以`propose-news-topics {expectedTopicRevision,newsCandidates}`提交至多十项有原始来源和已获取真实预览的候选；`news-guide {draftId,expectedRevision}`读取选定草稿的阶段、逐镜头脚本、来源、素材区间、实际音长与缺口。没有配图的公告先collect正文，再以同一正文selector/index调用`media.screenshot`并携带`sourceBinding {sourceId,acquisitionId,expectedRevision}`；Host核对URL／正文SHA／导航后将实际PNG记为来源已获取素材。使用返回artifactId，不拿Logo或搜索摘要代替原页。propose-news-topics帮助直接完整展开候选字段。长采访用原播放器定位关键发言后，source acquire method=capture、fromStart=false从实际当前位置录取短预览，原生证明保存实际源区间，恢复位置／速率后保持暂停；不把片头当关键引述。字段由操作帮助发现，完整闭合契约见[功能规格](FUNCTIONAL_SPEC.md#news-01-新闻选题与制作)。

`select-news-topic {expectedTopicRevision,topicId,baseFingerprint,options?}`只接受可信Studio用户，Agent调用不能代替点击确认。确认前研究任务限制草稿写入、TTS和合成；materials list/search可读取，index仅允许实际≤30秒预览的单个本地转写区间（maxChunks≤1），长素材及set-metadata仍拒绝；确认后由Host创建唯一草稿并投递制作，双击或重启不重复投递，不确定状态不自动重发。默认30–60秒竖屏新闻及Qwen安明远；显式options可覆盖。候选仅日期时保留日精度，最保守时区区间跨出72小时即不可选；日期不明、未来和只有转载标题均不能入选。原始来源或预览失效明确报错，不自动换题。选题账本独立于Video Document 2.10，不增加时间线。

已接受的[新闻案例](research/CODEX_NEWS_REWORK.json)采用龙安朗男声和大幅动态作品对照，结尾回到本次新版的花费／作品变化，金额紧邻“作者本次花费”归因。局部改稿先读当前revision与影响计划，只重新生成受影响镜头旁白；其他声音、字幕、素材与旧MP4保留。核对实际成片的字幕层级及引用重叠，不把素材抽帧当作合成画面。未变镜头审阅复用仍是下一步设计，不跳过当前指纹的检查。

### 日常新闻使用

Qoder提示大结果被转存时，继续用唯一browser在原页面按局部selector／index读取（如逐个article，maxCharacters约1000–2500），不读取SDK宿主临时文件，也不开放额外文件工具。保留多个同源检索页时显式`tabs.open reuse:false`；否则先读完一页再navigate，避免并行打开的查询被同源复用覆盖。检索摘要只用作定位，最终仍collect原始来源。

取材先读实际媒体候选：完整HTTP文件用source acquire method=download；明文完整HLS VOD或需保全分发字节的视频用method=preserve。两者无需按原速播放，视频短预览用method=preserve加preview:{startSeconds,endSeconds}（至多30秒），由Host截取、核对原声及登记同一来源；原文件保全与短预览编码分开记录。blob／不支持的分离音视频可显式capture兜底，不自动回退或绕过登录／加密。切走tab、切换Project、进入Studio会暂停浏览器媒体；回到页面不会自动续播，采集完成也保持暂停。

当前新闻品牌偏好为 **AIpardonSI News**；创建、确认选题或配置本系列新稿时显式设置水印，不改通用视频默认值及已接受的历史成片。采访镜头有视频文件不等于原声已进入混音：主素材必须启用 `keepSourceAudio`，类型编辑用实际主画面 clipId 的 `clip.mute {muted:false}`，不能只解除独立画面图层的隐藏。`scene.set` 不接受这项字段。导出后须在采访实际时间窗内 `media.audio.sample` 并用原生语音识别核对讲话；全片有 AAC、峰值非零或字幕齐全均不能证明采访原声存在。音乐床会产生低电平非零信号，必须和源片及修复前后同内容区间比较。模型信号检查与人工听感分别登记。

演讲类新闻先核“具体理由”，再配音：定义加断言不等于解释。图表数字保留指标、基准、时间与归因；例如IMF案例是内部季度人均代码量，不能改成整体效率。已核素材足够时先完成可播放初稿，再集中审阅；工具发现和取景试制过长应明确停止、读取保存状态并显式续做，不能重发不确定投递。

1. 固定一个新闻Project，本系列当前优先使用BMW＋官方Qoder CN，在官方模型目录显式选择DeepSeek-Flash（`dfmodel`）；龙安朗与AIpardonSI News沿用当前系列偏好。DSH与`deepseek-official/deepseek-flash`保留独立会话使用；切换驱动不会迁移原会话的选题、草稿或恢复锚点，也不自动回退。两者均须已登录且有效目录只有BMW `browser`。完整日常操作见[新闻速递手册](NEWS_DAILY.md)。
2. Studio展开“新闻速递 · 选题与制作”，在本次旁白中显式选龙安朗，再点击“推荐新闻选题”。每批最多十个独立事件，近72小时、有原始日期及真实素材；不足十个不凑旧闻。采访／演讲先试听原声预览，再决定是否值得做视频。
3. 点击一次“选此题并制作”，沿用已有分阶段确认设置。先检查讲述重点及本人解释是否完整，再看稿件、原片区间、字幕和实际音长；原声镜头显示“沿用采访原声”，不要求为它另做TTS。默认30–60秒竖屏，旁白与采访原声分时衔接。
4. 初稿播放后把关联修改合成一条说明。先`plan-impact`，只改相应台词／字幕／素材；保留无关声音，统一导出后按新指纹审阅。烧录英文不能直接调字体，可另做大号可编辑双语字幕，检查底框、人物身份和手机可读性。用户接受与Agent意见分别记录。
5. 次日点击“推荐新闻选题”开始新批次，旧来源、草稿、声音和成片保留。取消／断线后先确认任务已停止并读取最新保存状态；不确定投递不重发，不重复点击制作。账号、网络或音色不可用时明确恢复，不静默换驱动或提供方。

查看原始来源会先保存GUI改动，复用当前Project相同URL的页面并显示浏览器；没有时才新建，重复点击不累积后台页。来源目录最多200个来源／1000次获取，接近预算时归档并新建下一周期Project，原材料保留。

日常研究的Agent页最多6个，包含其弹窗；重启保留身份继续回收。切换Project释放Agent浏览器实例，返回时恢复地址和身份；原文与媒体已入Project后不依赖页面一直打开。用户手动页面不自动关闭，旧URL-only记录也不会被猜成临时页；需手动关闭旧页面或为日常新闻新建Project。上述流程不创建定时任务或自动对外发布；真实账号制作质量、在线配音与本地离线测试分别验收。

## 当前可写内容

| 命令 | 参数与语义 |
| --- | --- |
| `brief.set` | patch 仅含 production、notes、outline、artifactIds、sourceIds，复用准备资料校验。production 为2.10闭合工作表，不能伪造Host绑定和审阅证据。 |
| `scene.add` | scene 的 id/title 与闭合内容字段；可用 afterSceneId 指定插入位置，不接受宿主证据。 |
| `captions.set` | sceneId，mode=manual/sentences/off；manual 提供 cues，沿用人工翻译保护及时间验证。 |
| `card.set / card.bind` | 设置闭合 cardSpec／links 或仅更改句引用；来源和目标身份须有效。 |
| `scene.set` | sceneId + patch：title、script、visualBrief、bullets、layout、captionStyle、captionDisplay、showSceneNumber、sceneTemplate、endPolicy、citations、sources、durationSeconds。字段受原生类型及范围检查；不允许改 owner、revision、来源证据和实际音频时长。 |
| `scene.reorder` | sceneIds 必须为现有分镜的完整排列，不允许重复、遗漏或插入陌生 ID。 |
| `clip.move / clip.trim / clip.split` | 当前 clipId 和全片 time `{ticks}`；trim 还需 edge start/end。复用原生编辑规则、最小时长与连续性时钟；不能借此生成任意空隙或跨镜头自由主片段。 |
| `clip.effects` | 当前主画面 clipId + 闭合 effects 对象或 null。独立图层 effects 暂不开放此命令；现有 GUI 中保存的合法图层效果仍完整保留。 |
| `clip.mute` | clipId + muted 布尔值。原声画面/显式旁白按现有规则静音；独立音轨或图层需要高级权限。 |
| `layer.add` | kind=text/rectangle/image/video/audio/diagram/card-stack；可选 sceneId，否则全片。媒体类型需当前 Project artifactId；Host 分配身份；diagram 创建默认曲线，card-stack 原子创建六个独立对象，仍需高级权限与足够预算。 |
| `layer.set` | clipId + 闭合 patch：title、位置尺寸、opacity、zIndex、hidden、locked、color、text、fontSize、textTreatment、packaging、sourceCrop、science、volume、muted、fadeInSeconds、fadeOutSeconds、ducking、keyframes。字段必须符合对象类型，锁定对象先单独解除 locked；不允许改来源时钟/原始淡入淡出记录/身份。 |
| `layer.remove` | 当前独立对象 clipId，遵守锁定与当前高级编辑授权。 |

一般时间为微秒；例如全片 1.5 秒是 `{ "ticks": 1500000 }`。clip 的时间域见文档，命令 time 始终是全片时间。显式字幕端点没有另一套 duration；字幕 ID 或旧匿名片段 ID 在结构编辑后可能变化，必须重读。

旧 `read/update/attach/narrate/split-scene` 和字幕/语音专用操作继续可用，但 read/update 是共享文档的 v1 运行时投影。新编辑优先使用类型命令，避免全量快照覆盖。新增镜头可用 scene.add，配音仍使用既有已校验的接口；当前命令没有宣传全功能 NLE 或 AI 素材生成。

## 类型制作、改稿与预合成

`production-profiles` 读取三类版本化指导与六种有限配方；`propose-type` 返回候选编辑与指纹，`adopt-type` 仅在相同 revision、指纹与实际来源仍匹配时显式采用，保留既有 GUI 编辑。`production-read` 分页读取工作表，`production-review` 返回当前缺口与独立 assessmentRevision；`record-production-review` 按可信 actor 记录意见，Agent不能填写人工试听、观众复述或人工必需项的通过。

改稿前可用 `plan-impact` 只读试算既有 VideoEdit 或闭合 cover 候选，读取 keep/rebuild/rebind/review 与理由；结果绑定 revision、素材 SHA、设置和 renderer，消费前须重查，不预约任务或代替执行权限。句目标与既有 card/focus 句绑定共用时间，换音频或目标后需明确重绑。

`precompose` 以闭合 gridRecipe 将当前 Project 的1／4／16路素材分块预合成，保持最多四个同时解码器及既有预算；`precomposition-status` 读取当前草稿报告并重核 SHA。代理内部对象不能直接编辑，需按原配方显式重建。参数仍通过 `describe-schema`／操作帮助发现；完整边界见[功能规格](FUNCTIONAL_SPEC.md#类型制作与-ak-增量video-document-210)。

身份介绍使用影视资料时，先确认人物、作品及原始发布者，并显著标注影视出处；原片不充当本次新闻发言证据。仅补短切口可在高级模式内添加独立 video／text／必要的 rectangle 层，读取实际新增 clipId 后设置裁切和时间，保留原主画面、旁白及字幕。独立视觉视频不自动带入音轨，不能用 `clip.mute` 控制其原声（该操作会隐藏视觉对象）。用覆盖完整底图区域的遮罩避免人物头身拼接；对导出文件实际检查切入、切出及标签。不要把带测试模板外框或场景编号的 `video.compose` 预览替换为正文主素材，也不要用它绕过 `STUDIO_ADVANCED_REQUIRED`。

## 权限、冲突与失败

- Project 与 Session 从认证入口固定；不可提交路径、凭证、owner 或另一个 Project 作为编辑目标。
- 在当前简洁模式中，`validate-edit/apply-edit` 和旧 update 均要求当前草稿与最终候选处于可逆子集。需要自由图层/音轨/关键帧时请说明原因，由用户使用现有入口进入高级编辑；禁止自行宣称高级权限。
- 不得删除用户的人工字幕/译文、重写来源证据或伪造实测时长、hash、成片记录。现有 Host 保留及翻译保护同样适用于类型命令。
- `STUDIO_CONFLICT` 表示 revision 或实际内容已更新。重新读取并合并，不自动重放整组修改。
- `STUDIO_ADVANCED_REQUIRED` 返回兼容性原因。保持原稿，不自动扁平化或清空轨道。
- 试算不保存文件、不生成成片；layer.add/clip.split 的候选新 ID 不可当成已保存对象。apply 成功后读取实际 ID。
- 每组命令最多 32 条。素材准入、操作取消、Project 切换、实际渲染限制和媒体解码失败均可阻止提交/导出。
- `migrate-document` 携带当前 revision 显式迁移拥有的 v1 草稿，Host 保留原字节备份；读旧草稿不会自动写入。
- `describe-schema` 给出支持范围，JSON Schema 合法仍需跨引用、时间、原生预算、权限和真实素材验证。未来版本/未知字段直接拒绝，不猜测兼容。
