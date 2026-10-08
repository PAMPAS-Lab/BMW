卡片拖动提供明确的前/后插入位置及边缘自动滚动，只在松开时沿原 CAS 保存，可撤销。未保存输入先正常保存；保存期间已松手或取消，不延续拖动。同版本预览和任务刷新保留手势及标记；Project、Session、草稿/revision、模式变化，以及 Esc、区外松手、指针取消、失焦和缩放取消。镜头身份、旁白、字幕、图层及旧成片保留；不新增按钮，原菜单调序继续可用。

用户当前决定：本轮暂不加入专用 AI 图片／视频素材生成；素材准备继续使用 Project 文件及现有网页采集、截屏、录屏能力。

# BMW current handoff

可选测试版审阅支持字幕样式与原文/译文/双语显示建议，使用有限结构化 before/after（null 表示未设置）和已有样式契约。建议保存不改画面；用户逐条采纳/忽略/撤销，保留字幕内容、时间、来源和实测旁白。字段或定位时间变化时拒绝覆盖；未设置字段撤销后恢复未设置。前后对照用可读样式标签，不新增常驻按钮或模型工具；实际画面依据与建议质量仍需人工核对。

自动打开高级 Assistant 时，若正常 320px 高度的四角都遮挡所选对象，尝试使用最大可放置的 240–320px 高度，保留输入和发送区并避开播放控制；已选高度随此 Session 的打开浮框保留，选择变化不跳动。用户拖放保留位置与高度；未手动摆放的浮框明确重新打开时重新计算。该高度由原生 Host 内部布局回传，不新增用户/模型参数或编辑草稿数据。

素材准备提供同一全片任务入口“让助手准备素材”，在目标与素材及高级素材资源区复用。允许零分镜草稿；提交前保存当前输入并捕获 Project/Session/草稿，阻止重复提交和同一 Assistant 忙时提交，沿用原归属及 expectedRevision 检查。任务只复用/采集真实 Project 文件并合并 preparation，实际列表随后台更新，不自行更换画面、创建镜头或制作成片；专用 AI 图像/视频生成服务仍未接入，不把任务已提交当作完成。

高级画面与独立图层提供默认折叠的“颜色与模糊”：亮度 0.25–2、对比度/饱和度 0–2、模糊 0–12 输出像素。使用封闭数值 effects，按固定顺序绘制，不接收 CSS、URL 或脚本。主画面仅处理素材，不改变标题、字幕和聚焦标记；独立对象仅处理其自身。可明确清除效果；修剪、分割与卡片往返保留参数，沿用原保存、CAS、锁定、撤销和共享预览/原生导出。

主旁白提供“静音此镜头全部旁白”，独立于 voiceVolume，保留原音量、实测音频、voiceTiming/voiceSegments 和字幕。旁白片段共享镜头静音状态，界面明确作用范围，时间轴文字标识静音。视频画面属性提供“静音此画面片段原声”，沿用 keepSourceAudio，不改源区间、sourceVolume 或原声字幕绑定。两者复用保存、CAS、撤销和预览/原生导出；静音或零音量旁白不触发背景音自动避让。普通 Agent 更新省略 voiceMuted 时保留当前值，显式 false 可取消静音，带 undefined 的 GUI 历史快照可清除此字段。无旁白时控件禁用，图片不提供原声控制。

Browser is boundary, media is native, web is runtime.

## Current implementation

独立图层和音轨的时间轴行提供一个对象菜单（亦支持右键与 Shift+F10）：编辑属性、锁定/解除锁定、隐藏画面或静音/取消静音。使用已有 locked/hidden/muted 字段和原 CAS/撤销/预览/导出，不新增副本或工具。菜单捕获所属草稿、会话与 revision；版本、模式或归属变化关闭菜单，过期点击拒绝。锁定对象的可修改参数、删除、动画及分割呈禁用，仍可解锁、隐藏或静音；锁定沿用既有编辑保护，不作为宿主权限。菜单键盘导航和 Esc 返回触发点；滚动/缩放窗口关闭菜单，避免悬在错误轨道。

