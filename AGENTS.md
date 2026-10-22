# BMW repository guidance

Browser is boundary, media is native, web is runtime.

## Product contract

- This repository ships one application: BMW, id `bmw`, profile `BMW`, Chromium partition `persist:bmw`.
- BMW owns Projects, pages, media, Video Studio, permissions, settings and scheduled tasks. Pages and artifacts belong to a Project; conversations share that Project's resources.
- Exactly one model/MCP tool is allowed: `browser`. Add capabilities as validated browser actions. The authenticated Bridge publishes the effective catalog.
- The accepted product decision is one BMW application with DSH, Codex, Qoder CN and WorkBuddy adapters. Each official runtime owns its Agent loop. BMW Host coordinates input, Sessions, resources and UI; it must not implement a model loop.
- `apps/bmw/product.ts` assembles the drivers. Core packages depend on `agent-contract`, never concrete harness packages, provider RPC, client storage, selectors, presets or credential configuration.
- Provider launch/authentication, transport, tool catalog admission and wire-event normalization stay in their respective harness packages. BMW owns the conversation UI; native desktop history visibility is optional.
- A driver may release model input only after verifying an effective catalog containing exactly BMW `browser`. Prompt instructions or deny callbacks do not establish this boundary. Unverified runtimes remain unavailable.
- BMW Session IDs are stable and distinct from immutable per-driver resume anchors. Preserve legacy DSH Session IDs for Studio and schedule ownership. Persist input receipts before dispatch; uncertain delivery is never automatically replayed.
- Preserve Project/Session binding, FIFO operations, Project-transition exclusion, screenshot image admission, cancellation and Project-owned media. Await actual tool/worker cleanup before releasing admission; failed cleanup quarantines the resources until explicit cleanup recovery succeeds.
- Use Web APIs, sandboxed browser runtimes and bounded native browser adapters. Never expose shell execution, unrestricted host filesystem, credentials, cookie access, Electron IPC or FFmpeg CLI to the model.
- Remote and mobile control are independent future interfaces. Do not add chat software connectors, relays or connection settings.
- Shared implementations must not import apps. BMW has no runtime dependency on another product repository.

## Implementation

- Author implementations, plugins, scripts and tests in TypeScript. Generated JS/CJS/MJS are ignored compiler output; use NodeNext `.js` imports and `.cts` preload sources.
- Define typed contracts at package boundaries. Avoid new `any`; validate IPC, browser, driver and persisted input. Do not expand the frozen typecheck exceptions in `scripts/check-source.ts`.
- Keep existing user profiles, media and documents. Normal startup accepts only the current Agent data format. Historical DSH conversion belongs to the explicit migration command and its harness export; preserve all BMW Session IDs, native resume anchors and Studio/schedule owners. Never import the harness migration entry from normal runtime code. Never test against a production profile.
- Video actions live in `feature-video`; media decoding, processing, narration and export live in `media-native`. Draft updates use revisions; background tasks must not overwrite GUI edits.
- Prefer Mediabunny, WebCodecs, Canvas, WebAudio, WebGPU and MediaRecorder. General HTML import and a general video editor are outside the current contract.

## Verification and documentation

- AI news production must use authentic moving footage continuously throughout the first three seconds and replace suitable static sections with relevant real footage. A still, page scroll, animated screenshot, generated image or previous finished news video does not satisfy this requirement. Verify source identity and date; label archival footage throughout with its recording date, or explicitly its publication date when recording date is unverified. Missing qualified footage means an incomplete delivery, not a silent downgrade.
- Deliver a reviewable written script alongside each AI news video, including original-speech excerpts and Chinese translations when present, source links and dates. Verify material public responses and distinguish promises, proposed channels, execution details and actual delivery. Review the current exported MP4's critical states, all scenes and independent whole film; record technical checks and pending human listening separately. See `docs/NEWS_DAILY.md`.
- `docs/FUNCTIONAL_SPEC.md` describes current implementation and is authoritative. Update it with feature, schema, permission and boundary changes.
- Added, moved, renamed or removed tests require `npm run docs:features`. Keep README, handoff and status documents focused on the current product, not a change diary.
- Run build, check, unit tests and boundaries. Runtime changes also require the relevant DSH, desktop, Studio, media, video and narration checks.
- Electron/DSH checks use disposable userData/Home/Workspace. Never use real profiles or interact with operating-system credential prompts.
- Build commands clean generated output; run them sequentially. For resource-limited hosts use `GOMEMLIMIT=32MiB GOGC=1 GOMAXPROCS=1`.
- Do not claim paid-model, external-service or production-profile coverage from isolated unit/runtime tests.
