# Video Document 2.0：编辑器共同约定

当前实现以 `bmw.video` / `schemaVersion: "2.0"` 保存一个视频文档。简洁卡片和高级时间轴使用同一份内容；模式偏好属于界面状态，不写入视频内容。原生预览和导出通过受校验的 v1 运行时投影消费文档，不保存第二份可编辑草稿。

本版落实共享结构、可逆子集、编辑权限、迁移和测试约束，并表达现有原生能力。它没有扩展为无限制的非线性编辑器。提案中尚未实现的任意轨道空隙、嵌套序列、任意代码/HTML、插件特效、任意分数帧率和 AI 图片/视频生成不在可写 schema 或 capabilities 中。

## 文件与权威数据

机器文件由运行时代码生成；`npm run docs:video-schema` 更新，`npm run check:video-schema` 检查是否同步：

- [文档 JSON Schema](schemas/video-document-v2.schema.json)
- [编辑命令 JSON Schema](schemas/video-edit-v1.schema.json)
- [高级文档示例](schemas/video-document-advanced-example.json)
- [文档示例](schemas/video-document-example.json)
- [命令示例](schemas/video-edit-example.json)
- [外部 Agent 使用说明](AGENT_VIDEO_EDITING.md)

| 分区 | 内容与约束 |
| --- | --- |
| `format / schemaVersion / id / revision` | 固定格式、版本、草稿身份和 CAS 版本。 |
| `owner.sessionId` | Host 写入的对话身份；历史无 owner 的记录可读取，但不允许编辑或迁移。Project 由文件所在 Project 与已认证调用者确定，`read-document` 返回可信 `projectId/sessionId` 外层；不能由文档更换。 |
| `content.settings` | 画幅、尺寸、整数帧率、配音配置、音乐、样式、水印和模板。 |
| `content.brief` | 背景/目标/受众等制作说明、大纲、已有 Project 素材与来源 ID。背景是可选内容。 |
| `content.story.scenes` | 分镜身份、标题、脚本、画面说明、要点、来源/引用、字幕样式、模板、编号和结束策略。**不存分镜时长或全片起点。数组本身不决定播放顺序。** |
| `content.timeline.regions` | 分镜在全片的唯一位置与时长，按播放顺序连续排列；关联 sceneId。 |
| `content.timeline.tracks / clips` | 每镜头的主画面、旁白、字幕，以及镜头内或全片独立视觉/音频对象。显式片段使用唯一 ID、类型、所属范围、位置和闭合类型参数。 |
| `content.cover` | 封面标题、素材、取帧时间和排版。 |
| `records` | Host 的更新时间、成片/封面日志、参考分析、实验审阅记录和每镜头的音频来源、实测时长、ASR/句锚点/来源字幕绑定/连续性来源时钟。不可通过普通编辑伪造。 |

素材继续由 Project 资源库管理。文档引用受限 `artifactId`，不复制文件、凭证、任意路径或 URL 执行能力；`video.studio assets` 读取真实库存，`inspect/check` 读取实测属性。来源网址和引用仅为内容，不是执行指令。

分段画面所在镜头的 `visualDefaults` 保存现有的镜头级参数与回退素材；它不承载另一套片段位置。旧格式显式空图层/音轨容器的存在性由 `records.emptyContainers` 保留，不可用来证明简洁兼容。自动旁白没有伪造显式裁剪区间：`sceneEvidence.voiceEncoding=auto` 与真实配音绑定保留原有默认播放规则；旁白的显式 timing/segments 才进入可编辑 clips。

## 时间和身份

