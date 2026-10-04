# BMW verification

This document describes current verification boundaries. The authoritative capability/test inventory is [FUNCTIONAL_SPEC.md](FUNCTIONAL_SPEC.md).

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

Unit migration tests verify existing Workspace/Session IDs, Project documents and tab state survive while unused connector configuration is removed. Driver boundary tests forbid DSH imports, RPC and client storage/selectors in the core. The fixture driver test proves the core can operate through the contract without loading the DSH Agent process.

Studio workflow tests use deterministic narration fixtures to check UI routing and state. Those fixtures are not external TTS or model-quality evidence. Actual local speech is verified separately. Edge service checks require `BMW_TTS_TEST_PROVIDER=edge`; paid model vision requires `BMW_VISION_TEST=1`.

## Reproducible stability baseline

`npm run verify:stability` runs one fresh build, then checks, serial unit tests, boundaries, driver, startup retry/exit, DSH, all desktop groups, Studio, browser/background, capture, processing, composition and local narration. Each step records passed/failed/not-run, exit code, duration and logs. A failed build stops before the classified run and cannot produce an accepted baseline; a later failure does not hide independent checks. Source hashes, locked dependency versions, selected/excluded tests and reasons are included in `result.json` under `.bmw-runtime/classified-tests/`. Desktop evidence includes stage, native window state, bounded renderer captures or explicit capture errors. Native focus failures remain failures; production keychain and native desktop acceptance remain manual.

State tests cover Project/settings/tasks/permissions/layout/login configuration and encrypted snapshots: invalid JSON/version/shape, simulated read/decryption failure, missing-file initialization, valid legacy reload, blocked background writes and explicit repair/reload. Startup retry/exit runs separately for Project and each newly protected state kind. Shell IPC tests cover missing/destroyed/foreign/navigated senders; the neutral driver invokes every Shell preload channel with a real foreign WebContents and an actual child frame, then exercises normal Shell/MCP calls. Renderer tests cover cancellation, deadlines, navigation, renderer loss, FIFO recovery and late results. Downloads abort fetch and streaming writes before rollback. Narration tests cover actual parameter records, voice/rate changes, independent captions/visual edits, imported audio, legacy audio and metadata forgery rejection.

## Video Studio production upgrade verification

The 2026-10-04 Video Studio upgrade adds eight contract cases in `video-studio.test.ts`: timeline/coverage and source-range policy, read-only measured reports and shared probes, unsupported tracks/symlinks/inspection conflicts, partial failure/resume, cancellation/concurrent edits, caption endpoint/duration limits and online opt-out with partial cancellation. Native reply tests also reject malformed dimensions and alpha metadata. Studio Electron smoke covers focused-input batch submission, retaining current audio, read-only measured reports and issue-to-scene navigation alongside real image previews, H264/AAC export and audio mixing.

The complete serial offline report for this upgrade is written to `.bmw-runtime/classified-tests/2026-10-04-video-studio/result.json`; consult its individual statuses and logs for executed results. The original authored workspace is preserved in `/private/tmp/bmw-video-studio-before-20261004.tar.gz`. Capability review and follow-up priorities are in [VIDEO_STUDIO_REVIEW.md](VIDEO_STUDIO_REVIEW.md). That initial report predates native image inspection; the following enhancement now verifies actual image decoding. GUI narration providers are deterministic fixtures; actual local Matcha is a separate runtime check, and Edge/paid models remain opt-in.

## Video Studio next-step enhancement verification

The next-step upgrade covers native static-image header admission and real PNG/JPEG/WebP decode, corrupt/oversized files, cancellation/recovery, deduplicated aggregate budgets, H.264/AAC encoder preflight, SRT/VTT cumulative timestamps and timing provenance, Project text reads/exports, bounded visual segments and revision-safe Assistant intents. Studio runtime confirms oversized library pictures never enter createImageBitmap, then drives actual subtitle buttons, material/segment editor and fade, retains narration/captions, compares preview pixels to an independently played MP4 and checks the durable JSON report. The original-sound tests use real AAC with trim/rate and segment-local silence boundaries.

