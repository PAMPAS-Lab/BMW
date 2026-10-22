# AI 新闻固定来源与真实滚动链路

核验日期：2026-10-21。功能与权限以 [FUNCTIONAL_SPEC](../FUNCTIONAL_SPEC.md) 为准，实施设计见 [LIBRARY_STREAMS](../plans/LIBRARY_STREAMS.md)。本轮用户明确选择只验证近72小时，没有生成七天快照。

## 固定来源

素材库 → 来源订阅 → 添加 AI 新闻固定来源。目录提供24项建议入口：7项机构公告、3项研究、5项科技报道、9项X/YouTube观察。可勾选1–20项并关联当前Project的跟踪方向，默认暂停；重复添加相同预设保留编辑、状态、游标和历史，不建立周期计划。完整URL、身份核对入口及限制见 [source-presets.ts](../../packages/feature-library/src/source-presets.ts)。目录建议与本轮实际访问成功是两回事，未将24项全部认定为在线可用。

X观察区分账号、帖子、主题和趋势；YouTube区分频道、视频和搜索。URL确定观察类型，指标逐字来自已存原文；配置语言/地区不冒认实际页面口径，单次观察不推断增长或全站热点。旧线索缺少新增可选类型时原样保留。

登录跳转、反机器人和错误页保留来源与受限检查，不能成为内容线索或推动成功游标。局部账号资料可作为明确标注缺口的观察；它不能替代原帖、原视频或趋势证据。

## 方法与数据保全

使用公开原站Chromium页面、真实BrowserKernel、原生媒体Worker、AssistantService/Host与认证Bridge，以及正式的来源、rolling和recommendation服务。原文记录明确的DOM范围、获取时间、来源/获取ID和SHA，原生页面PNG绑定同一份原文；页面变化不放宽截图校验。页面预览采用正常浅色浏览器主题和1280×900视口，不改写原站DOM。

队列由确定性集成适配器驱动，非付费模型推理。原站访问是实际公网，页面没有被协议夹具替换；这不证明官方模型自主检索、抽取或新闻判断质量。全程为隔离Profile/Project，不复制登录态、不访问生产Profile、不改写生产资料、不发布内容。每次输出目录独立，存在旧Project即拒绝覆盖；中间失败和不足材料均保留。

每来源最多18篇文章，加入口和一次明确正文变化后的新获取，最多20次原文观察，且沿用十分钟任务租约。只有收到明确的正文变化错误才允许一次新获取，保留旧原文/线索修订；不重发Host输入，不对不确定投递重试。社媒空白页面仅有限等待DOM就绪，仍无正文则登记缺口。

事件是可追溯的编辑整理：同一Orchestra Bio收购的官方公告与媒体报道归并，原事件退休、两份证据及历史保留。未把URL去重当作全自动语义核实。正文/日期/署名缺失、过期或预览不合格的材料仍留底层库，不进入合格推荐。图文预览不满足AI新闻成片开头真实动态视频的要求，未启动选题、草稿、配音或合成。

## 窗口滚动验证

只显示日期而没有明确时区时间的原文，继续按已有最保守日期范围检查72小时。本轮在UTC 10:00前曾生成十题快照；越过边界后，四条“10月19日”资料自然过期，新快照仅七题，继续补查后曾为九题。完整快照、七题和九题不足快照各自冻结保存，没有回写旧快照或补造时区。

本机中间证据：`../../.bmw-runtime/ai-news-real/live-72h-3/`（较早十题）、`live-72h-final/`（七题）、`live-72h-bounded-18/`（九题）。最早两次尝试存在地区跳转、动态正文及元数据选择问题，仅保留诊断，未计为最终成功。最终核验见下节及机器清单。

## 最终真实结果

截至 `2026-10-21T10:19:30.051Z`：9项订阅，28篇不同文章、30次原文观察（含2次已知正文变化后的新获取）；底层27个活动事件、2个归并退休事件。17份候选通过原生证据/预览准备核验，最终近72小时快照 **complete / 严格10题**。

快照 `df93fffe-e11f-49a4-9219-b70380cd5443`；指纹 `5ddbd0e0953772cc887a2803512d780428d437404504ed99e89f1cbb4c4e2ed0`。初始空库不足快照、所有原文/线索/事件修订、窗口过期及截图拒绝均保留；原始正文SHA、所选预览存在性与十个独立事件键已逐项断言。

最终诊断：退休2、未准备11、超窗6。它们不是删除计数。两次单次新获取仍未取得合格预览，未计为恢复成功。

