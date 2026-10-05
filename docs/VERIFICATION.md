# BMW verification

This document describes current verification boundaries. The authoritative capability/test inventory is [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md).

## Current evidence and scope (2026-10-05)

Current application state is indexed in [PROJECT_STATUS.md](PROJECT_STATUS.md). Reports below are immutable source snapshots; later affected checks do not turn an earlier complete report into a fresh full run.

| Evidence | Executed result | Scope |
|---|---|---|
| [GPT-6 full offline snapshot](../.bmw-runtime/classified-tests/2026-10-05-gpt6-browser/result.json) | 112 selected offline checks and 5 gates passed; 5 external items not run | The GPT-6 wrapper source at that run; includes DSH, owned/default Assistant, desktop, Studio, native media, video and local narration |
| [Login-flow affected report](../.bmw-runtime/classified-tests/2026-10-05-login-flow/result.json) and [integration audit](../.bmw-runtime/classified-tests/2026-10-05-login-flow/integration-audit.json) | 32 selected checks and 4 gates passed; remaining categories excluded by scope | Later authentication/dialog/supported-model changes; no full media rerun or paid inference |
| [Native model evidence](AGENT_DRIVERS_IMPLEMENTATION.md) | Two real turns for the recorded DSH/Qoder/Codex models and all four wrapped GPT-6 models plus GPT-5.5 | Disposable Profiles; screenshot pixels, canonical Studio owner and native Session recovery; Qoder paid coverage is auto only |
| [Whisper base adoption](#user-listened-whisper-base-adoption) | Ten actual clips, 12 editable anchors, MP4/SRT/VTT/board and reuse passed | User-listened ASR-assisted reference; independent acoustic gold/P95 not established, automatic timing not approved |

The current architecture catalog has 12 modules, 10 direct interfaces and 3 implementation/assembly guarantors. Feature/test and architecture inventories are generated from the current source. This documentation synchronization checks current type/source/architecture gates, local links, recorded report statuses and source correspondence; it does not run a new full regression or paid model.

## Authentication and owned Assistant checks

`codex.settings`, `qoder.settings`, `dsh.settings` and `platform.agent-settings` exercise cold official control projections, missing authentication, unknown/disabled models, no model input, redaction, preference persistence after actual cleanup, cancellation and quarantine recovery. Codex selection asserts that the separate catalog gate is not invoked; its effective-tool gate still runs before actual input. Qoder cold control initialization still verifies its effective browser catalog and rejects any model work.

`assistant.application` uses an isolated Electron Profile and synthetic credentials to exercise GUI driver changes, automatic login dialogs, changing drivers during login only after native drain, clearing submitted/closed secrets, supported-only model display, confirmation/dialog close and blocked composer submission before model selection. The same fixture retains actual browser/screenshot/Studio ownership and shutdown checks. `assistant.default`, schedules, legacy retry and protected startup checks cover the declared downstream consumers. These fixtures do not establish real OAuth/key validity, production keychain behavior, account quota or paid inference for every supported model ID.

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

Unit migration tests verify existing Workspace/Session IDs, Project documents and tab state survive while unused connector configuration is removed. Driver boundary tests forbid concrete harness imports, provider RPC and client storage/selectors in the core. The fixture driver test proves the core can operate through the contract without loading the DSH Agent process.

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

Browser and AgentDriver direct guarantees do not require the installed DSH implementation. The neutral `driver` fixture captures Platform-injected `AgentRuntimeConfiguration`, launches only BMW's MCP adapter and calls real browser actions over authenticated Bridge transport. It verifies the sole browser tool, actual pages shared with GUI, permission denial, foreign/forged/released binding rejection and recovery after switching Projects. No Agent loop, model or DSH process is used.

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
