# BMW application composition

Follow the root [AGENTS.md](../../AGENTS.md).

This is the only application in this repository. Export the BMW product from `@bmw-agent/product-bmw` and assemble its DSH, Codex and Qoder CN adapters here. The product and core remain independent of provider protocols, credentials, native client storage and Agent loops. BMW's sandboxed Assistant UI communicates through the Host contract. Enable a driver only after its effective browser-only catalog has been verified.

Profile: `BMW`. Partition: `persist:bmw`. Model tool: `browser`.

Browser is boundary, media is native, web is runtime.