The complete serial offline report is `.bmw-runtime/classified-tests/2026-10-04-video-studio-next/result.json`. The first full run is retained separately in `2026-10-04-video-studio-next-initial-failures/`: it exposed an existing GUI-test save-settlement race and the new shared image contract missing from the local narration protocol allowlist. The test now waits for enabled controls and a bounded conflict gate; the isolated TTS protocol admits that fixed contract module. Source backup and delivery hashes are retained under `.bmw-runtime/video-studio-next/`. Fresh build/typecheck, boundaries, all classified tests, isolated DSH/desktop/Studio/media/video and real local narration must pass before delivery. Check individual result statuses and logs for the executed counts. No external Edge, paid model or production Profile is included. Assistant reception and Studio speech routing use deterministic fixtures; they do not establish model script/matching quality. Local word alignment was assessed but is not implemented; SRT/VTT visibly identify edited/estimated/mixed timing.

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

The source directory has intermittent filesystem read timeouts, and this host requires low-memory compiler settings. Final emit/typecheck, unit/boundary and driver checks run from an identical authored-source snapshot in `/private/tmp/bmw-refactor-authored-bcv7q5k2`; application dependencies and installed DSH are unchanged. The source hashes and log location are recorded in `result.json`. Source policy, Studio and media checks also run directly in the repository. Use `GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1` and serial test execution on this host. Infrastructure failures remain in `filesystem-read-failure.log`; they are distinct from test assertions.

Studio playback samples the audio clock with a frame-rate timer and cancels outdated playback. Visible material loading supplements IntersectionObserver with bounded render/scroll/resize layout scans. The real Studio check verifies playback with zero compositor frame callbacks. Negative ownership/conflict checks intentionally log rejected operations.

Production macOS keychain authorization is performed by the user. Isolated desktop verification does not establish production keychain acceptance; native acceptance and production Profile state are recorded separately from automated regressions.

Real-model synthetic image evidence is retained in [DEEPSEEK_FLASH_VISION_TEST.md](DEEPSEEK_FLASH_VISION_TEST.md) and `docs/vision-tests/`. Its scope does not extend to all natural images, small text, arbitrary webpages or complete autonomous video production.

External publication, paid model calls, operating-system prompts, signing/installers, updater and independent remote/mobile control are outside these standard regression checks.

## Module interfaces and affected checks

[ARCHITECTURE.md](ARCHITECTURE.md) is generated from module/catalog declarations and package exports. Node selection follows TypeScript AST dependencies; runtime checks automatically follow changed validation helpers and use explicit behavior watches/interface guarantors for production modules. Global boundaries remain selected for code edits. Unknown/deleted paths, shared configuration and unbounded validation imports require full offline coverage. Architecture checks reject production-to-test imports, public test exports, bare/prefixed/indirect privileged renderer imports and unbounded production imports. DSH’s single installed-package resolver is admitted only for its declared literal; extra computed calls are rejected. Categories are unit, contract, boundary, type, integration, desktop, media and opt-in external. Every authored test must be classified.

`npm run test:plan -- --files <repository-relative-path>` explains coverage. Use affected scope for local features, and include every file changed by that task. When the checkout already contains unrelated uncommitted work, derive the file list from a before/after source-hash snapshot rather than the entire Git status. `verify:stability` explicitly passes `--all`; full execution from that command is intentional, not selector fallback. `npm run test:affected -- --files <path>` executes that scope after one fresh build; `--module` and `--base` are alternatives. Default affected compares all hashes against the last accepted full run. Layer commands only check the requested category. Direct runner invocation rejects stale source/output receipts. Run `npm run build` before direct architecture commands on a fresh checkout. Only a successful full run with unchanged source updates the baseline. External services and production profiles remain separate.

## Direct contracts versus concrete implementations

Browser and AgentDriver direct guarantees do not require the installed DSH implementation. The neutral `driver` fixture captures Platform-injected `AgentRuntimeConfiguration`, launches only BMW's MCP adapter and calls real browser actions over authenticated Bridge transport. It verifies the sole browser tool, actual pages shared with GUI, permission denial, foreign/forged/released binding rejection and recovery after switching Projects. No Agent loop, model or DSH process is used.

`bmw-dsh-assembly` is a separate implementation/assembly guarantee. Agent contract, DSH implementation or product assembly changes select it; Browser schema/catalog/Bridge/MCP-only changes select the neutral fixture without starting DSH. Full offline verification still includes DSH. Selection regression tests enforce both the exclusion and the positive/mixed-change cases. Installed DSH smoke verifies startup/auth/prompt/session compatibility rather than direct Browser action coverage.

Computed-import fallback applies to affected shared validation source and directly changed runtime entries; unbounded production imports fail the architecture gate. An unselected runtime test entry is governed by its explicit watches; its unchanged dynamic loading of installed dependencies does not widen unrelated Browser coverage.
