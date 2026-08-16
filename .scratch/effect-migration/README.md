# Effect.TS restructure

Working folder for restructuring this repo from a ServiceNow MCP server into
`sn`, a local CLI on Effect.TS 4.0.

- **`spec.md`** — the spec. Start here.
- **`issues/`** — implementation tickets, worked in number order.
- **`research-effect-cli.md`** — cited primary-source findings on the Effect 4.0 CLI surface, its entrypoint pattern, and the stdout logging trap.

The architecture decisions live in the repo's real `docs/adr/`, not here — see
ADR 0004 through 0008, plus the amendment to ADR 0001.

## History

This folder originally held a portable documentation bundle for rewriting the
MCP server on Effect.TS **in a fresh repository**, with the server and its stdio
transport intact. Two of those assumptions were dropped: the work happens in this
repo, and the front-end becomes a CLI rather than an MCP server (ADR 0004). The
stack decisions survived and were carried into `docs/adr/`.

The `new-repo/` scaffold and its `build-effect-mcp` skill are gone (ticket 10).
The one transferable Effect rule — ground Effect 4.0 signatures against the
installed package, never invent them from memory — lives in
`.cursor/rules/effect-ts.mdc`.
