# BMW 存储分层与资产沉淀策略

> 定位：规范新闻采制项目在 **代码仓库、成品归档、临时运行态** 三层之间的边界，避免本地缓存与大体积原始录屏挤爆磁盘，同时让信源规则、成品档案、制片模板与常青素材随项目运转持续复利。

## 一、三层存储模型

| 层级 | 目录位置 | 生命周期 | 核心内容 | 同步与清理规则 |
|---|---|---|---|---|
| **Tier 1：代码与规范** | Git 仓库内（`packages/`、`apps/`、`scripts/`、`docs/`） | 永久版本控制 | 源码、Schema、视觉与动效模板、信源图谱与防踩坑规则、采编与审片规范（[NEWS_DAILY.md](NEWS_DAILY.md)、[prompts-and-presets/](prompts-and-presets/README.md)、`packages/harness-*/SKILL.md`）、本文档 | **进 Git 同步**；严禁提交密钥、Cookie、个人绝对路径、大体积媒体或运行缓存 |
| **Tier 2：成品与常青归档** | 独立归档目录 `../BMW-local-archive/`（与运行时目录同级、解耦） | 长期冷存 / 跨机复用 | `deliverables/YYYY-MM/<topic-slug>/` 单期成品包与配方；`evergreen/` 高频人物头像、带元数据的干净实拍 B-Roll 与核验原声金句 | 通过 `rsync` / NAS / 网盘按需归档同步，不进 Git |
| **Tier 3：临时运行态** | `.bmw-runtime/`、`outputs/`、`node_modules/` | 短期可再生 | 浏览器 Profile / Cache / Partitions、Agent CLI 缓存与本机登录态、原始长录屏、HLS 中间分片、TTS 音频缓存、渲染中间帧 | 不跨机硬拷 `test-profile`；项目交付并完成 Tier 2 归档后，按 **7–14 天宽限期**清理；项目级中间文件由 `packages/feature-video/src/artifact-gc.ts` 自动回收（不破坏草稿导出历史与 `library/exports` 独立账本）。可重建模型权重（如 `.bmw-runtime/local-asr/`、本地 TTS）视为可重建缓存，迁移时按需同步或用脚本重装校验 |

---

## 二、五类长期复利资产

1. **信源图谱与采集规则**：官方频道与同名账号区分、各站点稳定抓取与广告/追踪像素过滤策略、采编硬规范（时效窗口、实拍/CG/第三方 AI/自生成界定、`素材来源：` 署名规范）。
2. **可审计单期成品归档包**：即使几十 GB 的原始录屏和渲染中间帧被清理，每条已发布视频的事实依据、字幕文本、引用来源与制片配方仍完整可追溯。
3. **高频人物与机构的常青素材库（`evergreen/`）**：不囤积整场 1–2 小时录屏，而是抽取出经核验的 10–30 秒干净实拍/访谈金句与人物头像，补齐人物、机构、录制/发布日期、出处链接与逐字稿元数据，供后续对比或综述专题直接复用。
4. **经过验证的视觉模板与制片流水线**：单期专题验证成熟的排版、动效原语、分镜脚本与响度/字幕规格，应及时抽离沉淀进 Tier 1 主仓库（如 `kinetic-primitives`、`compact-news-layout`），避免长期散落在一次性 `.bmw-runtime/` 工作目录中。
5. **审片纠偏与编辑部记忆**：每次人工审片发现的问题，硬约束写进源码预检 / Schema / `video-review-policy`，软规范沉淀到 [NEWS_DAILY.md](NEWS_DAILY.md)、`SKILL.md` 或项目 `MEMORY.md`，保证换机或切换模型后出片下限不退化。

---

## 三、单期新闻 / 专题收工归档 SOP（6 件套）

每期节目确认交付后，在 `../BMW-local-archive/deliverables/YYYY-MM/<topic-slug>/` 归档标准 **6 件套**：

1. **成品视频与封面**：最终导出 `.mp4`（含同主题多版如浅色/暗色/分屏）与 `cover*.png`
2. **脚本与信源文档**：`SCRIPT_AND_SOURCES.md`（中英双语脚本、原声节选、原始链接、录制/发布日期）
3. **时间轴字幕**：`subtitles.srt`、`subtitles.vtt`（便于二次剪辑、转图文或检索）
4. **溯源与引用清单**：`citations.json`（或同级来源映射，记录各镜头对应原片、SHA-256、时间标注与素材属性）
5. **制片配方快照**：`recipe/`（分镜脚本、素材 manifest、URL 清单与合成脚本等可复现参数）
6. **审片质检记录**：`verification-summary.json`（技术检查与人工审片记录；已归档关键帧/图表可按需一并留存）

确认 Tier 2 归档完整后，即可安全清理 `.bmw-runtime/<topic-slug>/` 下的 `userdata/`、`qwen-*cache/`、`inspect/`、`audio-built/`、`raw/` 等临时大目录，以及 `outputs/` 中超过宽限期的本地副本。

---

## 四、跨机器迁移与新机接管原则

1. **代码与文档**：新机通过 Git 拉取 `main`，执行 `npm ci` 重建平台原生依赖（不跨机拷贝 `node_modules/`）。
2. **基线验证**：在目标机串行执行（避免并发构建互相清理产物）：
   ```bash
   npm run build && npm run check && npm test
   ```
3. **运行态隔离**：**不跨机迁移 `test-profile/`、浏览器 `Partitions/` 缓存或 `agent-drivers/` 凭据目录**。目标机上的 Electron 浏览器站点登录态与 Agent CLI（DSH / Codex / Qoder / WorkBuddy / Qwen TTS 等）均在目标机重新登录授权。
4. **模型与归档同步**：`../BMW-local-archive/` 按需通过 `rsync` 同步；可重建模型权重（如 `.bmw-runtime/local-asr/`）可校验式 `rsync` 迁移，或在目标机运行安装脚本（如 `install-local-asr.ts`、`npm run setup:local-tts`）重装并核验 SHA-256。
