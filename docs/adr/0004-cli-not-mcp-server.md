---
status: accepted
---

# `sn` is a CLI on Effect 4.0, not an MCP server

This repo was a ServiceNow MCP server over stdio. Local policy blocks registering a stdio MCP server as a native client (Cursor, Claude Desktop), so every call already went through a `./sn` wrapper that spawned the server, called one tool, printed JSON, and exited — MCP's session, capability negotiation, and long-lived process bought us nothing. We drop MCP entirely and expose the same ten operations as commands on a locally-installed `sn` binary, built on `effect/unstable/cli`.

This supersedes the direction planned (but never implemented) in `.scratch/effect-migration/`, which moved the stack to Effect.TS while keeping the MCP server and its stdio transport.

## Considered Options

- **CLI on `effect/unstable/cli` (chosen)** — the process shape matches how the tools were always actually invoked: one shot, one operation, exit. The consumer is a coding agent shelling out, which needs an argument vector and an exit code, not a JSON-RPC handshake.
- **Effect-native MCP server over stdio (the previous plan)** — rejected: it preserves a transport that nothing here can register natively, so the wrapper would have survived the rewrite.
- **Keep MCP and add a CLI front-end over a shared core** — rejected: two front-ends to specify, test, and keep in sync for a single consumer. The client seam (ADR 0001) means a second front-end can be added later if a real MCP client ever appears.
- **`@effect/cli`** — not an option, rather than rejected. All 450 published versions are on the `0.x` line, the newest peer-depends on `effect: ^3.22.1`, there is no beta or rc dist-tag, and `packages/cli/` has been deleted from the Effect monorepo's main branch. CLI support moved into the 4.0 core as `effect/unstable/cli` (13 modules: `Command`, `Flag`, `Argument`, `Param`, `Prompt`, `CliError`, `Completions`, …), present in the exports map of every 4.0 release from `beta.1` through `rc.109`.

## Consequences

- **Entrypoint.** `Command.make(name, { flags, args }, handler)` composed with `Command.withSubcommands` / `withSharedFlags`, then `Command.run({ version })` → `Effect.provide(NodeServices.layer)` → `NodeRuntime.runMain`. Notably **not** `Layer.launch`, which the MCP plan specified: it returns `Effect<never>` and exists for long-running layer applications, which is precisely what we are no longer building. `NodeServices.layer` supplies `FileSystem`, `Path`, `Stdio`, `Terminal`, and the environment-backed `ConfigProvider` that `Config` needs.
- **The command surface is frozen at the same ten operations** for the restructure — `query-table`, `get-table-schema`, `get-table-config`, `create-record`, `update-record`, `delete-record`, `batch-update`, `batch-delete`, `run-background-script`, `search-code`. Changing the stack and the surface at once would make any misbehaviour ambiguous. Additions that CLI-ness invites (stdin-piped `sys_id`s for the batch commands being the most tempting) are deliberately deferred.
- **Commands are flat and kebab-case**, one per former tool, with positional first arguments where a command has one obvious subject (the table name, the `sys_id`). This is a deliberate deviation from the repo's snake_case-at-the-seam convention: the argument vector is a new seam facing the shell, not a ServiceNow field. Verbatim `--sysparm-*` flags remain as the escape hatch, and snake_case flag names were confirmed to work on 4.0 — so this is convention, not necessity.
- **Hard to reverse.** Every command is shaped as an Effect `Command` with `Flag`/`Argument` params, so returning to MCP would touch all ten. The client seam is what keeps that cost bounded to the front-end.

## Amendment: the flat surface is superseded

The CLI-not-MCP decision stands. The consequences that the ten operations stay flat and kebab-case do not: ADR 0009 groups them under `table`, `record`, `batch`, and `script`, broken at 2.0.0. The ten operations themselves are unchanged; only the path that reaches them moved.
