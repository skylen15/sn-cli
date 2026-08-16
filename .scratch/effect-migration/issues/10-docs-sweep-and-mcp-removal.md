# 10 — Docs sweep and MCP removal

Status: done

## What to build

The repo stops describing something it no longer is. An agent or a human reading
the docs after this ticket finds a CLI, with no path back to the MCP framing.

Finish `AGENTS.md`. An out-of-band pass already pruned it to the
`writing-for-agents` standard and corrected the claims that had gone stale by
ticket 04, so this ticket adds what only a finished CLI can describe — the full
command surface and the settled auth and config model — and holds that standard
while doing it: no restating `package.json`, `tsconfig.json`, or `sn --help`,
and material only some branches need sits behind a pointer. Rewrite
`README.md` for installing and using `sn`. Drop the MCP SDK and Inspector
dependencies, and the Inspector scripts, once nothing imports them. Delete the
`.env.example` client-credentials framing if it no longer matches ticket 03's
config shape, or correct it if it does.

Under this feature's folder, salvage anything genuinely transferable from the
`build-effect-mcp` skill inside `new-repo/` — its Effect 4.0 knowledge may carry
over even though MCP does not — into a correctly-named skill, then delete
`new-repo/` entirely. A skill with `mcp` in its name would actively mislead the
next agent.

Verify no stale references survive: the wrapper script, the Inspector, MCP tools,
`isError`, tool annotations, or the `dist` build.

Covers user story 37. Respects ADR 0004.

## Acceptance criteria

- [x] `AGENTS.md` describes the CLI, its commands, its auth and config model, and the pnpm toolchain, with no MCP references.
- [x] `AGENTS.md` holds the `writing-for-agents` standard: it caches no lookup the environment already answers, every pointer names its branches, and nothing describes the document's own migration state.
- [x] `README.md` documents installing `sn` and using every command.
- [x] The MCP SDK and Inspector dependencies and scripts are gone, and nothing imports them.
- [x] `new-repo/` is deleted, with any transferable Effect content salvaged into a correctly-named skill first.
- [x] A search of the repo finds no stale references to the wrapper script, the Inspector, MCP tools, or the removed build step outside of git history and this folder's own history section.
- [x] The full check script passes: type-check, lint, and all tests.

## Blocked by

- 03, 04, 05, 06, 07, 08, 09 (every command and the config work must land before the docs can describe the finished tool)