高级编辑的画布与时间轴之间提供可聚焦分隔条：默认约占可用编辑区 34%，拖动或上下方向键调整，Home/End 到最小/最大，Esc、指针取消或窗口失焦恢复本次拖动前高度。边界保留至少 220px 上半编辑区；轨道在时间轴内滚动。按 Project/Session/草稿保存当前 View 的比例偏好，往返保留，窄窗仅限幅，不改视频数据、revision 或撤销历史。布局变化同步原生 Assistant 避让区域及响应抽屉。

The simple Studio now transitions a clean zero-scene draft into canonical cards when owned background scenes arrive; pending brief input blocks adoption until explicit reload. Optional outline and complete affected-narration names use collapsed disclosures. Portrait preview fits its fixed area with visible transport. Seven actual entry/delivery states across five widths and a native portrait MP4 are recorded in workflow-entry-manifest.json; paid Agent and foreground user acceptance remain separate.

Studio card and advanced views now share the reduced original toolbar and one More menu for low-frequency draft/settings/recovery controls. Advanced-content cards provide one contextual entry; per-owned-draft card scroll and long-intent expansion survive mode roundtrips. Existing save/CAS, undo, media and Assistant ownership remain the same; full original workflow acceptance remains tracked in the Studio plan.

BMW is the sole app in this checkout: id `bmw`, Profile `BMW`, partition `persist:bmw`. `apps/bmw/product.ts` composes `product-bmw` and the official driver assembly. `scripts/product-entry.ts` injects createBmwAgentAssembly, the owned Assistant and three independent backends. Protected incremental source integration preserves existing uncommitted work, the Git index and HEAD. The unified Agent/v2-data offline report is `.bmw-runtime/classified-tests/2026-10-05-agent-data/result.json`; consult its actual statuses and source hashes. Earlier GPT-6 and 32-check login-flow snapshots remain historical evidence; real-model runs are separately scoped. Current state is indexed in [PROJECT_STATUS.md](docs/PROJECT_STATUS.md); see [implementation evidence](docs/AGENT_DRIVERS_IMPLEMENTATION.md).

Codex GPT-6.1 Sol, GPT-6 Astra, GPT-6 Sol and GPT-6 Luna now use a host-owned projection of the official startup model catalog with direct browser calls, preserving native model identity, transport and capabilities. All four passed effective single-tool admission and two real screenshot/Studio/resume turns; GPT-5.5 passed the same regression. See the model evidence and the GPT-6 full offline snapshot in [implementation evidence](docs/AGENT_DRIVERS_IMPLEMENTATION.md). Codex App Server 0.160.0 and 0.160.1 share an explicit verified-version allowlist for CLI and model caches; unsupported CLI errors identify the detected and supported versions. Unknown models/versions still fail closed; BMW owns no additional Agent loop.

Settings now retain a Profile-local, per-driver display cache across Project selection. Opening settings cold-loads only a driver never attempted in this process; completed/failed views and switching back reuse their projection, with no native polling. Authentication ages at five minutes and models at thirty; timestamps and pending-check labels do not admit a real task. Both explicit refresh entries currently use the official combined snapshot and timestamp only after cleanup. Authentication/model mutations invalidate old readiness before dispatch; partial failure/cancellation cannot restore it. Model preference or driver baseline changes discard the entry; failed native tasks conservatively mark its freshness pending without refresh/replay. External account/config changes require explicit refresh or actual runtime checks; cache is not persistent. Pending native reads still coalesce, mutations stay exclusive, cancellation awaits actual cleanup and quarantine is preserved. Supported model selection remains independent of inference, and effective single-browser admission still runs before actual input.

`agent-contract` owns the provider-neutral AgentBackend lifecycle, event/settings and BMW context contracts. Each harness owns its official runtime, authentication, protocol and catalog admission. DSH, Codex App Server and Qoder CN SDK each own their native loop; BMW Host owns canonical Sessions, durable input receipts, settings exclusion and actual cleanup. Core packages do not import concrete harnesses or know their wire/DOM/storage format.

Projects persist BMW identity, documents and page state only. Conversations own Project/driver membership and native resume anchors; display histories carry the same generic owner. DSH alone maintains `dsh-home/bmw-project-bindings.json`. Agent data files use v2 and the migration commit marker; normal startup refuses old files. The explicit migration CLI exports cold native history from a disposable DSH Home, retains old BMW Session IDs, backs up affected metadata, guards concurrent changes and preserves Studio/media bytes. See [AGENT_DATA_MIGRATION.md](docs/AGENT_DATA_MIGRATION.md); migration is never a background Host task.