- `settings.timebase=1000000`；放置时间为 `{ticks: 整数}`，单位微秒。保留旧 JS 时间精度时可带绝对值不大于 0.5 微秒（另允许 1 皮秒浮点误差）的 `residualSeconds`，二者共同表示一个值；不是第二套时间。
- region 的时钟为全片。镜头内 clip 的 `timing.clock=scene`，全片独立对象为 `timeline`。命令 `time` 一律使用全片时钟，Host 转换为所属容器时间。
- 一般 clip 使用 `start/duration`；字幕使用 `start/end`，不同时保存 duration。区间均为左闭右开。字幕端点、源媒体 `sourceStartSeconds/playbackRate` 和受保护的来源时钟保持既有精度，不把原声时间当作镜头时间。
- `frameRate={numerator:12..30 的整数,denominator:1}`。本版不接受未实现的分数帧率。
- clip ID 在类型、所属镜头和原有对象身份的命名空间中生成，避免旧格式不同类型的同名 ID 冲突。`sourceIdentity`/原有旁白 `id` 是受限桥接身份；Agent 使用 `read-document` 返回的 clipId，不猜测或修改 ID。索引生成的字幕/旧匿名片段 ID 仅对当前 revision 有效，编辑后需重新读取。

本版沿用原生预算：最多 24 个镜头、180 秒全片、每镜头 8 段主画面/旁白、每容器 8 个独立视觉和音频对象、全片合计 64 个独立对象、最多 4 个同时解码的视频叠加对象；文档最多 1 MiB。结构检查允许尚未准备好的草稿；素材可用性、解码、时长覆盖和文字排版仍由 `check` 与实际预览/导出核验。

## 简洁与高级的关系

`simple.cards/1` 是高级编辑模型的可逆子集。镜头内脚本、字幕、编号、固定模板、主画面分段/裁剪/速率、旁白裁剪/静音、固定画面效果和已映射焦点可以在两种界面往返。底层有多条模板轨道，并不自动变成高级内容。

任一独立叠加图层、独立音轨或自由关键帧均要求高级编辑；隐藏、静音、锁定不等于删除。当前 UI 的卡片属性没有足够的可逆表达，不能把它们隐式扁平化。兼容性返回对象 ID、路径、原因和当前 revision。

- 仅进入高级界面不改变内容或永久锁定。
- 撤销或移除所有不兼容对象后，实时恢复简洁编辑资格。
- 简洁写入同时校验当前内容和最终合并后的候选内容，不允许通过遗漏字段或空数组删除高级对象。
- 返回卡片在 Host IPC 中再次检查当前 owner、selection/revision、dirty 状态和兼容性。UI 显示原因；加载不兼容草稿时卡片内容仅供查看，可使用原来的高级编辑入口继续编辑。
- 编辑权限来自可信的当前高级界面，不接受 Agent 自报 `modePolicy` 或 compatibility。等待素材检查时退出高级模式，提交仍会再次核验。
- 本版不提供自动有损降级；不存在静默删除高级内容的“返回”。将来若增加降级，只能显式创建副本并保留原稿。

## 迁移与原生适配

现有 v1 草稿读取不改写。首次成功保存时转换为 v2；也可用有 owner 与 revision 的 `migrate-document` 显式转换。迁移前把旧文件原始字节以 SHA-256 命名保存到 Project `video-studio/schema-backups`，不会覆盖已存在的不同内容。迁移本身不改内容 revision、不重新生成素材或成片。

转换前将 v2 反向投影与已校验 v1 的**所有字段**比较，遗漏、来源时钟变化、无法映射的结构或超限会拒绝保存。预览/导出、GUI 历史快照和已有动作继续消费派生 v1；普通 update 不接受外来 owner 或伪造 Host 日志/证据。成片记录属于完成的原生任务，不能凭 schema 合法宣称视频已完成。

## 校验与保障

分别判断：JSON 结构合法、当前原生能力支持、简洁编辑可逆、实际素材/渲染就绪。`validate-edit` 不写草稿，返回候选文档、兼容性和准备状态；它不是素材/文字排版验证或渲染成功证明。`apply-edit` 一次 CAS 保存整组命令；任一失败不提交前面的命令。

契约测试覆盖完整字段往返、分段与回退参数、显式空旁白、人工翻译、亚微秒端点、原始淡入淡出/关键帧时钟、旧文件原字节备份、owner/CAS、未知字段、轨道/对象身份、空隙拒绝、简洁编辑闭包和高级权限。已有语音/字幕/导出测试使用相同保存路径。`studio.schema` 原生测试验证真实鼠标创建独立文字、UI 与 IPC 阻止返回、陈旧 revision 阻止模式切换、签名撤销恢复简洁资格、Agent 拒绝绕过、无写入试算与实际 MP4 渲染。
