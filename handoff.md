# BMW current handoff

Browser is boundary, media is native, web is runtime.

## Current implementation

BMW is the sole app in this checkout: id `bmw`, Profile `BMW`, partition `persist:bmw`. `apps/bmw/product.ts` composes `product-bmw` and the DSH driver. `scripts/product-entry.ts` injects that driver into the platform application.

`agent-contract` owns the provider-neutral runtime, client and context contracts. `harness-dsh` owns DSH launch/authentication, official WebSocket snapshots and mutations, managed preset/plugins, client selection/sidebar/settings and Composer integration. DSH remains the only configured Agent and owns its loop. Core packages do not import DSH or know its wire/DOM/storage format.

Projects persist per-driver bindings in `agentBindings`. DSH's compatibility adapter preserves existing Workspace/Session identifiers; obsolete connector settings are discarded. Projects, pages, documents, media and video draft revisions retain their identities. Independent driver bindings never overwrite one another.

`browser-capability` owns the single browser model tool, authenticated catalog, Project/Session operations, FIFO, transitions and image admission. Page viewport emulation preserves the native workspace surface; oversized capture layouts cannot resize it into the Assistant sidebar. `media-native` owns browser-based capture, Mediabunny/WebCodecs processing, narration and composition. `feature-video` owns Project drafts and integrated Studio.

Studio adds a shared whole-film checklist and measured read-only `check`, plus resumable sequential `narrate-pending` with per-scene revision commits, cancellation and online-TTS policy. Export uses the same measured gate; invalid source starts block even with hold, and regenerated/imported speech preserves independent caption endpoints. Image readiness now decodes static PNG/JPEG/WebP with shared byte/pixel budgets before export. Studio supports Project SRT/VTT (edited/estimated timing), up to eight visual segments per scene with cut/fade and continuous voice/captions, existing-session script/material Assistant intents, encoder preflight and durable JSON export verification. Local word alignment remains deferred: the installed Matcha cache provides synthesis only. Studio supports preparation materials, global/scene scripts, narration, footage matching, thumbnails grouped by scene usage, drag replacement, timeline selection, shared context, editable captions and native export. Settings provide named video/TTS templates. Default speech is Edge Yunxi male, with online narration enabled. Generated audio records its actual provider, voice and rate; script or generation-parameter changes mark it stale and block export until regeneration. Imports are labeled as imports. Legacy audio is retained and labeled parameters unrecorded. Captions and visuals do not invalidate narration.

Studio drafts now require immutable ownerSessionId from the authenticated Bridge or selected Studio view. Session changes flush edits and switch to isolated draft lists/selections, with an empty state when no draft exists. Foreign/legacy unbound drafts fail closed; migration is an explicit profile repair. Delete uses revision admission, moves the JSON record into a recoverable deleted directory, and preserves all Project assets/exports. Assistant intents route to the owning Session.

Visual material choices share bounded image/video thumbnails, full preview and list/icon views across preparation, matching, workbench, cover and segments. Delivery opens existing MP4s directly; render reuses only a host-recorded matching composition/file fingerprint, while forceRender explicitly remakes. Cover/notes edits do not invalidate video; changed content/files do. Legacy outputs remain manually viewable and downloadable.

Studio editing uses a canvas workbench with a Project media sidebar, contextual visual/voice/caption inspector with dedicated upper cover/delivery entry buttons, persistent transport and sequential-content timeline. Selection and seek follow the current scene; cover PNGs have an independent central preview. Global settings/templates live in a dialog, cover/delivery open from their upper entry buttons and delivery highlights only while active, delivery consolidates existing outputs and checks, and media job state stays separate from saving. Focused input is flushed before changing mode or selection; existing revision/history boundaries remain in force.

Studio also exports independent Project PNG covers from images, actual video frames or text, with saved title/subtitle/layout/color options, protected revision history, preview/download and cancellation/conflict rollback. Zero-scene drafts can make covers.

Assistant can inspect, annotate and draw Project images through `media.image.inspect`, `media.image.annotate` and `media.image.draw` on the sole browser tool. Fixed Canvas boxes/ellipses/arrows/lines/paths/text/opaque redaction use real pixel coordinates and bounded budgets. Outputs are new Project PNGs with actual decode verification and model image return; originals remain unchanged. Worker cancellation and post-finalization verification failure remove only current outputs. No HTML/SVG/code or arbitrary file/network surface is added.

Existing corrupt/unreadable Project, global settings, scheduled-task, permission, layout and login-continuity state and encrypted snapshots raises a preserved-state startup error with retry/exit. Only a genuinely missing file initializes. Failed login reads/decryption block background writes until explicit repair/reload; encryption becoming available requires reading and restoring the saved snapshot before capture. All Shell invokes use one main-process sender/main-frame/local-URL gate; Shell navigation/popups are blocked. Startup and first Project activation restore all saved tabs plus the active page without persisting a partial set. Renderer observations/media discovery/diagnostics have bounded phases and cancellation; media discovery never scrolls or waits for animation frames. Download cancellation drains the network/file pipeline before rollback and FIFO release.

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

Production macOS keychain authorization and real-profile desktop acceptance remain manual. Automated checks use an isolated mock keychain and do not prove the production authorization path.

No general NLE, arbitrary HTML import, chat connectors, remote/mobile client, signed installer or updater is implemented. Local TTS requires its pinned model cache; Edge depends on a fixed external service. Paid visual-model tests are explicit opt-in and are separate from runtime regression tests.

## Module interfaces and affected verification

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for nine owned modules, public entries, allowed runtime/type dependencies, eight interface guarantees and the categorized test catalog. Feature lifecycle, Browser Feature host and NativeMedia ports use named contracts with runtime admission and positive/negative compile consumers. Core/DSH separation and renderer privileges are checked using real TypeScript syntax.

Use `npm run test:plan -- --files <repository-relative-path>` then `npm run test:affected -- --files <path>`. Default affected compares against the last full passing hash baseline; unknown/deleted/shared configuration changes fall back to full offline coverage. Unclassified tests or missing guarantors fail closed. `npm run verify:stability` runs all offline categories and updates the baseline only on success. New reports live under `.bmw-runtime/classified-tests/`; earlier evidence remains.

Direct Browser and AgentDriver guarantees use the neutral driver fixture, including actual MCP tool discovery, Project page operations and identity/permission/switch recovery. Installed DSH compatibility and binding migration are listed separately as `bmw-dsh-assembly`. Browser model schema/catalog/Bridge/MCP-only changes select the neutral connection test; generic Agent contracts, DSH implementation, BMW assembly or full validation retain DSH coverage. The abstract contracts do not import the concrete driver.

Shared validation helper changes automatically select dependent runtime checks. Production-to-test imports/public exports and bare Node renderer imports are rejected. Production computed imports are forbidden except the declared fixed installed DSH package resolver; Browser protocol edits still do not acquire a DSH test dependency.