`browser-capability` owns the single browser model tool, authenticated catalog, Project/Session operations, FIFO, transitions and image admission. Page viewport emulation preserves the native workspace surface; oversized capture layouts cannot resize it into the Assistant sidebar. `media-native` owns browser-based capture, Mediabunny/WebCodecs processing, narration and composition. `feature-video` owns Project drafts and integrated Studio.

Studio adds a shared whole-film checklist and measured read-only `check`, plus resumable sequential `narrate-pending` with per-scene revision commits, cancellation and online-TTS policy. Export uses the same measured gate; invalid source starts block even with hold, and regenerated/imported speech preserves independent caption endpoints. Image readiness now decodes static PNG/JPEG/WebP with shared byte/pixel budgets before export. Studio supports Project SRT/VTT (edited/estimated timing), up to eight visual segments per scene with cut/fade and continuous voice/captions, existing-session script/material Assistant intents, encoder preflight and durable JSON export verification. Local word alignment remains deferred: the installed Matcha cache provides synthesis only. Native media now has a host-only fixed whisper.cpp 1.9.1 ASR evidence port, actual browser PCM normalization and process-drained cancellation; Studio now exposes bounded align-speech/read-speech/correct-speech operations through browser, with host-owned script/audio hashes and trusted user/Agent edit provenance. Original ASR candidates never overwrite edited anchors or become approved automatic timing. The voice inspector offers actual listening, blank sentence boundaries and correction; preview/native MP4/SRT/VTT share the voice .5s offset and cumulative mapping, with a separate Project provenance receipt. Independent edited captions remain. File/script/TTS changes fail closed before consumption and audio hashes are rechecked after encoding. Ten Matcha clips with base/small outputs and a separate human-reference annotation page are available as validation evidence; Shared sentence references now drive editable focus and title-card bullet reveal through one projection, with target-identity checks, source trim/rate mapping, independent-focus conflict rejection, undo and Project provenance receipts. The user has listened to and explicitly adopted the ten-clip Whisper base annotation: twelve editable segment anchors retain original ASR text/time/warnings, with only out-of-audio tails bounded to actual duration. These ASR-assisted listening records are not independent acoustic gold; automatic sentence/word approval remains false. Actual ten-scene caption/board MP4, SRT/VTT provenance and render reuse are verified in bmw-p0/base-adoption. Studio supports preparation materials, global/scene scripts, narration, footage matching, thumbnails grouped by scene usage, drag replacement, timeline selection, shared context, editable captions and native export. Settings provide named video/TTS templates. Default speech is Edge Yunxi male, with online narration enabled. Generated audio records its actual provider, voice and rate; script or generation-parameter changes mark it stale and block export until regeneration. Imports are labeled as imports. Legacy audio is retained and labeled parameters unrecorded. Captions and visuals do not invalidate narration.

Studio drafts now require immutable ownerSessionId from the authenticated Bridge or selected Studio view. Session changes flush edits and switch to isolated draft lists/selections, with an empty state when no draft exists. Foreign/legacy unbound drafts fail closed; migration is an explicit profile repair. Delete uses revision admission, moves the JSON record into a recoverable deleted directory, and preserves all Project assets/exports. Assistant intents route to the owning Session.

Visual material choices share bounded image/video thumbnails, full preview and list/icon views across preparation, matching, workbench, cover and segments. Delivery opens existing MP4s directly; render reuses only a host-recorded matching composition/file fingerprint, while forceRender explicitly remakes. Cover/notes edits do not invalidate video; changed content/files do. Legacy outputs remain manually viewable and downloadable.

Studio editing uses a canvas workbench with a Project media sidebar, contextual visual/voice/caption inspector with dedicated upper cover/delivery entry buttons, persistent transport and sequential-content timeline. Selection and seek follow the current scene; cover PNGs have an independent central preview. Global settings/templates live in a dialog, cover/delivery open from their upper entry buttons and delivery highlights only while active, delivery consolidates existing outputs and checks, and media job state stays separate from saving. Focused input is flushed before changing mode or selection; existing revision/history boundaries remain in force.

