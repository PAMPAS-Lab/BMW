# 本机创作案例与历史问题复核

2026-10-17 补收。来源位置及 SHA 见[本机清单](LOCAL_RECORDS_INVENTORY.json)，交付版本见[交付账本](../history/local-deliveries/README.md)。本页分析旧记录，不宣称重跑付费模型、重听成片或重新认证帖子事实。

## Karpathy：从展示信息到帮助理解

早期 X Arena Project 围绕 `karpathy/status/2105819303471976479` 比较文字、图解、HTML 和解释视频。记录中的讨论强调观众能改变条件、作出预测、获得反馈；线性视频重制成本与验证延迟也是限制。这支持 CONTENT-01／03／04／08 的方法研究，不构成开放任意 HTML 或执行代码的理由。

早期 16:9 本地旁白版约 168.98 秒、Edge 版约 174.76 秒；9:16 对宽推文的裁切不佳、3:4 较好只适用于当时素材，后来“整体定位→局部阅读”的方案不能被旧比例结论否定。一次源截图误认作者后更正，说明 SOURCE-01 需要身份及引用关系证据。短句 TTS 探针与有限成功次数不足以排名语音服务；旧记录的硬编码本地旁白、不能删除、180 秒限制均不是当前状态。

后续认知漏斗主题使用另一帖子 `karpathy/status/2109361546505966046`。原 Qoder／DSH／Codex 对照分别为 Qwen 3.8 Max、DeepSeek V4.1 Flash、gpt-6-astra；不能改写成 GPT-6.1 Sol 的统一模型评测。不同日期、上下文、语音和指导条件下，原文数字误读、标签裁切、长静帧与引用可读性比单纯时长更值得追踪。后续 Sol、context、rhythm 和 Qoder reading 改善了整体阅读、节奏与工具恢复；技术通过仍不等于理解效果或用户满意。

## Musk 每日视频：九项旧缺口的当前归属

原记录位于 `.bmw-runtime/musk-daily-production/gap-analysis.json`。2026-10-09 的公开 24 小时窗口不是完整账号时间线；转发时间存在未知。9 条来源 URL 不等于 9 条已采用正文精确引用。

| 旧问题 | 当前核对与结论 | 代码／测试或剩余计划 |
|---|---|---|
| X 重置导致采集源时钟 0–0 | 已有源时钟映射及持久索引；不能沿用旧结论 | media-native/capture-timeline、capture-source-index；media.capture-source-index |
| 首帧约 0.012 秒，Ready 与渲染不一致 | Studio 已用实际 track.startSeconds 检查区间；旧原片特定回归未重演 | feature-video/studio-service.ts 的 checkDraft；后续加正首 PTS 定向用例 |
| 流媒体获取 | 已有确认播放器采集和受限 HLS VOD 保全；不等于任意 DASH | 现有 media 专项；MEDIA-03／04 |
| 帖子、引用帖、画面身份混淆 | 正文读取和精确引用已有；显式关系仍待设计 | SOURCE-01 |
| 原声切旁白 | 已有 apply-source-narration 与连续源时钟 | source-narration-recipe.ts；video.studio、video-production-smoke.ts |
| 裁切参数／过期镜头 ID | 已有类型化编辑、CAS、稳定 ID 和分页读取；不能证明旧每次失败根因都已消除 | 当前 Studio 契约；新复现才作为缺陷 |
| 可编辑工程交付 | 开发侧复制文档不等于正式产品导出 | DELIVERY-01 |
| 字幕安全区／对比度 | 已有字幕背板对比与布局检查；源作者条和内容取舍仍需审阅 | media.production；CONTENT-01 |
| 长引用阅读 | 已有定位、分段阅读、句锚和图解联动 | 当前阅读契约；CONTENT-01 保留理解验收 |

## 博客卡片与检查语义

三份交付应分别计数：早期竖版博客卡片、横版 GPT-6／Intelligent UI、青少年学习规划博客。横版曾出现 44% 指标中途显示 23% 和原文数字被裁切，后续改成淡入保持并加宽区域。青少年版保留 71.03 秒旧导出后交付约 69.03 秒版本；推荐文章的视频未作为正文媒体采用。

旧记忆把纯文字配音卡的 `gapSeconds` 当成音频缺失。现有 sceneCoverage 的 available/gap 描述画面覆盖，不是 PCM 检测；文本卡可以有该值而不触发视频素材缺口错误。音频应看实际旁白时长、音轨检查和核听，不能从此字段断言静音。卡片比例、源数字和引用展示属于 CONTENT-01 的内容验收，不需要重复建设已存在的组件。
