# BMW Agent entry

Browser is boundary, media is native, web is runtime.

Read [AGENTS.md](AGENTS.md), [handoff.md](handoff.md) and [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md).
`AGENTS.md` is the canonical coding instruction source.

BMW core owns Projects, browser pages, native media and conversation display. The default entry supplies createBmwAgentAssembly and the owned Assistant, with each official runtime retaining its Agent loop. Keep provider protocols, auth and catalog verification inside the corresponding harness package. The application has one owned Host/UI entry. Core Projects contain no native Workspace or Session fields; DSH Workspace mappings live in its harness-owned file. Old Agent data is converted only by the explicit migration command, with backups and stable owner IDs; normal startup refuses old formats. Current supported models, login behavior and remaining limits are indexed in [PROJECT_STATUS.md](docs/PROJECT_STATUS.md). The unified Agent-data offline report, earlier GPT-6/login-flow snapshots and paid two-turn acceptance are separate evidence snapshots in [VERIFICATION.md](docs/VERIFICATION.md); do not describe the older full report as a fresh run of newer source.