Studio also exports independent Project PNG covers from images, actual video frames or text, with saved title/subtitle/layout/color options, protected revision history, preview/download and cancellation/conflict rollback. Zero-scene drafts can make covers.

Assistant can inspect, annotate and draw Project images through `media.image.inspect`, `media.image.annotate` and `media.image.draw` on the sole browser tool. Fixed Canvas boxes/ellipses/arrows/lines/paths/text/opaque redaction use real pixel coordinates and bounded budgets. Outputs are new Project PNGs with actual decode verification and model image return; originals remain unchanged. Worker cancellation and post-finalization verification failure remove only current outputs. No HTML/SVG/code or arbitrary file/network surface is added.

The fixed Shell disables background throttling so native workspace coverage does not suspend its viewport/layout updates. Existing desktop settings checks retain dark/light, dialog fitting and compact-window assertions. Native focus and capture assertions remain enabled; a locked Mac cannot establish foreground desktop acceptance.

Existing corrupt/unreadable Project, global settings, scheduled-task, permission, layout and login-continuity state and encrypted snapshots raises a preserved-state startup error with retry/exit. Only a genuinely missing file initializes. Failed login reads/decryption block background writes until explicit repair/reload; encryption becoming available requires reading and restoring the saved snapshot before capture. All Shell invokes use one main-process sender/main-frame/local-URL gate; Shell navigation/popups are blocked. Startup and first Project activation restore all saved tabs plus the active page without persisting a partial set. Renderer observations/media discovery/diagnostics have bounded phases and cancellation; media discovery never scrolls or waits for animation frames. Download cancellation drains the network/file pipeline before rollback and FIFO release.

## Video Studio 当前增强

预览更新保持全片时间；未知时长为待测量，实测检查只读。交付面板增加文字警告和当前版本关键帧。共享 Canvas 排版保留全部文字，无法容纳时阻止预览/导出。

视频原声音轨可固定 Whisper base/small 识别、试听校正、按剪裁/速度映射成独立字幕；原文/译文共用时间，三种显示模式同步到 MP4/SRT/VTT，重译跳过人工译文。同一素材的源时间变化在宿主核对范围内重新映射；源 SHA/身份变化或超出核对范围需重应用或解除。三点总结、两项对比和截图解读为封闭数据模板。所有命令仍通过一个 browser 工具与原有 owner/CAS/FIFO；ASR 完整音轨上限 180 秒，没有长片分块或自动词级时间。

现行详细契约和验收项见 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md) 与 [VIDEO_STUDIO_NEXT.md](docs/VIDEO_STUDIO_NEXT.md)。历史 review 与 P0 文档保留原文，不作为本期完成证明。

Studio defaults to canonical scene-card script editing beside preview, with reusable material/property details and validated reorder/duplicate/delete/undo. Opt-in advanced editing fills the application window; the same Assistant automatically becomes a bounded 320px small float after workspace measurement and can collapse to a status capsule on large windows, with explicit property-area docking and temporary compact-window docking and preserved conversation/input/sidebar geometry. Composer targets pin at first typing and are owner-validated/frozen into Host FIFO and the official DSH context. One contextual delivery entry previews affected scenes, updates only pending narration and renders a playable MP4 after confirmation; cancellation/failure retains committed narration and old outputs. Cancellation now visibly waits for cleanup with admission held; five isolated native failure/cancel/CAS cases verify explicit selective resume, edited caption retention, immutable old MP4 bytes and rollback of uncommitted encoded outputs. These fixtures do not prove paid TTS or foreground acceptance. Owned background notifications now serialize state snapshots. Journal-only revisions preserve prepared preview, playhead, object selection and undo; dirty input retains its captured CAS and focus, while clean content changes prepare automatically and new valid simple-mode MP4s appear centrally without autoplay. Finite independent visual/audio tracks and basic main sequence/voice/caption timing are writable and share preview/export; finite whole-scene splitting now partitions unbound visuals, voice playback, bilingual captions and local objects in one host/GUI transaction, with source AAC continuity and signed undo/redo; whole-scene speech/source bindings now retain original sentence/focus/reveal clocks and reviewed root cues, including actual GUI/MP4 continuity; remaining arbitrary complex clock rebinding, broader effects, finite sampled reference analysis now prepares actual SHA-bound Project PNGs, returns model images through the sole browser, routes the same Assistant and supports explicit preparation-note adoption/undo with native cancel/CAS recovery; reference quota/history management supports explicit user-only removal and current-record reread; actual generated media and broader review types remain unfinished; optional finite script-review proposals now persist with actual GUI locate/adopt/dismiss/selective undo, guarded fields and retained old MP4/voice/captions. Responsive resource/property drawers reuse canonical forms, the same Assistant moves continuously and pins gesture/control owners, and advanced native windows can reach compact layout. Host-approved history now preserves exact trusted speech/source metadata through actual scene deletion and repeated undo/redo, retains the current export journal and CAS, and rejects modified/foreign/expired proofs. Unsegmented visuals no longer borrow scene identity; ordinary updates cannot adopt an anonymous replacement for a deleted clip. Stop closes admission before pending artifact inputs, preventing late reads from reopening them. Current acceptance and remaining full scope are recorded in FUNCTIONAL_SPEC and VERIFICATION.

