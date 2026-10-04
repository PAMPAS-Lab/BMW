# BMW application composition

Follow the root [AGENTS.md](../../AGENTS.md).

This is the only application in this repository. Export the BMW product from `@bmw-agent/product-bmw` and select its sole Agent driver here. The product and core must remain independent of the driver's protocol, configuration, storage and UI implementation.

Profile: `BMW`. Partition: `persist:bmw`. Model tool: `browser`.

Browser is boundary, media is native, web is runtime.
