# 内容创作研究依据

整理日期：2026-10-17。以下保留 2026-10-16 对案例与固定版本外部资料的研究结论；本轮未重新访问外部站点、核验许可或执行外部项目。研究提供依据，不授予新能力或实施权限。待办设计见 [内容创作计划](../plans/CONTENT_CREATION.md)，当前代码核对见 [文档审计](DOCUMENTATION_AUDIT.md)。

AK（`@_akhaliq`）十条 X 视频的独立研究见 [AK_X_VIDEOS.md](AK_X_VIDEOS.md)，含固定原帖、逐条观察、抽样／音频边界及代码测试映射；对应技术增量见 [AK 视频计划](../plans/AK_VIDEO_CAPABILITIES.md)。

## 当前判断

BMW 已能通过官方 Codex + GPT-6.1-Sol、唯一 `browser` 工具完成公开资料收集、来源整理、真实媒体编排、本地中文旁白、MP4 导出和按当前指纹审帧。Simon Willison 鹈鹕案例留下两册研究报告、98 个记录组（不是 98 件去重作品），以及 178.368 秒 V1、152.064 秒 V2。V2 以反差开场，按鸟种、结构、运动关系递进，取消五张纯文字说明卡，加入 Fourier 的真实后段视角；V1 与两册报告保留。

用户反馈仍认为视频稿能力需要加强。V2 是一次具体重写，不足以证明 BMW 已具备稳定的叙事、节奏或创意判断能力；技术检查与 275 张关键帧 Agent 审阅也不认证故事吸引力、声音表现或用户满意度。当前直接模型核听仍未接通。

研究文字可保存在 Studio 准备资料和 Project 记忆中；本次可阅读 HTML、CSV 和交付页还包含开发侧对原生资料的导出整理，不能据此宣称 BMW 已有原生图文长篇产品。现有 Project 文档编辑也不等于具备长篇文章的编排、引用与成品导出工作流。

本机案例入口为 [V1 与研究报告](../../.bmw-runtime/simon-pelicans/index.html)、[V2 与重写稿](../../.bmw-runtime/simon-pelicans-v2/index.html)，适用范围见 [VERIFICATION.md](../VERIFICATION.md#simon-研究与叙事重剪)。这些运行产物被 Git 忽略，换机需单独保存。

## 调研来源与可采用结论

两篇文章提供产品与创作观察，仓库提供实现依据；本轮仅静态阅读，没有运行外部项目的制作链、核验其付费成本或验证示例的完整科学正确性。

| 来源与固定版本 | 值得吸收 | 必须保留的限定 |
|---|---|---|
| [Hypit 文章](https://mp.weixin.qq.com/s/uWJM2UQvlbYqmJ9pAn1t_Q)；源码 `dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0` | 创作内容与执行选择分开；语义区间驱动画面；明确复用已选产物；时间批注帮助持续修改 | 参考复刻仍依赖 Agent 的观察与创作；支持秒／帧与语义时间，不是完全没有时间戳；不证明一键理解任意视频 |
| [Anatomy 文章](https://mp.weixin.qq.com/s/VuJsVTvyNIK8GRTL95n-Qw)；源码 `e9488296a44211c42701ff71705b7901470ec78f` | 解释对象与变化关系；先确定模型，再派生运动与读数；检查中间态、手机效果与交互接管 | 核心交付是 SVG／HTML／React 图解，不是完整旁白与视频导出系统；精细图形、几何审计和自洽模型均不等于原理正确或初学者看懂 |

关键源码依据：

- Hypit 的 [编译与创作／执行图分离](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/packages/compiler/README.md)、[时间投影](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/packages/narrative-temporal/src/projection.ts)、[显式产物复用](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/docs/quickstart/run.md)。Hypit 没有隐式缓存；BMW 不需要取消现有确定性成片复用。
- Hypit 的 [Studio 评论](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/packages/studio/README.md)以 Run、秒数和文字定位，Agent 自动通知仍为规划；[语音定位](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/packages/narrative-speech-alignment/src/locate.ts)会插值补齐缺失时间，不能据此放开 BMW 自动词／字精度。
- Anatomy 的 [创作规则](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/SKILL.md)、[波纹状态与读数模型](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/examples/ripple-tank/model.mjs)、[运动规则](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/references/motion.md)、[验证规则](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/references/verify.md)。吸收状态同源、关键状态检查，不把密集零件、固定等距风格或禁止箭头／标签变成 BMW 通用要求。
- 复用代码前单独评估 [Hypit 附加限制许可证](https://github.com/hypit-ai/hypit/blob/dc2b7a8f31b1ef1443a79ca448548d69e3ceb6a0/LICENSE)与 [Anatomy MIT 许可证](https://github.com/wheresryan22/anatomy/blob/e9488296a44211c42701ff71705b7901470ec78f/LICENSE)。研究结论不构成嵌入授权；BMW 不依赖另一产品仓库的运行时代码，也不直接开放其本地脚本能力。

## 补收的创作证据

[创作案例](PRODUCTION_CASES.md)补充早期 Karpathy 四格式研究、Musk 九项问题的当前状态、博客卡片和多驱动比较限制；[交付账本](../history/local-deliveries/README.md)保留中间版本，不把技术指标替代用户理解评价。