## Working rules and commands

Read [AGENTS.md](AGENTS.md) and [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md). Keep one browser tool and no additional Agent loop. Test only disposable profiles. Build commands clean outputs and must run sequentially.

日常局部修改先使用改动文件范围；有既有未提交工作时，请提供本次实际变更文件列表。完整基线只在需要时显式执行。

```bash
npm run test:plan -- --files packages/feature-video/src/studio-service.ts
npm run test:affected -- --files packages/feature-video/src/studio-service.ts
# Explicit full offline baseline:
npm run verify:stability
# Individual commands below rebuild; run sequentially.
GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1 npm run build
npm run check
npm test
npm run test:boundaries
npm run test:driver-e2e
npm run test:dsh-e2e
npm run test:desktop-e2e
npm run test:studio-e2e
npm run test:media-e2e
npm run test:video-e2e
npm run test:tts-e2e
npm run docs:features
```

Checks and evidence: [VERIFICATION.md](docs/VERIFICATION.md). Full current feature/test inventory: [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md).

## Environment and limits

The serial stability baseline verifies fresh build/typecheck, all classified unit/contracts/boundaries, startup retry/exit for protected stores, neutral Driver/MCP plus all Shell invoke rejections, real DSH, Studio, background pages, capture, processing, export and local narration. Desktop groups report independently, with a separate Project restart and real native focus/keyboard assertions. The accepted hash baseline points to the latest complete report in `.bmw-runtime/classified-tests/`; earlier evidence is retained.

The existing uncommitted workspace is preserved. The closure delivery includes the pre-change authored snapshot, initial hashes, changes and final source manifest; it does not require resetting or committing user work.

The Shell runtime badge is published from the owned Assistant state and reflects idle, active and disconnected resources independently of the provider.

The explicitly authorized real Profile migration is complete: 10 Projects, all 28 existing Sessions retained plus 4 native imports, 9 drafts, 38 metadata changes, no warnings. The backup manifest and preservation audit pass; all 848 Project files and 1,135 native DSH Home files are unchanged except the new harness mapping. Repeated planning reports alreadyCurrent with zero changes. Evidence is under `.bmw-runtime/agent-data-closure/2026-10-05/`; paid inference and production-keychain acceptance are separate. Production macOS keychain authorization and real-profile desktop acceptance remain manual. Automated checks use an isolated mock keychain and do not prove the production authorization path.

No general NLE, arbitrary HTML import, chat connectors, remote/mobile client, signed installer or updater is implemented. Local TTS requires its pinned model cache; Edge depends on a fixed external service. Paid visual-model tests are explicit opt-in and are separate from runtime regression tests.

## Module interfaces and affected verification

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for owned modules, public entries, allowed runtime/type dependencies, interface guarantees and the categorized test catalog. Feature lifecycle, Browser Feature host and NativeMedia ports use named contracts with runtime admission and positive/negative compile consumers. Core/harness separation and renderer privileges are checked using real TypeScript syntax.

