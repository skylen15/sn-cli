# 01 — Toolchain and CLI skeleton

Status: ready-for-agent

## What to build

A globally-installed `sn` binary that answers `--help` and `--version` from any
directory, with no ServiceNow logic in it at all. This is the thin end of the
tracer bullet: it proves the runtime, the pin, and the install shape before any
domain code depends on them.

Migrate the package manager to pnpm. Pin `effect` to an exact `4.0.0-rc.109` (no
caret) and add `@effect/platform-node` at the matching version. Drop `zod` and
the `tsc`-to-`dist` build, keeping `tsc --noEmit` as type-checking only, and
enable `erasableSyntaxOnly`. Point the package's binary entry at the TypeScript
entrypoint with a shebang so Node 24's native type-stripping runs it directly.
Keep ESLint and Prettier, and give the repo a single combined check script that
chains type-check, lint, and test.

Stand up the entrypoint with `Command.make` for the root command, `Command.run`
with the version, `Effect.provide(NodeServices.layer)`, and `NodeRuntime.runMain`
— **not** `Layer.launch`, which is for long-running layer applications.

Covers user stories 1–4, 34. Respects ADR 0004, 0008.

## Acceptance criteria

- [x] `sn --help` and `sn --version` work from a directory outside this repo, after a global link, with no build step having run.
- [x] The pinned Effect version is confirmed to actually run — this is the smoke check the spec calls for, since `rc.109` was verified only as far as its exports map.
- [x] `erasableSyntaxOnly` is enabled and the repo type-checks clean under it.
- [x] The combined check script runs type-check, lint, and tests; formatting and lint pass.
- [x] No `dist` build step remains, and nothing depends on `zod`.
- [x] The MCP server still builds and runs unchanged at this point, or is left untouched — this ticket does not remove it.

## Blocked by

None — can start immediately.

## Comments

**Done.** `pnpm add --global .` puts `sn` on `PATH`; pnpm 11 dropped
`pnpm link --global`, and its global bin directory (`~/Library/pnpm/bin`) is not
on this machine's `PATH` yet — `pnpm setup` fixes that, and was left for the
operator rather than done by an agent.

**The zod tension.** The two acceptance lines "nothing depends on `zod`" and
"the MCP server still builds" cannot both hold: every old tool file imports zod.
Resolved on the "or is left untouched" branch — zod and the build are gone, the
MCP source is byte-identical on disk but excluded from `tsconfig.json` and the
test glob, and that exclude list shrinks as tickets 02–09 delete each file.
`@modelcontextprotocol/sdk` and the Inspector stay installed; ticket 10 owns
removing them. The `./sn` wrapper was already deleted before this ticket, so no
working ServiceNow path was lost.

**Smoke check.** `tests/cli/smoke.test.ts` drives the real entrypoint plus a
throwaway probe (`tests/cli/fixtures/effect-shape-probe.ts`) that exercises the
shapes ticket 02 onwards depend on: subcommands, a service layer with a
finalizer, `Config.redacted` from a `.env` overridden by the real environment, a
`Schema.TaggedError` carrying `Runtime.errorExitCode`, and the stdout/stderr
split. All confirmed running on `rc.109`, closing ADR 0008's open item.

**One entrypoint correction worth carrying into ticket 02.** The `Effect.tapCause`
that ADR 0007 and the research prescribe must also skip causes where
`Runtime.getErrorReported` is false. Without that guard a bare `sn` — which
fails with the CLI's internal `ShowHelp` — prints help to stdout *and* dumps a
stack trace to stderr while exiting 0.

**Two pnpm 11 gotchas the migration hit.** `pnpm link --global` no longer
exists — use `pnpm add --global .`. And pnpm re-verifies `node_modules` before
every script, wanting a TTY to confirm a purge, which kills `pnpm check` from CI
or an agent; `verifyDepsBeforeRun: false` in `pnpm-workspace.yaml` turns that
off. Don't reach for `confirmModulesPurge: false` instead — it makes pnpm purge
and reinstall silently, which is slower and hides the problem.

**Taken from ticket 10 after review.** `AGENTS.md` was left self-contradictory
by a half-finished edit: it still claimed zod, `rewriteRelativeImportExtensions`,
a yarn toolchain, the deleted `./sn` wrapper, and a deleted skill. Those were
corrected, and the Inspector scripts plus both MCP packages were dropped, since
nothing on the live side referenced them and the documented commands were
guaranteed to fail. Ticket 10 still owns the `README.md` rewrite and the
full-command documentation. `zod` survives only as a transitive dependency of
`@servicenow/sdk`, which is unavoidable and imported by nothing here.
