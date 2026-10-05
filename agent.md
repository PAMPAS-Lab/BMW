# BMW Agent entry

Browser is boundary, media is native, web is runtime.

Read [AGENTS.md](AGENTS.md), [handoff.md](handoff.md) and [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md).
`AGENTS.md` is the canonical coding instruction source.

BMW core owns Projects, browser pages, native media and conversation display. The default entry supplies createBmwAgentAssembly and the owned Assistant, with each official runtime retaining its Agent loop. Keep provider protocols, auth and catalog verification inside the corresponding harness package. Legacy DSH client/runtime ports remain for compatibility checks. Current supported models, login behavior and remaining limits are indexed in [PROJECT_STATUS.md](docs/PROJECT_STATUS.md). The full GPT-6 regression, later login-flow affected checks and paid two-turn acceptance are separate evidence snapshots in [VERIFICATION.md](docs/VERIFICATION.md); do not describe the older full report as a fresh run of newer source.
