# BMW repository guidance

## Product and ownership

- This repository ships exactly one app: `bmw`. BMWVideo is the video/media product and its display name is **BMW**; BMWDev derives from BMW.
- BMW owns the browser/media/video foundation and `@bmw-agent/product-bmw`. Never import BMWDev, WVL, Dev Runtime or Dev state. Do not recreate the retired BMW Base or BMWVideo app identities.
- DeepSeek Harness is the only Agent harness. Do not implement another Agent loop.
- Exactly one model/MCP tool is allowed: `browser`. Add capabilities as browser actions, never extra tools.
- Dependency direction: app -> product/features -> platform/adapters. Shared implementation must never import apps. The MCP catalog is discovered through the authenticated Bridge.
- New capabilities use Web APIs, sandboxed browser runtimes, browser extensions or a browser-native Electron adapter. No Shell, unrestricted host filesystem, credentials, cookies, Electron IPC or FFmpeg CLI as model tools.
- Preserve Session/Project binding, FIFO operations, Project-transition exclusion, screenshot image admission and Project-owned media.
- No default chat software connectors. Future remote/mobile control is independent.

## Implementation and verification

- Author implementations, plugins, scripts and tests only in TypeScript. No tracked JS/CJS/MJS; they are disposable compiler output. NodeNext TS imports keep `.js`; preload sources use `.cts` -> `.cjs`.
- Define contracts at their owning package boundary; avoid new `any`; validate IPC, MCP, persisted and browser input. Frozen legacy typecheck exceptions are listed in `scripts/check-source.ts`; do not expand them.
- Electron and DSH tests must use disposable `userData`/DSH Home/Workspace, never a real profile.
- `docs/FUNCTIONAL_SPEC.md` is authoritative. Update human entries with changed/removed features, schemas, permissions and descriptions. Added/moved/renamed/removed tests require `npm run docs:features` and the refreshed inventory.
- Run `npm run build`, `npm run check`, `npm test`, `npm run test:boundaries`. Runtime changes also require the relevant `test:dsh-e2e`, `test:desktop-e2e`, `test:media-e2e`. Builds clean outputs; do not run build-containing commands concurrently in one checkout.
- Do not claim coverage from an unrelated test or describe planned video editing/real-model behavior as implemented.

## Product-specific requirements

- Reserve `video.*` for future production actions within `browser`; current Video Feature has no production actions, timeline or editor.
- Prefer WebCodecs, WebGPU, WebAudio, Canvas and MediaRecorder. Do not add FFmpeg without a separate architecture decision; never expose its CLI to DSH.
- Keep the existing `BMW` profile and `persist:bmw` identity. Do not silently migrate or delete legacy `BMWVideo`/`BMWDev` user data.
