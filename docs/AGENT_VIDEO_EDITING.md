# Agent 视频编辑接口

BMW 仍只有一个经过验证的模型工具 `browser`。视频编辑通过 `video.studio` 的闭合操作进行，不开放文件系统、shell、Electron IPC 或任意代码。文档定义见 [Video Document 2.0](VIDEO_DOCUMENT_V2.md)。

## 调用顺序

1. `context` 读取可信 Project、Session、当前模式和选中目标。
2. `describe-schema` 读取实际 documentSchema、editSchema、capabilities、支持的 commands 与高级编辑是否已授权；不要依据提案猜测尚未实现的字段。
3. `list` 获取当前对话草稿、revision、兼容性与 Host 签名快照；`read-document` 携带 `draftId/expectedRevision` 获取共享结构及可信 scope。
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

## 当前可写内容

| 命令 | 参数与语义 |
| --- | --- |
| `scene.set` | sceneId + patch：title、script、visualBrief、bullets、layout、captionStyle、captionDisplay、showSceneNumber、sceneTemplate、endPolicy。字段受原生类型及范围检查；不允许改 owner、revision、来源证据和实际音频时长。 |
| `scene.reorder` | sceneIds 必须为现有分镜的完整排列，不允许重复、遗漏或插入陌生 ID。 |
| `clip.move / clip.trim / clip.split` | 当前 clipId 和全片 time `{ticks}`；trim 还需 edge start/end。复用原生编辑规则、最小时长与连续性时钟；不能借此生成任意空隙或跨镜头自由主片段。 |
| `clip.effects` | 当前主画面 clipId + 闭合 effects 对象或 null。独立图层 effects 暂不开放此命令；现有 GUI 中保存的合法图层效果仍完整保留。 |
| `clip.mute` | clipId + muted 布尔值。原声画面/显式旁白按现有规则静音；独立音轨或图层需要高级权限。 |
| `layer.add` | kind=text/rectangle/image/video/audio；可选 sceneId，否则全片。媒体类型需当前 Project artifactId；Host 分配身份。 |
| `layer.set` | clipId + 闭合 patch：title、位置尺寸、opacity、zIndex、hidden、locked、color、text、fontSize、volume、muted、fadeInSeconds、fadeOutSeconds、ducking、keyframes。字段必须符合对象类型，锁定对象先单独解除 locked；不允许改来源时钟/原始淡入淡出记录/身份。 |
| `layer.remove` | 当前独立对象 clipId，遵守锁定与当前高级编辑授权。 |

一般时间为微秒；例如全片 1.5 秒是 `{ "ticks": 1500000 }`。clip 的时间域见文档，命令 time 始终是全片时间。显式字幕端点没有另一套 duration；字幕 ID 或旧匿名片段 ID 在结构编辑后可能变化，必须重读。

旧 `read/update/attach/narrate/split-scene` 和字幕/语音专用操作继续可用，但 read/update 是共享文档的 v1 运行时投影。新编辑优先使用类型命令，避免全量快照覆盖。新增镜头和配音仍使用既有已校验的接口；当前命令没有宣传全功能 NLE 或 AI 素材生成。

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
