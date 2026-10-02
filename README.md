# BMW

BMW is the short name of BMWVideo: a browser-native and media-native Agent product.

DeepSeek Harness is the only Agent harness. The model sees exactly one tool, `browser`. This independent repository builds one app; the retired three-product monorepo is historical material.

## Install and run

Requirements: Node.js 24+, local `dsh` compatible with `0.2.0-rc.2`, configured DSH model/credentials, and an Electron-capable desktop.

```bash
npm ci
npm start
```

`npm ci` installs this repository's workspaces from its own lockfile. It does not need the other repository. TypeScript is authored in place and compiles to ignored JS; `npm start` builds first.

Profile: `BMW`, Chromium partition `persist:bmw`, product preset `bmw` and DSH Home under this product's userData. Never use a real profile for automated checks. For disposable manual runs:

```bash
BMW_USER_DATA_DIR=/tmp/bmw-disposable npm start
```

## Architecture

```text
apps/bmw -> product-bmw (browser/media/video foundation)
                 -> feature-video + platform + harness-dsh
platform -> browser-capability + media-native + harness-dsh

```

BMW owns the foundation exported as `@bmw-agent/product-bmw`. Changes can be adopted by BMWDev at an explicit reviewed baseline; no runtime dependency points to BMWDev.

## Current capabilities

- Project-owned browser tabs, semantic observation and interaction, permissions, Settings, Session Center, encrypted opt-in cookie continuity and daily browser-only tasks.
- Project/Session-bound FIFO browser operations, safe Project transitions, PNG image results via official DSH MCP image handling.
- Screenshot/media discovery/download, browser-native video Capture, recording, media viewing and WebGPU/CPU processing.
- Video Feature namespace/lifecycle boundary, ready for browser-native production work.

Video editing, timeline/export pipeline, installers/signing/updater, standalone remote/mobile control and default chat connectors are not implemented. Real-model visual understanding and complete WVL UI workflows are not implied by unit tests.

## Verification

```bash
npm run build
npm run check
npm test
npm run test:boundaries
npm run test:dsh-e2e
npm run test:desktop-e2e
npm run test:media-e2e
```

Electron/DSH scripts create temporary profiles and do not call a paid model. Run build-containing commands sequentially in a checkout. [FUNCTIONAL_SPEC](docs/FUNCTIONAL_SPEC.md) maps behaviors to direct/indirect coverage; refresh its generated inventory with `npm run docs:features` after test/action changes.

Start contribution work with [agent.md](agent.md), [AGENTS.md](AGENTS.md), [handoff.md](handoff.md) and [the project review](docs/PROJECT_STATUS.md).
