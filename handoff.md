# BMW current handoff

Browser is boundary, media is native, web is runtime.

## Current implementation

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

视频原声音轨可固定 Whisper base/small 识别、试听校正、按剪裁/速度映射成独立字幕；原文/译文共用时间，三种显示模式同步到 MP4/SRT/VTT，重译跳过人工译文。源 SHA/时间变化使关联字幕失效，需重应用或解除。三点总结、两项对比和截图解读为封闭数据模板。所有命令仍通过一个 browser 工具与原有 owner/CAS/FIFO；ASR 完整音轨上限 180 秒，没有长片分块或自动词级时间。

现行详细契约和验收项见 [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md) 与 [VIDEO_STUDIO_NEXT.md](docs/VIDEO_STUDIO_NEXT.md)。历史 review 与 P0 文档保留原文，不作为本期完成证明。

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