| 序号 | 候选原文 | 原始发布时间（保持精度） |
|---|---|---|
| 1 | [Anthropic pitches AI safety bill that may block a model if 50+ people could be k](https://techcrunch.com/2026/10/20/anthropic-pitches-ai-safety-bill-that-may-block-a-model-if-50-people-could-be-killed/) | 2026-10-20T23:01:23.000Z |
| 2 | [OpenAI acquires startup Orchestra Bio⁠ to beef up its biotech business](https://techcrunch.com/2026/10/20/openai-acquires-startup-orchestra-bio%e2%81%a0-to-beef-up-its-biotech-business/) | 2026-10-20T20:35:10.000Z |
| 3 | [ChatGPT now lets you lock your chats](https://techcrunch.com/2026/10/20/chatgpt-now-lets-you-lock-your-chats/) | 2026-10-20T18:36:53.000Z |
| 4 | [Eric Schmidt reportedly owns about half as much of Anthropic as CEO Dario Amodei](https://techcrunch.com/2026/10/20/eric-schmidt-reportedly-owns-about-half-as-much-of-anthropic-as-ceo-dario-amodei/) | 2026-10-20T17:55:12.000Z |
| 5 | [Meta’s Muse hits 10M US downloads in 40 days, a milestone reached by only 11 oth](https://techcrunch.com/2026/10/20/metas-muse-hits-10m-u-s-downloads-in-40-days-a-milestone-reached-by-only-11-other-apps/) | 2026-10-20T17:12:48.000Z |
| 6 | [Ex-Nvidia-turned-VC Amulya Vishwanath: ‘Physical AI is in its LEGO era’](https://techcrunch.com/2026/10/20/ex-nvidia-turned-vc-amulya-vishwanath-physical-ai-is-in-its-lego-era/) | 2026-10-20T16:20:06.000Z |
| 7 | [Figma co-founder Dylan Field thinks MCP is not a perfect protocol](https://techcrunch.com/2026/10/20/figma-co-founder-dylan-field-thinks-mcp-is-not-a-perfect-protocol/) | 2026-10-20T14:13:32.000Z |
| 8 | [US orders federal agencies to remove China’s DeepSeek AI from their systems](https://techcrunch.com/2026/10/20/us-orders-federal-agencies-to-remove-chinas-deepseek-ai-from-their-systems/) | 2026-10-20T13:07:24.000Z |
| 9 | [GTC Berlin 2026: Live Updates From NVIDIA CEO Jensen Huang’s Keynote](https://blogs.nvidia.com/blog/gtc-berlin-2026-keynote/) | 2026-10-21 |
| 10 | [Nscale and Anthropic are reportedly in talks for yet another $45B compute deal](https://techcrunch.com/2026/10/19/nscale-and-anthropic-are-reportedly-in-talks-for-yet-another-45-billion-compute-deal/) | 2026-10-19T23:39:38.000Z |

最终十题为9项TechCrunch报道、1项NVIDIA原文；没有把这次技术验证当作多地区、学术、人物或来源比例的编辑质量验收。目录扩大了可选入口，真实覆盖仍需后续按已选方向持续运行观察。

X公开账号可保存当时可见资料和指标，趋势/实时搜索跳转到登录；YouTube频道/搜索未得到可用正文。社媒五项订阅均未推进游标。没有取得真实X趋势榜、原帖热度增长或YouTube热点视频的完整成功证据。

机器摘要：[AI_NEWS_REAL_SOURCES.json](AI_NEWS_REAL_SOURCES.json)。本机完整结果：[result.json](../../.bmw-runtime/ai-news-real/live-72h-verified/result.json)、[冻结快照](../../.bmw-runtime/ai-news-real/live-72h-verified/recommendation-72h.json)、[访问与拒绝记录](../../.bmw-runtime/ai-news-real/live-72h-verified/observations.json)。

## 复现与证据范围

先构建；在仓库根目录为每次运行选择全新输出目录：

```sh
BMW_LIVE_NEWS=1 BMW_VALIDATION_DIR=.bmw-runtime/ai-news-real/new-run node scripts/run-electron-script.js scripts/ai-news-live-validation.js
```

脚本为开发侧显式opt-in外网验证，不是模型工具或周期调度入口。窗口固定72小时，不配置生产计划；账号受限时不绕过登录或接管用户工作区。

原文、获取、PNG、线索/事件/audit提交和快照保存在隔离Project；`observations.json`记录访问及拒绝原因，`result.json`和`build-receipt.json`绑定结果与源码。`.bmw-runtime`被Git忽略，换机需单独保存；仓库内机器摘要仅保留身份、URL、时间和SHA，不复制完整媒体正文。

技术回归与访问结果分开：114项离线分类通过、90项范围外/opt-in未运行；18项隔离原生回归通过。包括固定来源GUI、调度/后台用户让行与unknown恢复、推荐/选题、旧素材/批次、Studio草稿与导出采用关系、DSH、桌面、媒体、视频及Qwen HTTP旁白夹具。未验证付费模型、在线TTS、生产Profile、人工音画接受或长期无人值守运行。具体源码范围见 [VERIFICATION](../VERIFICATION.md)。