Use `npm run test:plan -- --files <repository-relative-path>` then `npm run test:affected -- --files <path>`. Default affected compares against the last full passing hash baseline; unknown/deleted/shared configuration changes fall back to full offline coverage. Unclassified tests or missing guarantors fail closed. `npm run verify:stability` runs all offline categories and updates the baseline only on success. New reports live under `.bmw-runtime/classified-tests/`; earlier evidence remains.

Direct Browser and AgentDriver guarantees use the neutral driver fixture, including actual MCP tool discovery, Project page operations and identity/permission/switch recovery. Installed DSH runtime and explicit migration export are listed separately as `bmw-dsh-assembly`. Browser model schema/catalog/Bridge/MCP-only changes select the neutral connection test; generic Agent contracts, DSH implementation, BMW assembly or full validation retain DSH coverage. The abstract contracts do not import the concrete driver.

Shared validation helper changes automatically select dependent runtime checks. Production-to-test imports/public exports and bare Node renderer imports are rejected. Production computed imports are forbidden except the declared fixed installed DSH package resolver; Browser protocol edits still do not acquire a DSH test dependency.

## Studio focus deletion recovery

Focus edits can remove a locally added interval after its save is rejected without first retrying the rejected draft. Removing an interval discards pending input for that interval and retains other edits and CAS checks. Studio runtime regression covers last-interval deletion, rejected-save recovery with focused input, and deletion undo/redo. Running BMW must be restarted after rebuilding so its main process and newly loaded Studio renderer share the same contract.

Direct video compositions from an authenticated BMW Session now register a new editable Studio draft and completed MP4 without changing existing drafts. Audio is retained as imported with measured durations; Studio notifies the owning Session view. Direct bullet reveal times remain standalone with an explicit warning because the Studio speech-anchor model cannot preserve them losslessly. Host calls without a Session remain standalone. The Qoder CN three-scene production output has been recovered from its admitted completed receipt, without encoding again.

Bounded local/global media layers and independent audio share Studio preview/native MP4 rendering with actual Project/source-window admission. Native regression verifies animated rectangle, video PiP, global image/text, independent audio, narration ducking and H.264/AAC parity. Independent object properties/resources and timeline move/trim/split/zoom are now integrated into the real Studio draft/CAS/undo/preview path. Remaining full-design work includes canvas transforms, legacy main-track writes, exact arbitrary eased cuts, object-ID Assistant targets, workflow/delivery polish and reference/generation/method integrations; the full UI goal is not complete.

Video Studio 的独立对象现在支持画布移动/缩放，保持动画和时间、单手势保存/撤销；拖动边框为 GUI 覆盖层，实际像素通过同一媒体绘制器实时更新，松手才保存；取消或模式切换排空临时绘制并恢复原画面。空白画布复用全片参数控件，分组展开并支持模式切换前保存、撤销和冲突保留输入。高级模式低频操作收进“更多”，原控件移动而不复制。实际助手停靠验收需等待 Renderer 渲染后比较最新 DOM/Native 边界，不能用布局尚未渲染的尺寸断言；计时器测量和原生 View 直接重排已接入。独立对象的 layer ID 请求范围、快捷委托输入保护已经接入；高级助手默认小浮框并保留属性区，显式停靠与窄窗临时停靠共用原 WebContents。完整高级编辑、主轨写入、响应抽屉与逐项审阅仍未完成。

主轨直接操作已接入真实 Studio：镜头调序/顺移时长、画面片段修剪、旁白显式播放区间/速度、字幕移动/修剪/双语分割。主轨索引与 revision 一起捕获，沿用 CAS、撤销和同一预览/导出。原音频 audioDurationSeconds 与句锚点原秒数/哈希不改写，voiceTiming 单独描述播放。输入保护包含主轨属性；明确 reload 清除这些待编辑值。整镜头内容分割、剩余复杂引用重绑定以及其余十项完整目标仍待后续完成；不能把该基础实现声称为完整多轨编辑器。

预览草稿切换重置旧画面和时间，准备/释放串行并等待实际资源加载排空；过时准备明确返回未就绪。隔离 Renderer 回归覆盖延迟加载期间连续准备/取消、下一次准备成功及 24 镜头切换后的旧像素清理。此项修复不代表十项完整设计已完成。

