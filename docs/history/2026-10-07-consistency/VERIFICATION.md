# BMW verification

This document describes current verification boundaries. The authoritative capability/test inventory is [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md).

## Current evidence and scope (2026-10-05)

Current application state is indexed in [PROJECT_STATUS.md](PROJECT_STATUS.md). Reports below are immutable source snapshots; later affected checks do not turn an earlier complete report into a fresh full run.

| Evidence | Executed result | Scope |
|---|---|---|
| [Unified Agent data/offline report](../.bmw-runtime/classified-tests/2026-10-05-agent-data/result.json) | 109 selected offline checks and 5 gates passed; 5 external items not run | Strict v2 data, explicit migration, neutral Host/MCP and DSH cold export; desktop/restart, Studio, media, video and local narration; no paid inference |
| [GPT-6 full offline snapshot](../.bmw-runtime/classified-tests/2026-10-05-gpt6-browser/result.json) | 112 selected offline checks and 5 gates passed; 5 external items not run | The GPT-6 wrapper source at that run; includes DSH, owned/default Assistant, desktop, Studio, native media, video and local narration |
| [Login-flow affected report](../.bmw-runtime/classified-tests/2026-10-05-login-flow/result.json) and [integration audit](../.bmw-runtime/classified-tests/2026-10-05-login-flow/integration-audit.json) | 32 selected checks and 4 gates passed; remaining categories excluded by scope | Later authentication/dialog/supported-model changes; no full media rerun or paid inference |
| [Native model evidence](AGENT_DRIVERS_IMPLEMENTATION.md) | Two real turns for the recorded DSH/Qoder/Codex models and all four wrapped GPT-6 models plus GPT-5.5 | Disposable Profiles; screenshot pixels, canonical Studio owner and native Session recovery; Qoder paid coverage is auto only |
| [Whisper base adoption](#user-listened-whisper-base-adoption) | Ten actual clips, 12 editable anchors, MP4/SRT/VTT/board and reuse passed | User-listened ASR-assisted reference; independent acoustic gold/P95 not established, automatic timing not approved |

The current architecture catalog has 12 modules, 10 direct interfaces and 3 implementation/assembly guarantors. Feature/test and architecture inventories are generated from the current source. The unified Agent-data change runs a new full offline baseline after its isolated checks. Its report preserves the actual source hashes and failed attempts separately; historical GPT-6 and login reports remain unchanged. Paid model evidence is not rerun by this baseline.

## Unified Agent data and migration

`agent-data-migration` verifies retained BMW IDs/native anchors/history, archived native import, selected-session recovery, schedule driver inference, credential link detachment, backup/rollback and concurrent-change protection. Strict daily loaders and the Profile process lock are covered separately. The normal application cannot import the DSH migration entry. Shell and owned Assistant creation/archive now share the controller notification path, so Studio receives the same owner changes.

The explicitly authorized real Profile migration completed separately from automated regression: 10 Projects, 28 original BMW Sessions retained, 4 native DSH Sessions imported (32 total), 9 Studio drafts and 38 metadata writes, without warnings. The private backup is `~/Library/Application Support/BMW-agent-data-backup-1791209775488`; its manifest is complete and backup/output hashes match. The preservation audit confirms all 848 Project files and 1,135 native DSH Home files are byte-identical except the new harness mapping, with existing IDs, selections, resume anchors, display history, input receipts and model preferences retained. A repeated plan reports alreadyCurrent and zero changes. [Migration audit](../.bmw-runtime/agent-data-closure/2026-10-05/actual-profile-after-audit.json) and [result](../.bmw-runtime/agent-data-closure/2026-10-05/actual-migration-result.json) record this execution; they do not establish paid inference or production-keychain coverage. The offline report retains its original documentation hashes; only evidence documentation changed after that run. See [AGENT_DATA_MIGRATION.md](AGENT_DATA_MIGRATION.md). Normal desktop relaunch restored the original Project, Qoder CN selection, history and web page with the Assistant ready badge; its Studio correctly showed the current Session’s empty draft state, then returned to the browser. The post-launch preservation audit still matched original Session metadata, selections, preferences, history/receipts and all nine draft bytes. No model message was sent. Automated tests use disposable Profiles.

## Authentication and owned Assistant checks

`codex.settings`, `qoder.settings`, `dsh.settings` and `platform.agent-settings` exercise cold official control projections, missing authentication, unknown/disabled models, no model input, redaction, preference persistence after actual cleanup, cancellation and quarantine recovery. Codex selection asserts that the separate catalog gate is not invoked; its effective-tool gate still runs before actual input. Qoder cold control initialization still verifies its effective browser catalog and rejects any model work.

`assistant.application` uses an isolated Electron Profile and synthetic credentials to exercise GUI driver changes, automatic login dialogs, changing drivers during login only after native drain, clearing submitted/closed secrets, supported-only model display, confirmation/dialog close and blocked composer submission before model selection. The same fixture retains actual browser/screenshot/Studio ownership and shutdown checks. `assistant.default`, schedules and protected startup checks cover the declared downstream consumers. These fixtures do not establish real OAuth/key validity, production keychain behavior, account quota or paid inference for every supported model ID.

## Commands and coverage

| Command | Evidence |
|---|---|
| `npm run build` | Complete TypeScript compilation and fresh runtime output |
| `npm run check` | Typecheck, authored-source policy, generated feature inventory and architecture/interface classification |
| `npm test` | Domain, protocol, ownership, persistence, cancellation, media and Studio contracts |
| `npm run test:boundaries` | One app/tool, dependency direction and no chat control surface |
| `npm run test:driver-e2e` | Real BMW core with a neutral Agent driver and model-side MCP client; actual tool discovery, Project pages, authentication/permissions/bindings and Project-switch recovery; no DSH process |
| `npm run test:dsh-e2e` | Installed official DSH assembly, authentication, Workspace/Session lifecycle and transport |
| `npm run test:desktop-e2e` | Four independent disposable desktop groups: workspace, Project/Session with real restart, settings, native focus/keyboard; reports all groups even after failure |
| `npm run test:studio-e2e` | Draft edits, scene preview selection, material thumbnails/groups/drag, scripts, captions, playback, pending narration batches and measured readiness issue navigation |
| `npm run test:media-e2e` | Background page observation/screenshots, actual capture, decode/sample/convert and cancellation |
| `npm run test:video-e2e` | Actual composition export, decode, audio and cancellation |
| `npm run test:tts-e2e` | Actual local Matcha narration using pinned WASM/model cache |

Run build-containing commands sequentially. The Electron runner creates disposable profiles and uses a mock keychain on macOS; it does not modify or validate a production profile. DSH compatibility tests use a disposable Home/Workspace and no paid model.

Explicit migration tests verify stable BMW/native identities, preserved display history and Studio/media bytes, archived Project import, failed-write rollback, stale-plan rejection and concurrent-edit protection. Current-format stores reject old Agent files rather than converting them at startup. Driver boundary tests forbid concrete harness imports, provider RPC and client storage/selectors in the core. The fixture driver test proves the core can operate through the contract without loading the DSH Agent process.

Studio workflow tests use deterministic narration fixtures to check UI routing and state. Those fixtures are not external TTS or model-quality evidence. Actual local speech is verified separately. Edge service checks require `BMW_TTS_TEST_PROVIDER=edge`; paid model vision requires `BMW_VISION_TEST=1`.

## Reproducible stability baseline

`npm run verify:stability` runs one fresh build, then checks, serial unit tests, boundaries, driver, startup retry/exit, DSH, all desktop groups, Studio, browser/background, capture, processing, composition and local narration. Each step records passed/failed/not-run, exit code, duration and logs. A failed build stops before the classified run and cannot produce an accepted baseline; a later failure does not hide independent checks. Source hashes, locked dependency versions, selected/excluded tests and reasons are included in `result.json` under `.bmw-runtime/classified-tests/`. Desktop evidence includes stage, native window state, bounded renderer captures or explicit capture errors. Native focus failures remain failures; production keychain and native desktop acceptance remain manual.

State tests cover Project/settings/tasks/permissions/layout/login configuration and encrypted snapshots: invalid JSON/version/shape, simulated read/decryption failure, missing-file initialization, valid legacy reload, blocked background writes and explicit repair/reload. Startup retry/exit runs separately for Project and each newly protected state kind. Shell IPC tests cover missing/destroyed/foreign/navigated senders; the neutral driver invokes every Shell preload channel with a real foreign WebContents and an actual child frame, then exercises normal Shell/MCP calls. Renderer tests cover cancellation, deadlines, navigation, renderer loss, FIFO recovery and late results. Downloads abort fetch and streaming writes before rollback. Narration tests cover actual parameter records, voice/rate changes, independent captions/visual edits, imported audio, legacy audio and metadata forgery rejection.

## Video Studio production upgrade verification

The 2026-10-04 Video Studio upgrade adds eight contract cases in `video-studio.test.ts`: timeline/coverage and source-range policy, read-only measured reports and shared probes, unsupported tracks/symlinks/inspection conflicts, partial failure/resume, cancellation/concurrent edits, caption endpoint/duration limits and online opt-out with partial cancellation. Native reply tests also reject malformed dimensions and alpha metadata. Studio Electron smoke covers focused-input batch submission, retaining current audio, read-only measured reports and issue-to-scene navigation alongside real image previews, H264/AAC export and audio mixing.

The complete serial offline report for this upgrade is written to `.bmw-runtime/classified-tests/2026-10-04-video-studio/result.json`; consult its individual statuses and logs for executed results. The original authored workspace is preserved in `/private/tmp/bmw-video-studio-before-20261004.tar.gz`. Capability review and follow-up priorities are in [VIDEO_STUDIO_REVIEW.md](VIDEO_STUDIO_REVIEW.md). That initial report predates native image inspection; the following enhancement now verifies actual image decoding. GUI narration providers are deterministic fixtures; actual local Matcha is a separate runtime check, and Edge/paid models remain opt-in.

## Video Studio next-step enhancement verification

The next-step upgrade covers native static-image header admission and real PNG/JPEG/WebP decode, corrupt/oversized files, cancellation/recovery, deduplicated aggregate budgets, H.264/AAC encoder preflight, SRT/VTT cumulative timestamps and timing provenance, Project text reads/exports, bounded visual segments and revision-safe Assistant intents. Studio runtime confirms oversized library pictures never enter createImageBitmap, then drives actual subtitle buttons, material/segment editor and fade, retains narration/captions, compares preview pixels to an independently played MP4 and checks the durable JSON report. The original-sound tests use real AAC with trim/rate and segment-local silence boundaries.

The complete serial offline report is `.bmw-runtime/classified-tests/2026-10-04-video-studio-next/result.json`. The first full run is retained separately in `2026-10-04-video-studio-next-initial-failures/`: it exposed an existing GUI-test save-settlement race and the new shared image contract missing from the local narration protocol allowlist. The test now waits for enabled controls and a bounded conflict gate; the isolated TTS protocol admits that fixed contract module. Source backup and delivery hashes are retained under `.bmw-runtime/video-studio-next/`. Fresh build/typecheck, boundaries, all classified tests, isolated DSH/desktop/Studio/media/video and real local narration must pass before delivery. Check individual result statuses and logs for the executed counts. No external Edge, paid model or production Profile is included. Assistant reception and Studio speech routing use deterministic fixtures; they do not establish model script/matching quality. Automatic word alignment was assessed but not implemented in that snapshot; the later Studio sentence/segment evidence and correction path is described below. SRT/VTT retain edited/estimated/mixed timing provenance.

## Native image annotation and drawing verification

The image capability adds closed pixel-based `media.image.inspect`, `media.image.annotate` and `media.image.draw` browser actions. Contract tests cover shape/text/point/size bounds, executable inputs, opaque redaction, forged replies and output dimensions, no-input drawing IO, source retention and failed-output cleanup. The actual Electron media runtime samples PNG pixels for every primitive and arrowhead/text ink, verifies JPEG/WebP inputs and transparency, rejects invalid/corrupt/oversized/link sources and text overflow, tests permission denial, cancellation before painting and during finalized-output verification, and saves demo PNGs. The neutral model-side MCP fixture captures a real page screenshot, annotates it and creates a drawing; it checks Project output metadata, preserved original bytes and actual PNG image content through the sole tool.

The serial offline report for this change is `.bmw-runtime/classified-tests/2026-10-04-image-drawing/result.json`. Consult executed result statuses before claiming coverage. Tests use disposable profiles/Projects; no paid model, Edge speech or production-profile test is included. Documentation examples and the model catalog expose the workflow without adding a second tool or Agent loop.

## Baseline evidence

The current accepted source baseline is `.bmw-runtime/test-baseline.json`; its `report` points to the complete classified result. The guarantee fixes are validated under `.bmw-runtime/classified-tests/2026-10-04-guarantees/`, with authored before/after snapshots and the delivery manifest under `.bmw-runtime/guarantees/2026-10-04-zxkygtdq/`.

The 2026-10-04 closure report is `.bmw-runtime/stability/2026-10-04-closure/result.json`. Fresh build/check, 138/138 unit tests, 6/6 boundaries, isolated startup retry and exit, fixture driver, installed DSH, Studio, background DOM/diagnostics/capture, native media, composition and actual local narration pass. Desktop workspace, Project/Session with application restart, settings and native focus/keyboard each pass independently. Real focus assertions remain enabled; the macOS fixture establishes a regular application activation policy before testing them.

Verification runs in an isolated authored-source snapshot with the same installed dependencies and pinned local TTS cache. The delivery manifest records the final source hashes and original-workspace backup; all runtime Profiles, DSH Home/Workspaces and Projects are disposable. Paid models, Edge speech, production profiles and production keychain acceptance are not executed. Initial failures are retained separately: the restart test exposed a lost-tab restoration bug, and Studio caught stale status wording. Both were fixed before the final pass. Restart also exposed startup code continuing after application shutdown; shutdown guards were added, and desktop fixtures now wait for the Agent context to become ready before verifying or exiting. System-killed build attempts are retained as infrastructure failures with downstream not-run results.

## Earlier evidence and acceptance

Earlier driver-refactor regression logs and runtime screenshots are saved under `.bmw-runtime/driver-refactor-validation/`. Generated files are local verification artifacts and are not source code. UI evidence uses bounded Chromium renderer screenshots; covered native Views may not have a copyable OS compositor surface.

| Earlier driver-refactor regression | Result |
|---|---|
| Standard TypeScript emit and typecheck | Pass |
| Authored-source policy and capability/test inventory | Pass; 149 TypeScript sources, 6 frozen test-only exceptions |
| Unit and contract tests | Pass; 129/129 |
| Product, dependency and remote-control boundaries | Pass; 6/6 |
| Fixture driver with the real BMW core | Pass |
| Installed official DSH and normalized driver lifecycle | Pass |
| Browser background, capture and media processing | Pass |
| Composition export and local Matcha narration | Pass |
| Complete Studio workflow | Pass; includes real thumbnails, groups/drag, scripts, scenes, audio-clock preview and H264/AAC export |
| Desktop native interaction | Partial; integrated Studio passes, `host.isFocused()` times out and subsequent assertions are not executed |
| Production Profile/keychain | Pending user acceptance |

That earlier source snapshot encountered intermittent filesystem read timeouts and used low-memory compiler settings. Final emit/typecheck, unit/boundary and driver checks run from an identical authored-source snapshot in `/private/tmp/bmw-refactor-authored-bcv7q5k2`; application dependencies and installed DSH are unchanged. The source hashes and log location are recorded in `result.json`. Source policy, Studio and media checks also run directly in the repository. Use `GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1` and serial test execution on this host. Infrastructure failures remain in `filesystem-read-failure.log`; they are distinct from test assertions.

Studio playback samples the audio clock with a frame-rate timer and cancels outdated playback. Visible material loading supplements IntersectionObserver with bounded render/scroll/resize layout scans. The real Studio check verifies playback with zero compositor frame callbacks. Negative ownership/conflict checks intentionally log rejected operations.

Production macOS keychain authorization is performed by the user. Isolated desktop verification does not establish production keychain acceptance; native acceptance and production Profile state are recorded separately from automated regressions.

Optional synthetic vision checks run with `BMW_VISION_TEST=1 NODE_USE_ENV_PROXY=1 npm run test:vision-e2e` using disposable Profiles. New reports, screenshots and receipts are written to the ignored `.bmw-runtime/vision-tests/` directory. A passing run covers only its configured model and synthetic images; it does not establish all natural images, small text, arbitrary webpages or complete autonomous video production.

External publication, paid model calls, operating-system prompts, signing/installers, updater and independent remote/mobile control are outside these standard regression checks.

## Module interfaces and affected checks

[ARCHITECTURE.md](ARCHITECTURE.md) is generated from module/catalog declarations and package exports. Node selection follows TypeScript AST dependencies; runtime checks automatically follow changed validation helpers and use explicit behavior watches/interface guarantors for production modules. Global boundaries remain selected for code edits. Unknown/deleted paths, shared configuration and unbounded validation imports require full offline coverage. Architecture checks reject production-to-test imports, public test exports, bare/prefixed/indirect privileged renderer imports and unbounded production imports. DSH’s single installed-package resolver is admitted only for its declared literal; extra computed calls are rejected. Categories are unit, contract, boundary, type, integration, desktop, media and opt-in external. Every authored test must be classified.

`npm run test:plan -- --files <repository-relative-path>` explains coverage. Use affected scope for local features, and include every file changed by that task. When the checkout already contains unrelated uncommitted work, derive the file list from a before/after source-hash snapshot rather than the entire Git status. `verify:stability` explicitly passes `--all`; full execution from that command is intentional, not selector fallback. `npm run test:affected -- --files <path>` executes that scope after one fresh build; `--module` and `--base` are alternatives. Default affected compares all hashes against the last accepted full run. Layer commands only check the requested category. Direct runner invocation rejects stale source/output receipts. Run `npm run build` before direct architecture commands on a fresh checkout. Only a successful full run with unchanged source updates the baseline. External services and production profiles remain separate.

## Direct contracts versus concrete implementations

Browser and AgentDriver direct guarantees do not require the installed DSH implementation. The neutral `driver` fixture uses the Platform-injected Host-private `AgentBridgeConnection`, launches only BMW's MCP adapter and calls real browser actions over authenticated Bridge transport. It verifies the sole browser tool, actual pages shared with GUI, permission denial, foreign/forged/released binding rejection and recovery after switching Projects. No Agent loop, model or DSH process is used.

`bmw-dsh-assembly` is a separate implementation/assembly guarantee. Agent contract, DSH implementation or product assembly changes select it; Browser schema/catalog/Bridge/MCP-only changes select the neutral fixture without starting DSH. Full offline verification still includes DSH. Selection regression tests enforce both the exclusion and the positive/mixed-change cases. Installed DSH smoke verifies startup/auth/prompt/session compatibility rather than direct Browser action coverage.

Computed-import fallback applies to affected shared validation source and directly changed runtime entries; unbounded production imports fail the architecture gate. An unselected runtime test entry is governed by its explicit watches; its unchanged dynamic loading of installed dependencies does not widen unrelated Browser coverage.

## P0 scoped sources and exact citations

The new Project-source contract, collector and Studio tests cover closed scope/metadata inputs, UTF16 exact-quote admission, Project sharing with Session-owned draft mutations, revision conflicts, duplicate-content acquisitions, original-text hash checks, current media/proof hash verification (missing/changed/symlinked/legacy evidence), explicit metadata truncation, corrupt/symlink preservation and cancellation cleanup. `scripts/source-studio-smoke.ts` runs the real Browser Kernel, Project source store, native media worker and Studio GUI in a disposable Profile. Its loopback fixture excludes recommendation/avatar/advertisement/editable content, checks missing/truncated scopes, unknown metadata, HTTP 503, actual PNG decoding, repeated image-content reuse and complete-file VP8/Opus decoding with a separate partial-preview state. It also checks cancellation rollback, three-source citation JSON and saved-image/selected-text GUI behavior, disabled preview for temporarily missing media and recovery after the exact original is restored. Citation export reports unavailable media without rewriting acquisition history or changing the draft revision.

Reproduce it after a fresh build with `node scripts/run-electron-script.js scripts/source-studio-smoke.js`, or select it through `npm run test:affected -- --files packages/feature-video/src/studio-sources.ts`. Runtime evidence is stored in `.bmw-runtime/p0-sources/`; executed results are recorded by the classified runner. The fixture's three URLs do not establish a real multi-source commentary sample, real Bilibili acquisition, a platform's full-video duration, associated player capture, paid-model quality or a production-profile result. Chinese acoustic alignment and human-reference acceptance remain pending. The full P0 requirement tracking remains in [VIDEO_STUDIO_P0_IMPLEMENTATION.md](VIDEO_STUDIO_P0_IMPLEMENTATION.md).

## P0 associated player acquisition

The source runtime now records actual HTTP and blob video elements through the confirmed page/media scope and candidate currentSrc. It preserves separate source playback ranges and decoded-file ranges in a Project capture receipt. Real EOF/maximum-duration cases decode all available audio/video samples; trial/limited captures remain partial. The runtime rejects a same-URL video outside the confirmed scope and checks pre-initialization cancellation, cancellation during recording, page-navigation rollback, unchanged original artifacts and restored player pause/position. GUI invokes the same capture entry. The native contract test also cancels a deliberately delayed initializer and checks late cleanup plus preserved original bytes. Raw text, media and proof files from the disposable fixture are copied into `.bmw-runtime/p0-sources/raw-artifacts/` before the temporary Project is removed. These controlled pages do not establish platform whole-video availability or real Bilibili acquisition quality.

公开来源 P0 case 使用 `BMW_SOURCE_PLATFORM_CASE=1 node scripts/run-electron-script.js scripts/source-platform-case.js`（先构建）。仅复用本次保存证据时另设 `BMW_SOURCE_PLATFORM_CASE_RESUME=<保存的时间戳>`；它从 `.bmw-runtime/p0-platform-sources/` 复制到新临时 Project，保留原采集时间，不使用生产 Profile。`2026-10-04T15-33-26.409Z` 点评制作通过，实际来源/试看视频/正文图片来自 `15-29-33.012Z`；来源与媒体哈希、三条精确原文引用、事实/意见/未知日期/pending、41.7 秒 MP4 和代表帧保存到独立 `bmw-p0/public-sources`。它不是热点事实核查或真实 DSH 模型覆盖。

中文 ASR 候选资源可在构建后运行 `node --use-env-proxy scripts/install-local-asr.js`，固定 whisper.cpp 1.9.1 的 base/small 多语模型 revision、大小和 SHA-256。原生引擎须单独具备；资源安装不证明锚点精度。三段实际 Matcha 旁白的 base CPU 试验已保存原始输出与 16kHz/单声道输入；存在混读识别错误及 segment 范围超出音频，无人工参照、未报告 P95，自动词/字同步保持未开放。

### Native Chinese ASR evidence and ten-clip study

The fixed local whisper.cpp 1.9.1 base/small candidates were SHA-256 verified. Both ran against the same three original pilot inputs; small took about 9.87/10.79/10.85 seconds versus base's 3.41/3.53/3.57 seconds. Recognition and segmentation errors remain visible. These are ASR intervals, not forced script alignment or approved Chinese word timing.

Ten speech contract tests pass: closed fixed requests, original out-of-audio/overlap/low-probability evidence, disabled timing gates, trim/rate/voice-offset/cumulative mapping, normalized sample provenance, WAV rollback, subprocess cancel/log/deadline settlement and artifact replacement despite a pinned descriptor. The isolated native runtime at `.bmw-runtime/p0-speech` checks real mono/stereo 48kHz → 16kHz sample counts/waveforms, actual Matcha speech and base ASR hashes/raw results, and cancellation before normalization/recognition and during the real engine run without replacing originals. Final classified coverage is recorded separately after regression.

`speech-study-case.ts` generated ten real local Matcha WAVs and twenty base/small runs at `.bmw-runtime/p0-speech-study/2026-10-04T16-02-28.055Z`, covering mixed English, numbers, formula readings, pauses and deliberately added/omitted words. They are synthesized speech, not human recordings. Each clip keeps original and normalized fingerprints, actual format, raw/log outputs and measured runtime. No human reference or boundary P95 is supplied. This study predates the additional PCM-saturation counter field; its original receipts are preserved as collected and are not retroactively filled.

A separate loopback annotation page offers actual audio seeking/waveform positioning and blank sentence times. `speech-review-page-case.ts` verifies ten ready/seekable audio files, no horizontal overflow, empty initial times, an unchecked review declaration, 1.23-second seek/button capture and rejection before human review; it saves a native screenshot. It did not submit or fabricate a human reference. This review page is validation tooling; Studio now provides a separate sentence editor and shared caption projection; focus/bullet references are implemented as described below; independent human accuracy acceptance is not established by that original study.

### Studio sentence editor and caption anchor verification

The authored source is implemented in BMW and verified in an isolated snapshot at `/private/tmp/bmw-studio-speech-work/repo`; the running production BMW instance was preserved. Durable delivery evidence is under `/Users/changliangxu/.codex/visualizations/2026/10/04/01a104f1-7632-7513-b35c-55e2a2d5de67/bmw-p0/studio-speech/`. Consult its final classified report and source manifest for exact scope/status; this is affected verification, not a new full offline baseline.

Studio contracts cover bounded/Unicode-safe spans, exact whole-sentence candidates without splitting ASR paragraphs, trusted actor provenance, host-owned hashes, immutable records under ordinary updates, cross-Session rejection, audio/script invalidation, rerun preservation, cancellation/conflict cleanup, film-clock SRT/VTT and independent captions. A late audio replacement after composition blocks attachment and removes only the new MP4/report. The native speech smoke runs actual Matcha/base ASR through Studio, reads hashed evidence and preserves an Agent-edited test span; the span is a runtime fixture, not a human accuracy annotation. The Studio GUI smoke uses a real decoded one-second tone to verify blank boundaries, audio playback, manual correction, caption inspector/receipt downloads and three preview/native MP4 frame comparisons. No tone timing is claimed as measured Chinese alignment accuracy. Paid models, Edge, real-profile/keychain acceptance, ten-clip human P95 and automatic word/character timing remain outside this result.

## Shared sentence focus and title-card reveal

This implementation adds closed, editable sentence-anchor references for focus and title-card bullets. Contract tests cover original voice offset, trim/rate and sequential visual boundaries, changed targets/text, missing anchors, overlap/crop rejection, independent captions, CAS undo and actual audio-file replacement. Native admission bounds reveal times and prevents footage from adopting title-card reveals. The voice timeline starts at the real .5s offset. Runtime evidence and the final affected classification are recorded in VIDEO_STUDIO_P0_IMPLEMENTATION.md after execution; a passing scoped run does not replace the previous incomplete full offline baseline or establish Chinese acoustic timing accuracy.


## P0 three-step recording and unresolved source conflicts

`media.capture` now invokes `scripts/recording-workflow-case.ts` inside the existing recording IPC lifecycle. An actual controlled HTTP website enforces ordered template/voice selection, validates a POST configuration, stores a task and navigates to its result page. Native page clicks produce three measured-frame events; scroll/navigation are checked against the saved recording. Studio consumes that recording, creates real local Matcha narration, widens editable focus recommendations and adds a manual static-result interval. A .2s trim and 1.25 playback rate retain voice bindings and the original recording SHA. Button/result rectangles must remain inside the crop. Four GUI seeks wait for the completed timeline position before reading pixels; sample times fit both the .01s slider and output frame grid. Preview versus native MP4 uses the existing RGB mean absolute error threshold <7, with separately saved preview/result PNGs. The first passing run measured 0.7169/0.6980/0.7499/0.7481. Ordinary/high-DPR timing checks separately measured 1.200/0.300ms against independent visible frame changes. These are measured samples, not a global timing bound or acoustic-reference acceptance.

`sources` now uses a third original body that explicitly opposes the first two. Duplicate body/media reuse still applies to the first two URLs; the third retains different body content. Three exact UTF-16 quotes preserve `conflicting/pending/conflicting` and `factChecking: pending`. A six-second native title-card sample retains both opposing claims and the unresolved notice; draft citations and exported source/media evidence remain unchanged after rendering except for renewed availability `checkedAt` timestamps. The raw originals, before/after citation lists, MP4 and host video verification are saved under the runner's `BMW_VALIDATION_DIR`, or `.bmw-runtime/p0-sources/` for a direct run.

Reproduce with a fresh isolated build and the existing `media-capture-smoke.js`/`source-studio-smoke.js` Electron entries. This deterministic controlled-website evidence supplements the earlier public Bilibili/ordinary-page acquisition and three-source commentary sample. It does not prove paid DSH model quality, human Chinese sentence P95 or production-profile acceptance. The final report and preserved failed attempts are delivered under `bmw-p0/recording-workflow`; the full goal remains open pending human references and final complete regression.

## P0 final desktop regression audit

This historical audit precedes the unlocked passing baseline and later GPT-6 full report above; its failures and missing-reference statements describe the audit time.

The Shell-only background-throttling fix addresses a reproducible stale viewport: native Shell bounds were 870px high while its covered DOM still reported 102px. The isolated diagnostic settings run passes dark/light settings categories, Session and scheduled-task dialogs, compact 960×640 resizing and visible footer actions with only the Shell preference changed. Browser page preferences were restored before that passing run. Diagnostic generated-output edits are evidence only; the final classified run must follow a clean authored-source snapshot and fresh build.

Native screenshot failures are retained separately. Removing forced software GPU, explicit capture rectangles, visible-size experiments and active-page throttling did not resolve UnknownVizError, and none of those browser experiments is included in production. A further baseline native capture failed before viewport emulation; this prevents attributing that failure solely to large emulated dimensions. Desktop inventory independently reports the Mac locked. Native compositor capture and actual foreground/keyboard assertions remain required and are not replaced by DOM focus or CDP screenshots. Final offline result and source hashes are recorded in the final-regression evidence directory; a failure does not update the accepted full baseline.

Ten real Chinese audio clips and both fixed ASR candidates remain available in the speech-study evidence. No human reference has been submitted at this audit, so per-clip boundary errors and P95 remain unverified. Automatic word/character timing stays unavailable.


## User-listened Whisper base adoption

On 2026-10-05 the user explicitly confirmed listening and requested use of the base annotations. The existing review checkbox was checked; the ten-clip ASR-assisted record was saved with original segment provenance. Only ten out-of-audio ends were bounded to the actual file durations; no internal boundaries or merged paragraphs were invented. The raw-to-adopted boundary displacement nearest-rank P95 is 272.125ms over 24 start/end values. It is a dependent-reference correction metric, not independent acoustic accuracy, and does not approve automatic timing. Low-confidence/misrecognition warnings and the untouched raw outputs remain available.

The unchanged isolated application source consumes all ten actual WAVs through the sole browser catalog with a trusted user actor and Project/Session/revision admission. Twelve host-hashed editable anchors drive the same .5s-offset caption and board projection. Actual SRT/VTT exports retain provenance; the H.264/AAC sample is about 107.648 seconds, completed MP4 reuse preserves revision, and the Studio GUI shows ten scenes and real preview. The first artifact workflow attempt failed when seeking before async preview preparation; it is preserved under initial-preview-race, and the successful retry waits for readiness before seeking. Evidence, original/corrected reference, per-clip correction displacement and the final runtime result are in `/Users/changliangxu/.codex/visualizations/2026/10/04/01a104f1-7632-7513-b35c-55e2a2d5de67/bmw-p0/base-adoption/`. This adds acceptance artifacts and documentation, not production code. The previously passing full offline baseline remains evidence for identical runtime source; documentation-only gates are recorded separately. Paid models, Edge and production Profile/keychain are not covered.


## Video Studio 本期专项验收（2026-10-05）

可靠编辑/文字与关键帧审片、视频原声双语字幕和 summary/comparison/screenshot 固定模板已完成源代码实施、测试与现行文档。测试在 `/private/tmp/bmw-studio-next/repo` 隔离副本执行；没有构建运行中的生产仓库、修改生产草稿或用真实 Profile 作为夹具。

- 本次实际生产/测试文件范围选择 39 组分类回归，`selection.full=false`；全部通过。包括构建、架构、源代码策略、功能索引与桌面组关卡共 44 个 passed 记录。分类目录登记和生成文档分别校验；范围不混入既有未提交 Agent 工作。相关范围覆盖 owner/CAS/FIFO、来源、原生媒体端口、旧 Studio、桌面工作区、编码、本地旁白与 ASR。
- 专项字幕/视频/语音测试共 71 项通过；覆盖原视频剪裁/变速/前置片段偏移、无 .5 秒旁白偏移、人工译文保护、原文/CAS 冲突、源 SHA 变化、取消与新产物回滚、模板/文字溢出和 SRT/VTT 显示模式。
- 原生验收分别使用实际本地英文 TTS 视频，以及只读复制到临时 Project 的既有公开视频。公开采访实际识别 35.118 秒音轨、9 段原始 base 结果；Opus 末包超过实际音轨终点的 2160 个输入帧被受限裁去并入证据，源时间零点不变。原始文件 SHA 在验收后仍与识别证据一致。
- GUI 验证识别结果可见、原文件试听、核听确认、独立原文/译文编辑、人工译文重译保护、未保存校正外部更新/CAS 不丢失、明确重新加载恢复、模板撤销重做、预览刷新时间/属性同步与关键帧缩略图。多视频片段重新读取识别结果后，选择器与试听都返回该证据的原视频。
- 两种比例（640×360、540×720）实际 H.264/AAC MP4 与预览逐四个时间点比较，均通过像素误差上限；双语 SRT/VTT 和 source 来源清单一致。有效但溢出的长双语字幕阻止编码，无新增完成输出，既有成片保留。旧隐藏窗口的帧检查改为等待 `seeked` 后实际 Canvas 像素，仍检查解码和预览一致性。
- 39 组回归报告是 Opus 与未保存校正保护后的精确快照。其后仅修改原声 GUI 的识别片段/试听原文件选择及 `studio-next-smoke.ts` 多片段验收；这两份最终文件已重新 build/check 并通过公开视频完整 native 验收。报告与后续文件哈希分开记录，不把旧快照宣称为最终文件全量再跑。

完整证据目录：/Users/changliangxu/.codex/visualizations/2026/10/04/01a104f1-7632-7513-b35c-55e2a2d5de67/bmw-studio-next。包含 before-source、前后 SHA 清单、明确变更文件范围、classified-final/result.json、fresh build/check/unit 日志、最终 verification.json、原始 Whisper JSON、字幕、原声/关键帧 UI、两种比例示例 MP4 和关键帧。保存了既有未提交代码；历史 VIDEO_STUDIO_REVIEW 与 P0 文档未重写。

限制：自动 GUI 夹具不证明人工转写准确率；Assistant 翻译路由使用受控接收端，不计作付费模型翻译质量验收。完整原声 ASR 上限仍为 180 秒，无长片分块/自动词级时间。当前 Mac 锁定，生产桌面未观察或重启；新代码在运行中的 BMW 生效还需退出后构建并重新启动。

## 2026-10-06 Agent 设置重复刷新修复

同一驱动在设置读取、登录、模型修改或其连接清理期间收到的 refresh 合并为已有状态读取；新的登录/模型修改及其他驱动的设置仍被排除。清理失败保持隔离，必须先恢复清理。设置窗口在驱动切换期间不再竞争刷新，Assistant 明确显示读取与取消/清理状态。

最终局部报告：`.bmw-runtime/classified-tests/2026-10-06-agent-settings-coalescing-final-01a104f1/result.json`。声明五个代码/测试文件，选择 21 组回归，全数通过；构建回执、源码规范、功能清单与架构门通过，无全量回退，源码在运行期间未变化。覆盖真实 Electron 的重复打开设置/IPC 刷新共用单次原生读取、取消后等待实际清理再切换、会话/Project 归属、默认三驱动装配、调度、六种启动恢复及桌面 Project 重启。另有设置、Host、Assistant 与三驱动设置契约共 31 项单元测试通过，完整 check 通过；日志保存在最终报告目录的 additional-unit.log 与 additional-check.log。单元测试与生产源一致，后续只调整 Electron 新用例的实际按钮入口及异步状态等待。

初次界面回归的错误调用及异步断言失败保留在此前报告和本地日志；最终证据以 final 报告为准。所有自动运行时验证使用临时 Profile，无付费推理或外部登录验收。报告包含本段追加之前的文档哈希；本段追加没有改变运行源码或编译产物。

修复版本已按用户要求正常退出旧应用、重新构建并以现有 BMW Profile 启动；现场只观察到原 Project/会话、Qoder CN 选择与 Assistant ready，无错误提示。这是正常启动观察，不能替代生产凭据或真实模型推理验收。


## 2026-10-06 — Profile 内分 Agent 设置缓存（方案 B）

最终源码重新构建并通过 `npm run check`。本次以十个实际修改的源码/测试文件显式选择 43 组回归，`full:false`、无 fallback，全部通过；报告为 `.bmw-runtime/classified-tests/2026-10-06-agent-settings-cache-final/result.json`，修改前快照保存在同目录 `before/`。源文件哈希在追加本节之前全部再次核对一致；本节是报告完成后的证据说明。此前 `2026-10-06-agent-settings-cache` 报告保留，其中设置 UI 脚本因主进程完成早于 Renderer 按钮可用而点击无效，最终脚本已等待真实控件状态并通过。

缓存回归覆盖每 driver/每 Profile 隔离、跨 Project 复用、5/30 分钟独立过期标记、查看不启动原生进程或获取维护排除、显式刷新、偏好/baseline 变化、任务失败失效且不重放、认证取消与部分失败清空旧就绪状态、取消读取不能发布新时间，以及清理隔离不被缓存查看绕过。实际 Electron 脚本计数确认首次读取后反复打开/切回没有增加原生读取次数；两个手动入口均可刷新。

相关官方适配器契约、有效单 browser 准入、真实隔离 DSH 设置 set/unset 与零输入、Assistant 登录/模型确认/取消清理、跨 driver schedule 与 Project/Session/Studio 归属、受保护状态启动 retry/exit、Shell IPC 与实际 Project 重启全部通过。自动化只使用一次性 Profile/Home，不证明真实账号额度、付费推理或生产 keychain 授权。生产 BMW 的正常重启仅用于加载新构建，与隔离回归证据分开。


## 2026-10-06 — Video Studio 简单制作与高级编辑 A/B

已构建并通过完整 check。最终离线快照 `.bmw-runtime/classified-tests/2026-10-06T15-13-49-042Z/result.json` 中 75 组单元／契约／边界及 4 个检查门通过，无失败。Studio 确认偏好使用封闭契约、与草稿数据分离；上下文保持原 Session、单 browser 与 revision/CAS，普通研究请求不授权制作，确认偏好随任务上下文冻结。

隔离运行时证据目录：`/Users/changliangxu/.codex/visualizations/2026/10/05/01a10c62-c77b-7422-a6cf-8dea4849503d/outputs/bmw-studio-simple-20261006`。`regression/result.json` 覆盖真实应用、三驱动默认装配、任务调度与启动恢复、官方 DSH、Studio、来源采集、媒体处理、H.264/AAC 视频、Whisper、本地旁白以及桌面工作区／设置／Project 重启。该快照有 37 个通过项；browser.background 在原生工作区截屏报 UnknownVizError，desktop.native 在宿主前台 focus 等待超时（desktop-suite 汇总同一失败）。保留原始失败，未削弱这些原生断言，不能将其宣称为通过或已观察生产桌面。

其后仅对 Studio 展示做隐藏 MP4 暂停与成片标题区域修正；`playback-followup` 和 `ui-final` 重新通过完整 Studio 原生操作／导出回归，真实播放 MP4 后切回草稿立即暂停，草稿与已导出文件分别保留，成片页文字无重叠。最终复查源码中任务操作名称使用用户可读文案；该文案调整只重新 build/check。宽／窄工作区和明暗主题截图、实际字幕／样例 MP4、日志与源码清单保存在同目录。Assistant 示例保留既有输入、验证 Project/Session 后仅填写，不启动任务；活动卡过滤外来会话，排队无工具事件时也可取消，取消等待 Host 清理，未知结果不自动重发。

所有自动化使用一次性 Profile/Home，未操作生产资料、未调用付费模型。分阶段确认遵从、自动素材采集的真实模型效果、五名初学者可用性及生产 keychain/前台桌面验收仍需独立验证。有限多轨、更多特效和 AI 素材生成不属于本轮已实现内容。本节为测试完成后的记录，不把文档追加或最后的文案调整冒充之前全量快照中的源码。


### Studio cards, immersive layout and scoped production (isolated, 2026-10-07)

Current source build passes. AgentHost + Studio tests pass 62 cases, including frozen queued context, foreign-owner lookup, strict prompt shapes and no receipt for invalid context. assistant-application-smoke uses a real createBmwApplication with disposable userData: full-window Studio bounds, renderer/native property dock agreement, unchanged Assistant WebContents/input/history, collapse/restore, sidebar width, first-typed scene retained across new selection/layout, invalid owner/deleted target rejection and an actual scoped fixture run. video-studio-smoke passes real decoding/MP4 checks including one confirmation regenerating only one stale scene, retaining the other voice, playable output and fingerprint reuse. Speech routing for that case is stubbed with a local WAV; this does not prove paid model or online TTS quality. Logs: /private/tmp/bmw-studio-scope-smoke.log and /private/tmp/bmw-studio-production-smoke.log. These checks do not prove actual multitrack/effects, which remain unfinished.

### Bounded layers and independent audio (isolated, 2026-10-07)

Build/check and all selected unit/contract/boundary entries pass in `.bmw-runtime/classified-tests/2026-10-07T00-34-00-118Z/result.json`; this is that scope, not a full offline or desktop baseline. The affected media-production/Studio unit run passes 67 cases. The installed official DSH compatibility smoke passes with temporary Home/Profile and no model input.

Actual video-studio-smoke verifies scene-local animated rectangle/video PiP, global text/image, local/global independent audio, actual narration ducking and return to card view with preserved containers. Four actual preview/native H.264 comparisons have mean pixel errors below 2 on the 0–255 channel scale; ducked independent music measures 0.24999999 of unducked music during real measured voice time. Preview/native AAC RMS pairs agree within 0.0001 for the measured intervals, with silence after the selected source windows. The voice fixture is a local one-second tone; this is not paid-model, online TTS quality, production-profile or human speech-timing acceptance.

Logs and immutable source hashes are in the task-owned `outputs/bmw-studio-layout-implementation/completion-audit.json`, `layers_native.log`, `layers_unit.log`, `layers_check.log`, `layers_classified.log` and `layers_dsh.log`; the actual MP4 and detailed evidence are `layers-runtime/independent-layer-sample.mp4` and `independent-layers-verification.json`. This validates actual media consumption of typed layers, not the full editing interface. Writable timeline gestures, resource tabs, layer properties and layer-ID Assistant scope remain required before claiming the overall UI design complete.

### Independent layer UI, canvas gestures and minimal chrome (isolated, 2026-10-07)

Current implementation build/check passes. Final `unit,contract,boundary` snapshot is `.bmw-runtime/classified-tests/2026-10-07T01-26-03-335Z/result.json` (79 passed entries, 40 not run). The isolated official DSH compatibility check passes with no model input. The actual Studio regression verifies resource additions, object text/keyframes, native audio movement and undo, CAS rejection retaining edits, card roundtrip and the existing H.264/AAC visual/audio output checks. Native pointer events additionally verify animated object move/resize preserves timing and frame relationships, with one-step undo. This does not prove continuous canvas pixel feedback or export after a transformed pose.

The real isolated application Assistant check verifies rendered DOM/native property dock agreement, unchanged WebContents and pending input, collapse/card roundtrip, pinned scope ownership, and hiding/restoring that same native chat view for Studio menus. Minimal advanced toolbar retains original controls; low-frequency controls move to More and return to their prior parents in card mode. Logs, report reference and source hashes are durable in the task `outputs/bmw-studio-layout-implementation/completion-audit.json` under `canvas_*`; Studio artifacts are in `canvas-runtime/`. Tests use temporary Home/Profile and local/stub voice fixtures, and make no paid-model or production-profile claim.

The full design remains incomplete: main-track writes, independent layer-ID Assistant targets, continuous canvas pixel updates/blank film selection, lossless arbitrary eased cuts, additional finite transitions, responsive/long-script acceptance, generated/reference assets and targeted experimental review adoption. The separately checked 37-case workspace prototype is a design artifact, not application proof.

### Live canvas and full-film properties (isolated, 2026-10-07)

Build/check and the final `unit,contract,boundary` snapshot `.bmw-runtime/classified-tests/2026-10-07T01-39-33-472Z/result.json` pass (79 passed, 40 not run). This is not a full offline or production baseline. Final native Studio checks use real mouse events to change actual preview pixels before release without writing a draft revision. Escape and mode changes mid-gesture restore exact canonical PNG pixels; pending draws drain before decoded resources are released. One-step gesture undo is retained. A GUI-moved pose is exported to real H.264 and compared at the same playback time: mean channel error 0.952092 on the 0–255 scale. Evidence includes `live-canvas-runtime/canvas-live-verification.json` and `canvas-transformed.mp4`.

Blank-canvas native selection opens film properties with exactly one canonical option form; the existing modal temporarily reuses that form. Pending FPS saves before mode change and is restored by one undo; full-film selection returns after card roundtrip. A foreign revision rejects style application, preserves input and current mode, and requires explicit reload. Existing Studio media/source/speech/session ownership checks and real Assistant application layout/scope checks also pass. Logs and source hashes are in the task completion audit under `live_canvas_*`. Local/stub voice and disposable Home/Profile only; no paid-model, online speech quality or production-profile claim. Main-track writes, independent layer-ID Assistant scope, arbitrary eased cuts, more transitions, responsive/long-content acceptance and targeted experimental review remain incomplete.

## Studio 精确对象范围与默认小浮框（隔离验收）

当前实现增加独立视觉图层/音轨的 layer {id,kind} 请求范围，明确区分镜头局部与全片容器；发送前拒绝错误类型、容器与已删除对象，第一笔输入及快捷预填固定目标，已有输入不被另一委托追加或覆盖。真实 Assistant 夹具以本地标题及实际解码的一秒 WAV 音轨验证选中变化、卡片往返、拒绝不产生消息、Host 接收冻结对象数据以及取消清理；不是付费模型效果或新增工具授权。

高级助手展开默认 360×360 的原生浮框，在实测属性列左侧、时间轴上方；主动停靠才占属性区。真实窗口缩到 900×700 后临时停靠，关闭并恢复原 1440×870 后仍按用户浮动偏好/位置展开，输入和 WebContents 保持。默认浮框曾在并行验证时观察超时；添加实际 DOM/Native 尺寸诊断后，两次顺序运行通过，均读到属性 x=1160、top=111、bottom=735 和浮框 x=788、y=123、width=360、height=360。未据此宣称并行压力或所有响应布局已完成。

构建与 check 通过；分类报告 `.bmw-runtime/classified-tests/2026-10-07T02-06-12-733Z/result.json` 为 unit/contract/boundary 的 79 passed、40 not-run，并非全量离线、外部服务或生产 Profile 验收。闭合目标还拒绝可被 String 转换为合法枚举的数组，最终分类和原生 Assistant 顺序通过；此前两次诊断运行也通过。实际 Studio smoke 保留既有 H.264/AAC、实时画布、全片参数、语音/字幕、卡片及 Session 回归；官方 DSH 隔离兼容验收通过，未执行模型输入。

本任务日志为 `outputs/bmw-studio-layout-implementation/layer_scope_{build,assistant,assistant_repeat,native,check,classified,dsh}.log`，Studio 实际媒体在 `layer-scope-runtime`；逐文件前后记录见 `layer-scope-manifest.json`。完整设计仍包括旧主轨写入、完整响应抽屉、浮框对象避让/连续拖动、任意缓动裁剪、生成/参考素材、任务边界和可逐项采用的实验审阅，不能用本次范围和布局验收替代。

## Studio 主轨基础操作（隔离原生验收）

当前实际 Studio 验证镜头主轨拖动调序、右边缘修剪与后续顺移、调序撤销、卡片/高级往返；旁白精确开始/源起点/长度/速度属性、真实边缘修剪和撤销重做保留实测源长度；独立字幕实际拖动及双语分割使用同一 canonical cue 列表。主画面分割与旁白内容分割仍未实现，不能据此声称完整多轨编辑器已交付。

真实 H.264/AAC 成片的旁白区间为镜头内 0.25–1.00 秒。三段采样的预览 RMS 为 [0, 0.32371048299, 0]，实际 AAC 为 [0, 0.32366620905, 0]，均在预期区间内播放，原 WAV 仍实测一秒。实际音频源越界不生成伪时间轴片段，原属性保留可修复；修复源起点后同一旁白身份恢复。旧版本的待编辑值遭遇外部更新后保留，保存拒绝 STUDIO_CONFLICT，只有明确 reload 放弃输入。

首次主轨验收在调序阶段失败；记录实际指针命中、调整测试起点并等待保存完成后调序通过。下一轮发现预览准备完成可能覆盖外部更新提示为“草稿已保存”，修复为存在主轨/图层或其他待保存字段时保留提示。最终完整 Studio smoke 退出 0，包括既有图层、实时画布、语音/字幕、全片设置、Project/Session 与实际媒体回归。失败日志保留，未把早期运行算作完成。

build、check 和分类报告 `.bmw-runtime/classified-tests/2026-10-07T02-46-12-365Z/result.json` 通过，分类为 79 passed、40 not-run，Studio 单元组为 59 passed。真实 Assistant 应用验证同一 WebContents、固定消息范围、原生浮框/停靠和发送前保存；官方 DSH 隔离 Home/Workspace 的兼容检查通过且未发送模型输入。证据见本任务 `outputs/bmw-studio-layout-implementation/main-tracks-manifest.json`、`main_status_native.log` 与 `main-tracks-runtime/main-track-timing.{mp4,json}`。不是全量离线、生产 Profile、付费模型或在线语音品质验收。

完整设计还要求主片段内容分割/复杂引用重绑定、资源/属性响应抽屉、浮框连续拖动与对象避让、任意缓动裁剪、更多效果、生成/参考资源、任务失败边界与逐项实验审阅。完成清单保持完整十项范围并标记未完成。


## Studio 卡片、响应抽屉与连续浮框（隔离验收）

当前镜头常驻两个本地动作：换画面、声音与字幕。画面取景和标明委托的 Assistant 操作收进镜头菜单。真实 Renderer 验证当前 owner 的卡片 drop、保存及撤销，外来 drop 不写 revision；这是 drop 路由检查，不代表原生指针拖动卡片的完整验收。24 镜头长中文夹具验证完整正文、唯一脚本控件、独立滚动、无卡片横向溢出及可用预览空间，未把这项布局检查计作媒体内容品质验收。

同一个原生 Assistant 在高级模式展开为小浮框：实际选中画布范围及资源栏避让、鼠标释放前连续移动、Esc 恢复、异步关闭/停靠固定 owner、原输入保留均通过。响应抽屉只移动原资源/属性 DOM，不复制表单，窗口变更保留待编辑文字；高级原生最小宽度为 420，返回普通工作区恢复 960。旧最小宽度导致 500 宽请求被钳制的失败日志保留，调整后隔离 Native 检查通过。

实际 24 镜头截图曾暴露切换草稿后残留旧预览。修复立即重置画面/播放时间并串行准备/释放。真实 Renderer 延迟素材加载夹具证明取消等待实际排空、两个过时准备返回未就绪、后续准备成功；新草稿实际像素及时间重置。完整 Studio 原生回归通过，包括语音/字幕、实时图层、主轨、CAS/Session 和 H.264/AAC 输出。此前一次 segment-preview 超时日志保留，未确定该次超时根因，也不据后续通过声称压力稳定性完成。

日志及截图位于本任务 `outputs/bmw-studio-layout-implementation/` 的 `cards-panels-*`；前后源码记录与最终报告见 `cards-panels-manifest.json`。build、check 及 workspace 桌面组通过；最终分类与 DSH 状态以 manifest 的实际报告为准。检查均使用临时 Profile/Home，未操作生产应用、未执行付费模型/在线语音/生产 keychain 验收。全部十项原始目标保持，主画面/旁白内容分割、任意缓动裁剪、更多有限效果、参考/生成素材、生产部分失败/取消、逐项实验审阅与完整压力验收仍未完成。


## Studio 缓动曲线的任意位置编辑（隔离验收）

受限 `easingRange` 保存原 smoothstep 的有效区间，修剪/分割及插入播放头关键帧保留几何和关键帧透明度曲线，近曲线端点采用稳定求值。Studio/媒体 78 项单元检查覆盖重复裁剪、保持区、完整十二点动画的切割、合法区间持久化、CAS 拒绝、反向/越界/非有限区间及隐式枚举转换拒绝。明确改变插值会重新设定该段曲线；原数据无此字段时行为保持。

实际 GUI 在 1.25 秒分割、2.25 秒插点，再用原生鼠标修剪后段。单步撤销/重做和卡片往返保留原曲线区间。0.25/0.5/1.25/1.5/2.25/2.5 秒六个实际预览采样的像素差均为零；对应 H.264 平均 RGB 绝对误差约 1.06–1.18，均小于夹具阈值 5。原生文件与 JSON 在本任务 `outputs/bmw-studio-layout-implementation/easing-runtime-admission/`，完整 Studio 回归包括原有语音/字幕、图层、主轨、Session/CAS 与真实 H.264/AAC。

认证 Bridge 的直接 `video.compose` 也把区间保留到同一所属会话的可编辑 Studio 草稿，并复用实际完成的 MP4；非法倒置区间在输出前失败，原 artifact 列表不变。既有旁白越界、权限、路径、真实采集、多片段、模板和取消清理回归保留。官方 DSH 隔离兼容检查通过且无模型输入；最终构建/check/分类与逐文件哈希见 `easing-manifest.json`。

初次原生采样使用 1/12 秒，被真实 range 控件按 0.01 步长取为 0.08，精确等待超时；改用同时对齐控件和帧的 0.25 秒，保留原精度和像素断言后通过。直接合成的原旁白越界负面夹具新增了两秒全片动画，触发了更早的对象越界；该夹具显式去掉动画，并将旧英文消息断言更新为当前精确的中文 Error 对象。一次断言编辑缺失括号导致构建失败，补齐语法后重新构建通过。上述失败日志保留，不算作通过。一次自动审批超时导致严格枚举脚本未执行，工具授权的一次重试成功，未遗留审批阻塞。

这不是全量离线、付费模型、在线语音或生产 Profile/keychain 验收。淡入淡出边缘仍沿用既有规则，本次不证明其无损裁剪；有限转场/其他效果、主画面与旁白内容分割、参考/生成素材、逐项实验审阅和完整流程/压力验收仍保持在原十项范围内。

## 高级模式自动小浮框与播放条避让（隔离验收）

最新设计把进入高级的默认胶囊调整为自动小浮框。本轮保存／重排并上报实际几何后展开同一个 Assistant；最大 320×320。分阶段确认更新不改变聊天开关。自动位置在明确收起后重开时重新避让当前对象；手动位置保持。浮动区域按实际 transport 上沿留出 8px，停靠仍使用完整属性列；不增加会话、模型任务或聊天输入框。

最终构建和 check 通过。相关 Studio／布局单元测试 67 项通过；最终 unit/contract/boundary 分类报告为 `.bmw-runtime/classified-tests/2026-10-07T03-56-50-500Z/result.json`：79 passed、40 not-run，不能作为完整离线或付费模型验收。隔离原生 Assistant、完整 Video Studio 媒体工作流和 DSH 兼容脚本均退出 0，日志为 `/private/tmp/bmw-float-entry-assistant-admission.log`、`/private/tmp/bmw-float-entry-studio.log`、`/private/tmp/bmw-float-entry-dsh.log`。

实际 Native float 测得 x=828、y=287、width=320、height=320；所选画布对象 x≈367.51、y≈208.84、width≈644.98、height≈68.02，初次重开避让通过。浮框输入／发送／范围及标题按钮的实际 DOM 边界均在视口内；完整对话可展开，原文字不丢失。真实鼠标释放前移动、Esc 恢复、foreign owner 拒绝、900px 窄窗临时停靠、500px 原资源／属性抽屉、宽窗恢复原节点及待编辑文字、返回卡片恢复侧栏宽度和同一个 WebContents，均由完整原生脚本验证。自动打开和偏好更新没有增加消息或发起模型任务。

完整 Studio 回归仍验证实际 H.264/AAC、主轨旁白播放区间、独立双语字幕、多轨对象、保存冲突保留输入、卡片往返及撤销。主轨音频预览 RMS `[0,0.3237104829915316,0]`，编码后 `[0,0.32366620905448923,0]`；六处缓动采样预览差异为 0，导出在既有误差阈值内。本轮没有新的真实模型／线上 TTS／生产 Profile 验收。

第一轮原生验证揭示自动位置在收起重开时沿用旧位置，已通过区分自动与手动选位修复并保留失败日志。第二轮拖动测试仍假设旧尺寸的右上角／固定 y 阈值，新尺寸已自动选择下方位置，因此测试改为根据实测可用方向移动；未删除真实指针、双轴移动和 Esc 断言。最终完整原生脚本通过。详细源文件变更、60 文件保护快照、完整原型与实现范围保留在本任务 `outputs/bmw-studio-layout-implementation/float-entry-manifest.json` 和 `completion-audit.json`；完整十项目标仍未完成。

## 旁白播放片段验收范围

当前源支持稳定旁白片段、原始源时钟、精确 Assistant 对象范围及原生时间轴标尺。证据位于本任务 outputs/bmw-studio-layout-implementation/voice-segments-runtime 与 voice-segments-*.log / voice-ruler-*.log；以 manifest 和实际终态报告为准。分割前后真实混音与画面比对、独立移动／修剪、撤销／重做、卡片往返和 H.264/AAC 检查使用一次性 Project 的一秒测试音，不是自然人声质量或真实模型验收。官方 Host/composer 隔离验收检查固定片段 ID、错误容器／类型／删除目标拒绝与取消排空。原十项目标和未完成项仍保留在 completion-audit.json，不以本项通过声称整套设计完成。

该次检查实际结果：82 项相关单元通过；分类运行 79 组通过、40 组未运行；原生 Studio 旁白片段分割／移动／修剪／撤销／卡片往返与 MP4/AAC 一致性通过，连续切点的混音最大差与画面像素最大差均为 0。官方 DSH cold 装配通过，不涉及付费推理。原 Assistant 回归在新增精确旁白范围场景前失败：Native Studio 为 1440×870，Renderer 保持旧 980×768；系统布尔检查确认屏幕锁定。尺寸重投递、重新附着和显隐实验未恢复视口且已全部移除，未以实验或放宽边界建立通过结果。该项需要解锁后原样重跑，不将其标记为已验证，也不以锁屏推断正常桌面的成因。


### 主画面分割的当前验收

86 项相关 Studio／媒体单元测试通过：图片与视频的任意／连续切点保持取景、推近、聚焦和透明度；句聚焦跨切点保留整句与源时钟；可信原声字幕／识别证据索引由宿主派生，分割及撤销不覆盖人工双语字幕；独立转场与运动时钟分开。当前 classified 单元／契约／边界分组结果 {"not-run":40,"passed":79}，结果为 .bmw-runtime/classified-tests/2026-10-07T05-03-30-038Z/result.json。

实际 Studio 在临时 Profile 内通过两次主视频分割（淡入内部、原声内部）、稳定片段 ID、撤销／重做、卡片往返与 H.264/AAC 输出比较。四个时刻的编码画面平均误差为 [0,0,0,0]，AAC 波形差 RMS 为 0；原视频 SHA 保持。素材为原生产品示意与测试音，不代表真人配音、ASR 或外部服务质量验收。证据位于本任务 outputs/bmw-studio-layout-implementation/visual-split-runtime 的 main-visual-cuts.json、前后 MP4 与编辑器截图。

整镜头分割、精确画面 ID 助手请求、效果窗外扩展、全部复杂引用重绑定、更多效果／参考／生成素材、逐项实验审阅及完整流程压力／用户验收仍未完成。此前锁屏条件下的原生 Assistant 浮框验收仍未补证，不能用 Studio 内容测试替代。


## 后台结果与编辑连续性（隔离原生验收）

后台导出只增加成片记录时，现有预览沿用已解码素材，更新对应草稿版本；实际内容或已加载素材发生变化时重新准备预览。后台状态读取按顺序执行，视图切换期间等待布局和预览准备完成再恢复操作，避免旧状态覆盖刚完成的保存。卡片模式收到新成片后，中央显示真实 MP4，保持暂停。

完整 Video Studio 原生检查在一次性 Profile／Project 内退出 0。明确选中第 3 个主画面片段后，后台导出前后播放位置均为 0.75 秒，中心像素均为 [218,34,33,255]，音频上下文数量不变，撤销／重做仍可写入。后台导出期间可见脚本输入的正文和真实焦点保留，保存使用原版本并返回 STUDIO_CONFLICT；实际新文件仍出现在交付历史。清洁草稿收到外部内容更新后自动准备并保持 1.2 秒位置，卡片中央成片实际可播放且未自动播放。分割前后 H.264 画面四处误差为 [0,0,0,0]，AAC 波形差为 0。

构建与分类单元／契约／边界报告 .bmw-runtime/classified-tests/2026-10-07T05-35-06-065Z/result.json 通过：79 组 passed、40 组 not-run。最新检查结果见 background-preview-check.log；源码保护、最终原生报告和截图位于本任务 outputs/bmw-studio-layout-implementation/background-preview-manifest.json 与 background-preview-runtime。测试不使用真实用户 Profile，不代表付费模型或线上语音质量验收；此前原生 Assistant 在锁屏条件下的几何与精确旁白发送仍需补验，完整十项设计目标保持未完成。


## 主画面稳定选择与精确请求范围

主画面时间轴选择和 Assistant 目标使用既有 visualSegmentId，按稳定身份重新解析调序后的下标。首次输入固定原 composer 范围，切换选择及 Project／Session 保存未发送文字和目标；改为镜头或全片范围时移除片段 ID。删除、外来镜头、非法身份或混用视觉／旁白／图层目标会拒绝，固定上下文不替代 browser 授权。旧单画面没有持久 ID 时仍使用镜头画面范围，选择不会制造身份或写草稿。

71 项 Studio 与原 composer 定向测试通过。完整隔离原生 Studio smoke 退出 0：实际第 3 个画面片段的 context 和预填 target 均为其原稳定 ID，预填 kind 为 object、objectKind 为 visual，并带正确 sceneId；既有分割、保存冲突、撤销、后台连续性和 H.264／AAC 回归保持。新增原 composer 单元测试覆盖首次固定、选择切换、跨会话恢复、已有消息预填拒绝与主动扩大范围。最终单元／契约／边界分类为 80 passed、40 not-run，报告 .bmw-runtime/classified-tests/2026-10-07T05-52-31-872Z/result.json。构建、功能／架构文档及最终 check 以 visual-scope-*.log 为准。

完整原生 Assistant 回归尚未通过：两次运行在实际音频资源入口超时，等待入口启用后仍未解决；另一次在真实浮框鼠标释放前移动处失败。先前这些运行已通过若干严格几何与旧镜头范围场景，但新精确画面／旁白 Host 提交场景尚未完整跑到，不能以 Studio 预填或 composer 单元替代。保留资源入口失败日志、当前失败日志和原断言，继续定位；本项不声称原因是锁屏，也不声称完整高级方案完成。

本轮只使用一次性 Profile／Project、测试图像和测试音，没有生产数据、付费模型或在线语音品質验收。实际源码保护、差异与剩余完整十项要求见本任务 outputs/bmw-studio-layout-implementation/visual-scope-manifest.json、visual-scope-actual.patch 和 completion-audit.json。

本轮最终 check 通过，官方 DSH 兼容脚本按 Node 入口运行并实际退出 0，检查冷装配、会话归属和设置控制，未发送模型输入。所有本轮证据日志位于 visual-scope-*.log；完整原生 Assistant 失败仍保留，不以 DSH 兼容通过替代其 UI／发送检查。

## 同一会话恢复与精确助手范围（当前专项）

同一 Project/Session 的 Studio 离开后返回，现在由实际 View 的暂停状态发送恢复通知；新增素材不再停留在旧 Renderer 快照。当前工作区恢复专项已终止并通过：原 WebContents、两次实际新增音频素材、同 owner 的 Session 通知、全草稿字段/版本不变，以及已准备预览的 0.75 秒位置和实际像素保持。证据在本任务 outputs/bmw-studio-layout-implementation/workspace-resume-focused.log 与 workspace-resume-focused/workspace-resume.json。此新增 desktop 分类是独立回归，完整 Studio 套件仍保留。

当前完整 native Assistant 套件已终止并通过：真实浮框几何/鼠标拖动、收起/停靠/窄窗/卡片往返、24 长中文镜头、独立图层/音轨及主旁白/主画面片段的首次输入范围、同一原会话、实际 Host FIFO receipt、非法/删除/外来范围拒绝及实际取消关闭。日志为 workspace-resume-assistant.log；使用隔离 Profile 和替身 backend，不代表付费模型或生产 Profile 验收。

当前完整 Studio 重跑在独立图层原生输出以后，未满足 Native Studio window and view focused 前置检查而失败；workspace-resume-full-retry.log 和旧失败日志保留。没有取消鼠标或像素断言，没有将 focused 专项当作完整套件通过，也没有由失败现象推定操作系统锁定。完整设计及全场景压力、真实媒体手势、后续效果/资源/审阅验收仍未完成。

### 独立对象淡入淡出连续性（2026-10-07）

本次在一次性 Project/Profile 中验证实际 Studio GUI 回调、真实 AAC 源和 H264/AAC 导出；不是付费模型、生产 Profile 或前台鼠标压力验收。独立视觉/音频对象在原淡入和淡出范围内分别两次分割，保留原身份/曲线，预览、卡片往返、明确重设/一步撤销和源文件 SHA 检查通过。混音最大样本差为 0，四个 MP4 抽帧平均像素差均为 0，输出音频 RMS 差为 0；已准备预览的四个平均像素差为 [0,0.006028645833333333,0,0]，维持原 <0.01 断言。真实产物在本任务 outputs/bmw-studio-layout-implementation/layer-fades-runtime；日志 layer-fades-native-flat.log。截图仅记录隔离编辑界面，不能代替真实前台属性操作验收。

90 项 Studio/媒体专项测试通过；最终分类报告 .bmw-runtime/classified-tests/2026-10-07T06-41-25-067Z/result.json 的 unit/contract/boundary 共 80 项通过、42 项不在请求层而未运行。实际 DSH 兼容脚本使用 plain Node，隔离运行通过，日志 layer-fades-dsh.log。构建通过；类型/文档/架构检查单独记录。当前完整原生 Assistant 的布局/精确范围提交证据仍见上一节，未由媒体专项替代。

验证中保留了失败日志：初次取样使用未对齐 range step 的时间导致等待失败；随后渐变背景在反复 getImageData 后出现 GPU/CPU 绘制抖动，临时数值修正无效并已撤掉。最终使用产品已有 minimal 纯色模板隔离效果验证，原精确混音、预览、MP4 和撤销断言均未放宽；仍记录字形边缘的微小预览差异。多次 eased cut 测试另发现生成曲线端点的浮点越界，修复仅约束生成值，用户契约不放宽。

原完整设计仍未完成：整镜头分割和复杂源/句锚点重绑定、其余有限效果、参考/生成素材、逐项测试审阅、制作取消/部分失败和完整工作流/压力验收继续保留。完整 Studio 的窗口/View 前台焦点前提仍未通过，不能声称当前全部原生鼠标交互验收通过。


## 原声字幕重映射与连续编辑事务（当前专项）

已核对原声 cue 现在由宿主保存源秒数、核对范围及稳定画面身份。修剪、变速、前置时长和调序复用原 cue，保留人工文字/译文；撤销可恢复原旧身份及隐藏的已核对句。旧绑定只承认可见核对区间；超出范围、替换身份或 SHA、同时模糊修改时间与字幕会拒绝，不扩大人工审核声明。生成端浮点边界在播放窗内计算，不放宽输入校验。

74 项 Studio 单元通过；最终分类为 80 passed、43 not-run，报告 /Users/changliangxu/Documents/ChatGPT/BMW/.bmw-runtime/classified-tests/2026-10-07T07-13-38-099Z/result.json。构建、类型/功能/架构及官方 Node DSH 隔离装配通过。源时间专项使用实际 GUI 修剪/变速/撤销/重做、共享 Host 调序、卡片往返、真实 AAC 源与 H.264/AAC MP4、双语 SRT/VTT。实际 MP4 与预览的全帧平均像素误差 0.4118359375，字幕区域 0.5816576086956522，原源 SHA 保持。该人工核对夹具不代表 ASR 质量；另一次实际本地 Whisper base 英语识别、监听修正、人工译文及横竖片输出专项已退出 0，证据复制自 .bmw-runtime/studio-next 到本任务 source-rebind-asr-runtime。后者发生于时间轴事务修复前，不替代其前台交互验收。

完整原生回归第一次实际通过前台焦点和鼠标前提，并发现主画面连续分割在保存后过早开放操作，可能仍选左片段。现在保存、选择和真实预览准备共用事务。新增原生 DOM/IPC 专项在两个连续切点刻意延迟真实预览，确认保存后分割/播放头仍禁用，准备完成自动选右片段，第二次分割目标正确。它不替代完整前台鼠标套件。修复后的两次完整回归均在 Native Studio window and view focused 前提失败；当时系统读取 CGSSessionScreenIsLocked=Yes，保留原断言和失败日志，尚未取得最终完整通过。

当前结果、各次失败、实际媒体和源码保护分别见本任务 outputs/bmw-studio-layout-implementation/source-rebind-*.log、source-rebind-final-runtime、source-rebind-manifest.json 和 source-rebind-actual.patch。未使用生产 Profile 或付费模型。整镜头分割与其余复杂锚点重绑定、剩余有限效果、参考/生成素材、逐项实验审阅、生产取消/部分失败与完整流程压力/用户验收仍按原十項目标推进，不能以专项通过声明全部完成。


## 可信历史恢复与原声稳定身份（当前专项）

Undo/Redo 沿用当前界面，由同 Project/Session 的服务签发精确内容证明。恢复删除镜头及原无片段 ID 状态保留已确认句锚点、原声根 cue、人工译文与实际音频测量；始终使用当前 CAS 和最新导出日志。另一服务实例、改写内容或归属、过期版本、取消及未知字段均拒绝，不回退或自动重放。普通编辑不能把已删除的稳定画面身份替换成同名无 ID 素材；未分段画面的镜头 ID 也不再误当画面片段 ID。停机先关闭请求准入，避免迟到的读取重新打开已关闭的素材句柄。

77 项 Studio 单元、80 passed／44 not-run 分类、构建、类型/功能/架构及官方 Node DSH 隔离装配通过。分类报告 /Users/changliangxu/Documents/ChatGPT/BMW/.bmw-runtime/classified-tests/2026-10-07T07-52-08-536Z/result.json。真实原生 DOM/IPC 两轮删除/撤销/重做保留原语音锚点、原声证据、人工译文并完成 Project SRT 与 640×360、12fps、4 秒 H.264/AAC 导出；实际编码报告为 passed，avc/aac 均可解码。最后验证停机后禁止重开；最终日志没有先前的素材清理后 ENOENT。

同一最终代码的源字幕专项通过真实 GUI 修剪/变速/撤销/重做、Host 调序和卡片往返，双语 MP4 与预览全帧平均误差 0.4118359375，字幕区域 0.5816576086956522。首次重跑在卡片切换刚显示但准入未结束时点击禁用按钮，超时；回归现在等待模式和可操作状态，不改变应用交互或内容/声音断言，最终通过。另一次最终代码实际本地 Whisper base 英语识别、试听/校正、人工译文保护及横竖 MP4 像素验收通过；不代表人类转写准确率或付费翻译效果。

证据保存在本任务 outputs/bmw-studio-layout-implementation/snapshot-restore-*.log、snapshot-restore-proof-runtime、snapshot-restore-source-final-runtime、snapshot-restore-asr-runtime、snapshot-restore-manifest.json 和 snapshot-restore-actual.patch。当前再次读取系统 CGSSessionScreenIsLocked=Yes，尚未补齐完整前台鼠标/焦点套件，不能用 DOM/IPC 专项替代。整镜头分割、其余复杂引用重绑定、更多效果、参考/生成素材、逐项实验审阅、制作取消/部分失败及全流程压力/用户验收继续保留，不宣称全部设计完成。

### 原始镜头时钟与明确静音的隔离验证

2026-10-07 当前镜头时钟源码完成顺序 build、check 与 100 项 Studio／媒体契约测试；分类 unit／contract／boundary 报告 .bmw-runtime/classified-tests/2026-10-07T08-11-45-190Z/result.json 全部所选项通过。新 media.scene-clock 专项实际比较原片与预先分配为三个子镜头的版本：13 个时刻 Canvas 像素最大差异为 0，双声道混音 PCM 最大差异为 0，静音前缀为 0；两份 640×360、12fps、7 秒 H264/AAC MP4 均实际解码，画面平均差异与声音差异均为 0，后续镜头编号／配乐保持。原生 Studio 专项再次通过真实删除与两轮签名 undo／redo、原语音／源证据／人工译文、SRT 和 H264/AAC 导出。证据为本任务 outputs/bmw-studio-layout-implementation/scene-clock-native/report.json 与 scene-clock-*.log；scene-clock-manifest.json 绑定当前代码哈希与保护审计。

专项只验证共享时钟、已分配子段的媒体行为和既有历史流程，不证明整镜头宿主／GUI 分割、源 AAC 跨镜头解码、复杂句引用分配、全部前台鼠标工作流或真实模型质量；这些及其他完整设计待办继续保留。

### 有限整镜头分割专项（2026-10-07）

当前新增六项契约，Studio／媒体合成共 106 项单元测试通过，最终构建与 check 通过；分类报告为 `.bmw-runtime/classified-tests/2026-10-07T08-31-56-328Z/result.json`，按 unit／contract／boundary 范围运行，不能声称全量前台／付费模型验收。实际隔离 Studio 使用原分割入口两次整镜头切割，保持右续段选择与原播放头，签名 Undo／Redo 恢复原身份和完整分镜，往返卡片／高级模式；锁定动画／人工双语字幕／原文件不变。实际源 AAC、局部／全局音轨、旁白和配乐的整段 PCM 差为零；两份实际 H264／AAC MP4 检查帧像素均值差及音频差为零。当前独立淡入淡出与原声字幕重绑定专项也分别复验；这些专项不代替前台鼠标／听审／压力或复杂整镜头绑定覆盖。

本轮起始 350 个已有作者文件逐个保护，未改范围哈希、Git HEAD／index 不变；详见任务 `outputs/bmw-studio-layout-implementation/whole-scene-manifest.json`。初次单元／原生夹具缺少可合成画面和可信人工译文路线，修正为真实约束；连续 redo 最初早于前一保存结束，改为等待真实控件可用，保留保存与历史断言。新增边界测试按省略字段保留约定显式清空旧音轨后通过。最终源码哈希和证据范围在 manifest 中记录，本节是测试后文档追加。句锚点／句聚焦／要点与原声字幕绑定当前明确阻止整镜头切割；原十项完整设计仍 active，参考生成、更多效果、逐项可选测试审阅及全流程验收继续待完成。

### 整镜头可信语音／原声字幕分配（2026-10-07）

本轮六项新增契约与既有 Studio／视频合成共 112 项测试，以及 MCP 目录两项契约通过（合计 114 项），最后构建与 check 通过；unit／contract／boundary 分类报告为 `.bmw-runtime/classified-tests/2026-10-07T09-04-02-241Z/result.json`（80 组 passed，47 组 not-run），不得称为全量前台／模型验收。新增私有来源字段、原时钟完整句投影、来源组成员／核对 cue 分配、实际文件变化与异步 hash 读取期间取消／CAS、原始请求不能造时钟，以及现有 correct-speech 的明确校正恢复均有对应契约。最初板书采用子段偏移相减再相加造成浮点端点差，现直接使用原值并保留严格比较；合法省略音频在来源验证前恢复，哈希夹具使用实际 canonical Project 目录。工具目录跨越 64KiB stdout 块后暴露了测试抢先解析片段的错误，测试现用 readline 等待完整 UTF-8 换行消息，继续严格断言唯一 browser 目录、RPC 身份和目录查询连接禁止执行；生产 MCP 发送协议未改。

三个隔离真实 Studio 案例分别运行句聚焦／锚点字幕、标题卡板书、原声字幕的两次整镜头切割，检查同一事务右段选择／原播放头、两轮签名 Undo／Redo、卡片／高级往返、锁定动画、局部／全局音轨及原文件不变。语音案例另从真实卡片移除旁白并单次撤销恢复私有来源时钟；原声案例明确保留 user-edited 人工译文和完整核对 roots／range。每个案例的完整原生混音采样差为零，两份实际 H264／AAC MP4 的检查帧像素均值差及音频差为零。证据为任务 `outputs/bmw-studio-layout-implementation/bound-scene-native-final/{voice,board,source}/whole-scene.json` 与前／后 MP4，完整源码哈希、受保护文件及 Git index／HEAD 核对见 `bound-scene-manifest.json`。声音是已知合成测试 tone，锚点／源 cue 为宿主夹具；这些验证投影和编辑连续性，不证明独立声学准确率、自动词级听审、付费模型、生产资料或前台鼠标覆盖。

原完整十项目标仍 active；任意复杂编辑的其余引用恢复、更多有限效果、参考生成、逐项可选测试审阅和全流程／取消部分失败／压力／用户验收继续待完成。本节为测试后文档追加，不将其冒充之前分类报告中的源码改动。

### 统一制作取消、部分失败与明确续做（2026-10-07）

五个隔离原生 Studio DOM／IPC 案例均 passed：第三段 provider 失败、第二段旁白期间取消／并发改稿、真正 H264／AAC 编码后提交前取消／并发改稿。已实测的合成 WAV 代替 TTS 服务，逐个检查人工双语字幕、已完成旁白和原 MP4 字节／日志保留；取消后按钮显示清理且不可重复操作，排空前另一个 IPC 命令拒绝。明确重试跳过有效旁白，每项都新增一份可解码 72 帧／6 秒 H264-AAC 成片；编码提交前取消／冲突删除当前未提交 MP4 和验证文件。首轮编码取消桩在返还回执前直接拒绝，无法覆盖宿主提交后的 rollback，已改为控制实际编码回执的返回边界；不将错误桩的遗留文件称为生产缺陷。

本次更改为 renderer 取消／恢复提示及两个专项脚本／目录，分类报告 `.bmw-runtime/classified-tests/2026-10-07T09-13-36-999Z/result.json`：80 组 passed，48 组 not-run；Studio／视频／MCP 114 项契约、构建和 check 均通过。证据为任务 `outputs/bmw-studio-layout-implementation/production-recovery-native-final/production-recovery.json`、五份 resumed MP4 与 interrupted 截图；源码／日志 hash、保护文件、HEAD 与 index 见 `production-recovery-manifest.json`。这些验证已完成编码的提交／清理边界，不证明所有编码中间点、真实服务／付费模型、生产 Profile、独立声学准确率或前台鼠标验收。完整十项设计继续 active；更多效果、参考生成、逐项审阅和剩余全流程验收仍未完成。

### 2026-10-07 可选逐项审阅专项

当前 stage 的保护基线/manifest 与证据位于 /Users/changliangxu/.codex/visualizations/2026/10/05/01a10c62-c77b-7422-a6cf-8dea4849503d/outputs/bmw-studio-layout-implementation/review-*.json、review-*.log 和 review-native-frames/。新增五项审阅 unit 测试验证持久只读建议日志、原值/CAS/归属/取消/Agent 采纳拒绝、有限预算与闭合校验、原音频与人工双语字幕保留、选择性撤销和原 Assistant 请求。Studio/视频设置/MCP 精确工具目录专项当前 102 项通过。分类 unit/contract/boundary 报告 .bmw-runtime/classified-tests/2026-10-07T09-27-14-347Z/result.json 为 80 项通过、49 项范围外未运行；新增 studio.review-adoption desktop 项另行显式运行，不把 not-run 记为通过。

BMW_STUDIO_REVIEW_CASE=1 的真实 Electron GUI/IPC 验收通过：所属 Assistant 收到 propose-review 任务，两个建议经单 browser action 实时出现；实际预览关键帧在建议日志更新后保留；第二镜头定位至全片 2.5 秒；标题单条采纳与撤销保留期间独立画面说明，旁白采纳只标该段音频待更新，撤销后恢复有效；陈旧标题建议禁用采纳且可忽略；重新加载保留三条处理记录。最终原 MP4 SHA/导出日志、原旁白及手工字幕不变。报告/截图/原 MP4 为 review-native-frames/review-adoption.json、review-adoption.png、retained-original.mp4。首次 fixture 过早检查异步 Assistant 请求，修正等待；后续严格验收发现关键帧被日志更新清除，修正内容未变时保留帧并保持原断言，最后通过。失败日志保留。

使用独立临时 Profile/Project、合成 WAV、真实媒体预览和原生编码输出；没有 paid Agent 推理、语义质量、声学真值、生产 Profile、全部前台鼠标操作或完整十项设计完成的声明。参考/生成资源、其余有限效果、复杂引用恢复及完整工作流/压力/用户验收继续保留。

新 schema 的中立 Agent/Browser 真实连接也通过：实际 MCP initialize/tools-list 严格只有 browser，Project GUI 共用页面、权限拒绝、伪造/外属/已释放 binding 与 Project 切换恢复均保留；fixture driver，不是 DSH/paid Agent 推理。最终 review-manifest.json 对照本阶段 353 authored 文件基线，18 个本次改动、336 个原有文件未变；13 个代码/UI 文件与最终分类报告源哈希一致，HEAD/index 未变。文档末尾追加后另跑 check；不将文档追加描述为先前报告的新哈希。完整 goal 仍未完成。

### 2026-10-07 参考素材分析专项

当前证据位于 /Users/changliangxu/.codex/visualizations/2026/10/05/01a10c62-c77b-7422-a6cf-8dea4849503d/outputs/bmw-studio-layout-implementation/reference-*.log、reference-native-complete/、reference-production-recovery/、reference-review-regression/，保护基线为 reference-baseline.json，最终文件/源哈希与证据索引为 reference-manifest.json。新增六项 Studio unit 验证不可伪造日志/内容不变、来源与 receipt 校验、实际帧成员/用户校正/明确 notes 采纳、完成后取消/CAS 回滚、真实 HTTP Bridge PNG 字节与返回前篡改、原 Assistant 参考身份/有限采样说明；新增 media-port unit 验证实际视频轨时钟与 AAC 尾部。五文件专项 114 项通过（reference-unit-range.log）；最终 unit/contract/boundary 报告 .bmw-runtime/classified-tests/2026-10-07T10-06-34-458Z/result.json 为 80 组通过、50 组请求范围外未运行。studio.reference-analysis desktop 项显式单独运行，not-run 不记为通过。

BMW_STUDIO_REFERENCE_CASE=1 的当前真实 Electron DOM/IPC/原生媒体专项通过：静态 640×360 PNG 与实际 H264/AAC 视频在 0/.75/1.5 秒返回三帧；实际 authenticated Bridge 输出分别一/三幅 PNG 且字节与 Project 一致；参考任务通过原 Assistant，作者提供的有限分析保存并在资源标记。明确加入原制作背景与签名 Undo/Redo 不改变脚本/语音/字幕/旧导出。媒体总时长约 2.0693 秒、视频实际区间 0–2 秒。点击第三帧在原视频定位 1.5 秒。真实 native frames 完成后持有 receipt，取消和期间 GUI 修改两种路径都等待清理，新命令准入拒绝、本次帧删除，旧记录与 MP4 保留，GUI 改稿不被覆盖。委托拒绝后关闭的弹窗不丢错误、分析不变、不重发；源文件变化后 Assistant/采纳禁用，弹窗和主状态均显示人可读恢复说明。reference-analysis.json、reference-analysis.png、sample-0…3.png 与 retained-original.mp4 为真实证据。

media-processing 原生回归通过：实际 WebM inspect、时间取帧/模型 PNG、图片标注绘制/封面、H264-AAC MP4 与 VP9-Opus WebM 转换、独立解码播放及取消清理；中立 Agent/Bridge 回归通过实际 MCP initialize/tools-list 只有 browser、Project GUI 页面、权限及 foreign/forged/released binding 拒绝、Project 切换恢复。当前制作恢复重跑五种 provider-failure/speech-cancel/speech-cas/render-cancel/render-cas，均保留已完成旁白/原 MP4，明确重试仅生成剩余旁白并取得实际可解码 H264-AAC。逐项测试审阅重跑通过定位、采纳、忽略、选择性撤销、陈旧拒绝、关键帧及原 MP4/旁白/手工字幕保留。

初次 native 夹具把 AAC 尾部的总媒体时长误当两秒画面终点，随后新增实际视频轨起止信息并保留严格取帧；第二次夹具的排队命令漏 Project 参数，修正为原签名且保留 Finish/cancel 准入断言。最后 GUI 复查发现 Electron 包装显示和弹窗关闭后的委托拒绝反馈缺失，修正并以实际 native 断言验证。失败日志和中间编译诊断保留，不以放宽断言代替修复。

全部使用独立临时 Profile/Project、实际原生媒体和 fixture Assistant/作者分析；没有付费模型或 TTS/AI 生成网络调用、语义分析质量、声学真值、生产 Profile 或完整前台鼠标/完整十项设计完成声明。build/check、文档目录与最终代码哈希校验分别记录；原十项范围、AI 生成与参考记录管理等未完成项继续保留。

## 卡片配对布局验证快照（2026-10-07）

产物根目录为 /Users/changliangxu/.codex/visualizations/2026/10/05/01a10c62-c77b-7422-a6cf-8dea4849503d/outputs/bmw-studio-layout-implementation。card-pair-renderer/component.json 记录实际编译 StudioCards、生产 HTML/CSS、原生参考 PNG 与 sourceHashes；1200/900/700/620/420 窗口下实测卡片宽度约 583/424/320/574/374px，只有 320px 卡片上下排列，其余左右配对。24 个长中文镜头全文、无横向溢出与跨选择/组件模式切换的 canonical DOM 身份通过。这是组件回调 fixture，不验证完整 Studio 保存/CAS/IPC 或前台输入。

card-pair-build-host.log 构建通过。当前 unit/contract/boundary 分类报告为 .bmw-runtime/classified-tests/2026-10-07T10-19-13-079Z/result.json，80 passed、51 not-run，未运行的原生/外部检查不能计为通过。docs:features/docs:architecture 已更新 card-pair 入口，最终静态检查与受保护源文件核对见 card-pair-manifest.json。

原生 card-pair-native 首轮取得 1200/900/620/420 布局截图，但因缺少真正窄卡片失败；新增 700px 测量后，card-pair-native-range 和 card-pair-native-host 均在首轮视口更新超时，实际 frames=0。系统检查确认 CGSSessionScreenIsLocked=Yes。完整 case 的断言未削弱，解锁后须补跑；现有截图/组件通过不证明新增完整模式保存冲突、播放头、Undo/Redo 或用户前台验收。无付费模型、外部生成服务或生产 Profile 测试。

## 参考记录管理验证快照（2026-10-07）

同一产物根目录下 reference-management-unit.log 为真实 VideoStudioService/Store 的 104 项草稿契约测试，包含新增两项记录管理契约；媒体处理为 fixture，不能计作真实新取帧或语义质量。管理覆盖八份额度恢复、用户/Agent 边界、Session/CAS/取消拒绝、已改变帧及已丢失源的移除、媒体/背景/内容保全、内容历史不恢复删除日志和重新取帧预算。

reference-management-renderer/management.json 与截图运行实际编译参考组件、生产 HTML/CSS、已保存原生 PNG 和真实 VideoStudioService/Store，经测试回调连接；检查默认折叠、满额后的移除/恢复取帧按钮、当前记录移除后禁用 Assistant、其他记录的实际 PNG、CAS 可读失败与显式重试、宽窄弹窗及源/帧哈希。它不覆盖 Electron IPC/原生前台或付费模型/provider。最终分类报告与受保护源文件、构建/静态检查日志见 reference-management-manifest.json。原十项设计未完成，严格 card-pair 原生 case 仍待解锁补跑。

解锁后的卡片原生补充：card-pair-native-prepared/card-pair.json 与五种宽度 PNG 为完整实际 DOM/IPC/Canvas case，24 镜头、完整中文与唯一 canonical 编辑器、预览固定、原声音详情、CAS 输入保留、模式往返保留图层/音频/手工字幕/1.25 秒播放头、签名 Undo/Redo 保留并发标题、旧 MP4/草稿保全均通过。原卡片 manifest 中 pending 是较早快照，最新证明在 reference-management-manifest.json。初次解锁补跑的 seek 失败源于测试在预览准备前写入初始 max=1 的滑杆，已改为先准备实测 48 秒全片再定位，1.25 秒断言保留；未更改产品播放头逻辑。

参考管理补充：实际组件检查还覆盖长素材名、丢失源记录的移除与冲突后当前记录显式“重新读取”；用作业完成状态等待最终控件，不把异步处理中禁用控件误判为完成状态。reference-management-native/reference-analysis.json 回归原生静态/视频 PNG、实际唯一 browser 图像、同会话委托、采用与撤销、取消/CAS 清理和源变化拒绝；分析由 fixture 作者提供，非真实模型语义质量。该原生回归没有直接调用新增 remove-reference，新增移除交互的证据仍是实际组件与真实服务回调和宿主契约；不能从此宣称新增移除 IPC/前台或付费服务验收。

## 精简顶栏与卡片视图记忆验收

`ui-finish-native-ready/card-pair.json` 与 `ui-finish-native-ready.log` 为当前新增 UI 的隔离原生 DOM/IPC/Canvas 证据：24 个长中文镜头、1200/900/700/620/420 五种窗口、固定预览、唯一 canonical 编辑器、两模式共用原菜单控件、单条高级内容入口、260px 卡片滚动位置与长画面意图展开往返、保存冲突保留输入、1.25 秒播放头、原图层/手工字幕/音频及签名 Undo/Redo 保全，原 MP4 SHA 与其他旧草稿不变。

首次验收发现高级重排污染滚动记忆，已修正仅记录卡片视图位置并关闭浏览器自动滚动锚定；下一次验收发现测试在 Undo 提交之后、GUI 清理完成之前点击仍禁用的 Redo，已加入明确就绪等待，保留全部内容断言。最终完整用例退出零。该证据不涵盖付费模型、生产 Profile 或前台鼠标用户体验。最终构建、check、分类回归及作者源码前后哈希见 `ui-finish-manifest.json`；完整十项工作流审计继续保留，未以本次有限验收声明全部完成。

## 空态、初稿通知与竖屏工作流验收

`workflow-entry-native-portrait/workflow-entry.json`、真实 `portrait.mp4` 与十四张截图验证了七种实际 Studio 状态（空会话、准备资料、竖屏卡片、高级编辑、交付、成片、二十四段待制作旁白），每种分别检查 1200/900/700/620/420 宽度无横向溢出。卡片和高级模式的播放控制另有十组可见区域检查。隔离 Project 中的 360×640 原生 MP4 实测 3.072 秒，单次明确制作点击即可交付，画面源和旧草稿/MP4 SHA 保留。

原生 IPC 验收证明：示例只填原会话输入；空背景能委托原 Assistant；委托本身不伪造分镜；实际受限 Agent update 的初稿在无待输入时自动打开卡片；待输入的背景被保留，明确重载后才进入卡片；准备资料详情关闭；审阅默认折叠；二十四个完整有效长度镜头名保留在折叠名单中，制作计划摘要保持简短。使用 authored Agent update fixtures，无付费模型或前台鼠标用户体验声明。首次检查暴露窄窗竖屏播放控件不可见，已按固定区域适配画面并加入真实几何断言。

测试目录增加 `studio.workflow-entry`；作者源保护、最终构建/check/分类与原有 Studio 回归见本线程 `workflow-entry-manifest.json`。完整设计仍需后续前台、压力/取消及其余规划能力验收。

最终作者源码的 `workflow-entry-native-final/workflow-entry.json` 和 `workflow-entry-card-final/card-pair.json` 均通过，原有完整 Studio 原生回归 `workflow-entry-studio-final.log` 退出零。原有旁白片段测试改为等待当前镜头及实际预览就绪，避免点击旧镜头或准备期间的控件；产品同步禁止预览准备期间分割。最终 build/check 和 unit/contract/boundary 分类回归通过（80 passed，52 项不在该分类运行范围内）；本次原生用例为单独执行的证据，不将分类未运行项算作通过。最终源码哈希、保全范围及日志索引见 `workflow-entry-manifest.json`。

## 高级时间轴分隔条（隔离原生验收）

`timeline-layout-native-final/card-pair.json` 在既有长中文卡片/原生媒体/CAS/撤销用例中验证分隔条：默认约 34% 编辑区；真实 Electron 鼠标拖动即时调整并在释放后保留，Esc 恢复起点；键盘调整及 Home/End 限幅；五种宽度下 640px 高窗口保留画布/播放控件；不同草稿独立比例和卡片往返保留。上述操作没有写草稿或修改已有 MP4。键盘不会在尚未结束的拖动中另存高度。原生输入测试不等于操作系统前台人工验收。

`timeline-layout-workflow-final/workflow-entry.json` 重跑七种状态与五种宽度，并完成实际 360×640 MP4；可选背景、归属委托、待输入保护、后台初稿、折叠交付摘要保持通过。最终构建/check、80 项 unit/contract/boundary 分类回归和作者源保全见 `timeline-layout-manifest.json`；52 项分类未运行项另列，不从本轮窄范围证明完整设计或真实模型质量。

## 独立图层／音轨对象菜单（隔离原生验收）

`track-menu-native-settled/track-menu.json` 验证实际 DOM/IPC 和 Electron 输入：时间轴菜单的键盘导航、Esc、Shift+F10/右键入口；1200/900/700/620/420 宽度下，菜单在真实 resize 回调及布局稳定后持续可见、没有越界；锁定参数与分割禁用，真实锁定轨道拖动不修改草稿；隐藏/显示对应真实预览像素。捕获菜单的旧 revision 在后台更新后关闭，旧按钮拒绝重放，用户标题保留；单步 Undo/Redo 和卡片往返保留对象、人工字幕及原增益。

同一 fixture 的原生预览混音 RMS 为 0.0323683，实际导出 AAC 为 0.0323680；静音后的二者 RMS 都为 0。源时钟、音量和已有 MP4 SHA 不改写。静音与锁定使用既有字段；锁定为既有编辑保护，不扩展为宿主权限。菜单打开时沿用原生聊天的遮挡处理。`track-menu-studio-ready.log` 完整原有 Studio 回归退出零，保留实际原生焦点与媒体断言；最终 build/check、分类 80 passed / 53 not-run 及源保全见 `track-menu-manifest.json`。

首次完整回归停在单次焦点恢复后的实际焦点等待，测试改为同一窗口的有界重新获取，仍要求窗口与 Studio 同时 focused。响应测试加入持续可见断言后发现其在 resize 回调完成前就打开菜单，被预期的 resize 关闭；已等待真实回调与布局，再保留持续可见检查。失败日志单独保存，未计为通过。以上证据不包括付费模型、生产 Profile、操作系统前台人工体验；截图仅记录编辑工作区，不从截图推断弹出菜单的持续可见性。

同时修正时间轴末尾的通用禁用刷新：只刷新片段和对象菜单按钮，随后按实际预览准备状态及所选对象锁定重算分割控件，避免把此前禁用的分割重新启用。

## 主旁白与画面片段原声静音

旁白属性增加“静音此镜头全部旁白”，使用闭合布尔字段 voiceMuted 保留 voiceVolume、实测音频、旁白播放片段和人工字幕。视频画面属性复用 keepSourceAudio，只切换选中的稳定画面片段，不改 sourceVolume、原秒数或原声字幕时钟；时间轴文字提示静音/原声关闭。静音或零音量旁白不再触发独立背景音的避让。GUI 保存、原 CAS、历史快照与同一预览/原生 AAC 混音保持一致。普通更新省略静音字段时保留；显式 false 取消静音；GUI 明确 undefined 可在历史恢复中清除。

最终实现构建与 check 通过，分类 unit/contract/boundary 80 passed、54 not-run；不执行的桌面项按专门原生回执另行验收。studio.main-mute 使用一次性 profile/Project，真实 DOM/IPC/WebAudio/原生 H.264/AAC 验证旁白预览 RMS 0.129477、AAC 0.129434，静音两者均为 0；第二画面原声关闭后第一片段 AAC RMS 0.077650，第二片段为 0；取消旁白避让后背景音 RMS 恢复 0.021579。验证原音量、实测音频、播放区间、人工双语字幕及旧 MP4 字节保留，单次撤销/重做、过期原声控件 CAS 拒绝和卡片往返不改草稿。完整 Studio 原有回归通过，含主轨/图层编辑、预览导出、原声时钟、会话隔离和删除/撤销。

可复查记录：outputs/bmw-studio-layout-implementation/main-mute-manifest.json、main-mute-native-final/main-mute.json、voice-audible.mp4、voice-muted.mp4、source-second-muted.mp4、main-mute-classified-verified.log、main-mute-studio-ready.log。原测试没有绕过契约：首次夹具补齐 zoom 和有效转场参数；完整回归中的字段编辑使用真实 input/change 顺序，保留保存与冲突断言。早期失败日志保留，不计入通过。

范围是已有设计的主轨声音操作，不代表完整设计、全部效果、真实模型或生产 profile 已验收。原十项完成审计继续保留。


## Finite visual effects (2026-10-07)

主画面及独立文字、矩形、图片和视频图层提供有限数值亮度、对比度、饱和度和模糊；属性默认折叠。最终实现构建通过，unit/contract/boundary 分类 80 passed、55 not-run。专用 studio.visual-effects 一次性 Profile 验证真实 DOM/IPC、Canvas 与原生 H.264：主画面预览/MP4 像素均为 [76,76,76]，独立图层均为 [24,24,24]，实际模糊边缘变化；人工字幕像素、原素材/旧成片 SHA、播放区间保留。复位、单次撤销/重做、导出日志后操作、锁定控件、冲突保留输入及卡片往返通过。原有完整 Studio 回归亦通过。

记录：outputs/bmw-studio-layout-implementation/visual-effects-native-ready/visual-effects.json、main-monochrome.mp4、main-and-layer-effects.mp4、visual-effects-classified-settled.log、visual-effects-studio-settled.log、visual-effects-manifest.json。初次专用测试等待被遮挡窗口的动画帧而超时，改等实际完成绘制的 transport 状态；初次完整回归在模式切换期间向禁用字段输入，改等控件启用后输入。原像素、保存和冲突断言均保留，失败日志不计入通过。当前报告记录实现源码，证据文档随后追加；不证明付费模型、外部服务、真实 Profile 或前台用户验收，不代表完整计划已经完成。


## Full-draft material preparation (2026-10-07)

统一“让助手准备素材”在目标与素材、高级素材资源区复用；零分镜草稿可用，提交先保存背景输入，固定所属全片上下文，阻止重复提交，沿用原 Assistant/Host 和 CAS。材料任务仅请求复用或采集真实 Project 文件并合并 preparation，界面接受真实后台更新；不把素材任务自行升级为分镜/旁白/成片制作。

构建、check、功能/架构清单更新通过。最终 unit/contract/boundary 分类 80 passed、56 not-run；原完整 Studio、官方 DSH 隔离装配及原生 Assistant 回归通过。专用 studio.materials-entry 在一次性 Profile 验证未保存背景先保存、并发双击只提交一次、全片范围冻结、过期 revision/外部 Project 拒绝、失败可重试及高级资源区复用。真实 browser 截图产生 640×360 PNG，通过原 video.studio update 后自动出现在零分镜 Studio 的此次素材列表；背景、已有镜头和原 source.png SHA 保留。

记录：outputs/bmw-studio-layout-implementation/materials-entry-manifest.json、materials-entry-native-verified/materials-entry.json、collected.png、materials-entry-studio-final.log、materials-entry-dsh-final.log、materials-entry-assistant-compact.log、materials-entry-classified-compact.log。早期夹具直接写 store 后误用任务通知刷新草稿，改为初始夹具显式加载；真实采集成果的自动列表验收保留。早期构建 DOM 类型错误和夹具失败日志不计入通过。浮框避让初次实测确认四个角均放不下原320px高度，改为自动选择240–320px的最大清晰高度并保持此打开实例；270px原生浮框验证所选画面不受遮挡，范围、输入、发送控件可见，拖动、取消、停靠、卡片往返及原固定输入验证通过。早期发送控件溢出经紧凑间距修复，原可见性和遮挡断言保留。当前回执证明原任务入口、真实本地采集、归属及结果呈现，不证明付费 Agent 自主研究、外部来源事实、专用 AI 生成服务或前台用户验收；完整设计目标仍有后续能力与验收。分类报告保存最终实现源码，证据文档随后追加。


## Optional subtitle review (2026-10-07)

可选测试版审阅沿用原入口，增加有限字幕样式及原文/译文/双语显示建议；前后对照显示中文标签，不显示对象串。保存建议只改日志，由用户逐项定位、采纳、忽略或撤销；null 明确表示未设置，撤销恢复字段缺省。旁白素材、实测元数据、字幕内容/时间/来源及其他人工编辑保留，过期字段、镜头时间、CAS、外部会话和 Agent 自行采纳仍拒绝。未新增常驻按钮、模型工具或 Agent 循环。

111 项 Studio 契约测试通过；最终分类单元/契约/边界 80 passed、56 not-run，构建、check、功能和架构索引通过。扩展原 studio.review-adoption 的隔离 Electron 验收通过：真实可读建议、用户 IPC 采纳与逐项撤销、原 voice/captions、旧 MP4 SHA 均保留。实际 Canvas 绿色字幕 982 像素，Canvas 与原生 H264 全帧平均 RGB 误差 1.3642；导出解码可播放。原完整 Studio 和官方 DSH 隔离装配回归通过。

证据：outputs/bmw-studio-layout-implementation/caption-review-native/caption-review.json、caption-review.mp4、caption-review.png、caption-review-manifest.json，以及 caption-review-*.log。分类源码报告为 .bmw-runtime/classified-tests/2026-10-07T13-13-41-837Z/result.json；验证文档随后追加。没有付费模型语义审阅、外部服务、生产 Profile 或用户前台验收覆盖。用户已明确本轮暂不加入专用 AI 图片/视频素材生成；该部分为后续范围。

DSH 最终回归使用正确 Node 入口 `node scripts/dsh-compatibility-smoke.js`，进程退出码 0。首次误用 Electron 启动器导致测试完成后额外主进程未退出，已结束本轮临时启动器，保留 caption-review-dsh-launcher.log；正式通过日志为 caption-review-dsh.log。


## Native card sorting (2026-10-07)

卡片拖动沿原草稿调序与保存闭环，使用前/后插入线、边缘自动滚动与原撤销；没有新增常驻按钮、IPC、模型工具或循环。捕获所属 Project/Session/草稿/revision。同版本任务/预览重绘恢复当前手势和落点；实际版本、归属或模式变化取消。未保存脚本先保存，随后捕获新的已保存 revision；先松手或取消不会在异步保存结束后重新开启拖动。

原 studio.cards-paired 扩展的隔离 Electron 原生输入验收最终通过：24 个长中文卡片五种宽度、固定预览、原声音/字幕详情、可调时间轴、模式保存冲突及原撤销重做保留；6 个镜头实际鼠标向前/向后插入，松手一次 CAS，镜头身份/字幕/旁白/图层逐项一致。同版本宿主任务通知保留手势；Esc、真实窗口失焦、区外移动后松手、外部 revision 和模式变化取消，原内容保留。短窗自动滚动、待保存脚本先保存、十二次视图往返通过。

证据：outputs/bmw-studio-layout-implementation/card-sort-native-release-ready/card-sort.json、card-pair.json、card-sort-final.png 和 card-sort-manifest.json。早期验收未等待布局绘制、错误选择近底部的滚动方向、未真实移动到松手位置；均保留原断言后修正。验收同时发现并修复同版本后台重绘取消手势的问题。活动手势中不使用可能改变视口的截图；插入线用实际原生事件、DOM/CSS（rgb(56,108,85) 3px 阴影）及无写入断言证明，截图在手势结束后保存。失败日志保留但不计入最终通过，不证明付费模型语义、真实 Profile 或人工使用验收。

最终构建、check、功能/架构索引及 unit/contract/boundary 分类 80 passed、56 not-run 通过；原完整 Studio 回归通过。对应实现源码报告为 `.bmw-runtime/classified-tests/2026-10-07T13-50-18-560Z/result.json`；文档验收记录随后追加，代码哈希逐项与报告一致。Git HEAD/暂存区及本轮之外作者文件保持不变，实际变更清单见 card-sort-manifest.json。
