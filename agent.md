# BMW Agent entry

Browser is boundary, media is native, web is runtime.

Read [AGENTS.md](AGENTS.md), [handoff.md](handoff.md) and [FUNCTIONAL_SPEC.md](docs/FUNCTIONAL_SPEC.md).
`AGENTS.md` is the canonical coding instruction source.

BMW core owns Projects, browser pages and native media. The application selects one Agent driver through `agent-contract`; the configured implementation is DSH. Keep driver protocols and client adaptation inside `harness-dsh`.