缓动动画以闭合 easingRange 保存原曲线区间，任意位置修剪/分割及播放头插点保留关键帧运动和透明度；十二点切割保留预算，新增点超预算拒绝。独立图层/音轨分割和修剪保留原淡入淡出时钟，原秒数只读并提供明确的当前片段重设/撤销；连续 AAC 源切片保持一次解码。90 项专项与实际 GUI/AAC/MP4 验证通过，当前分类 unit/contract/boundary 80 项通过；完整 Studio 前台焦点与其余有限效果、整镜头分割、复杂引用、参考生成及逐项审阅仍待完成。验收以 VERIFICATION 的独立证据范围为准。

旁白主轨现在支持稳定 ID 的有限播放片段，按播放头分割并独立移动／修剪／调速；原文件、实测时长和原句锚点不改写，连续切点保留字幕、句聚焦和配乐避让。主片段选择与播放头定位分离，时间轴标尺使用持久的原生 range 输入。精确旁白片段范围复用原 Assistant／Host；撤销删除片段时 GUI 选择校正，固定请求仍独立校验。实际验收和剩余全范围见 VERIFICATION 与 VIDEO_STUDIO_NEXT；不代表整镜头分割或通用 NLE 全部完成。

原声字幕以宿主核对的源 cue/范围及稳定片段身份随主画面修剪、调速和调序重新映射，保留人工译文、未播放的核对区间与同一撤销流程；原文件 SHA 与版本检查保持。旧可见范围的扩展、替换片段及含糊同时编辑仍需明确处理。整镜头分割和其余完整设计待办仍保留，验收范围见 VERIFICATION。主轨保存/恢复选择/真实预览使用同一事务，两次连续分割的 GUI 专项已通过；完整前台套件仍在锁屏时的焦点前提失败，保留原断言，解锁后重跑。

主画面片段现在使用已有稳定 ID 形成精确 Assistant 范围，原 composer 输入时固定，主轨调序后按 ID 重新解析选择，删除则清除 GUI live 范围并在发送时拒绝旧请求。旧单画面未持久化片段 ID 时保持镜头画面范围；不为选中动作写草稿。新增契约与真实原生范围验收以 VERIFICATION 为准，其余完整设计待办继续保留。

Studio 恢复通知现在按实际暂停的缓存 View 发出：同 Project／Session 从浏览器返回也恢复素材读取，已经活动的 View 不重复重置。修正了同会话资源快照停留在旧数据的问题；原界面、版本与请求归属保持。最新精确旁白／主画面 Host 提交和完整原生几何验收结果见 VERIFICATION，其余完整设计仍待完成。

共享合成现有有限原始镜头时钟，延续标题／要点／编号／进度／配乐；明确空 voiceSegments 为静音且保留原音频、人工字幕。原生回执分别验证实测源长度与播放窗口，避免短片段被错误拒绝。普通 Studio 更新不能伪造或重设宿主时钟。有限无绑定整镜头分割已接入宿主／时间轴事务，连续源 AAC、锁定动画／旁白／人工字幕、两轮历史与实际 MP4 连续性已验证；句引用／板书／原声字幕现以宿主原始播放／核对范围分配，支持真实时间轴连续切割和签名历史；其他复杂编辑恢复及完整设计待办仍未完成。验收以 VERIFICATION 的明确范围为准。

默认卡片内的画面/意图与原 canonical 脚本已配对，按实际卡片宽度左右/上下响应；24 个长中文镜头的实际组件五种宽度和 DOM 身份检查通过。当前分类回归 80 passed/51 not-run；完整新增 card-pair 原生 DOM/IPC/Canvas case 已在解锁后通过保存冲突、详情返回、模式往返、播放头和签名撤销；前台鼠标和用户验收仍保留。其余原十项设计继续按 VIDEO_STUDIO_NEXT 与 completion-audit 推进。

参考弹窗的记录管理默认折叠，支持同素材历史查看和可信用户逐份移除恢复八份额度；源/参考 PNG、已采用背景及规范内容保留，内容 Undo 不恢复移除日志。真实服务 104 项契约与实际组件/服务回调证据见 VERIFICATION；完整原生/用户与生成素材等原设计继续保留。
