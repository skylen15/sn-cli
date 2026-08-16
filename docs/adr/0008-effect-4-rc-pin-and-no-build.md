---
status: accepted
---

# Pin Effect 4.0 RC exactly, and ship without a build step

`sn` pins `effect` to an exact `4.0.0-rc.x` version (starting at `rc.109`) with no caret range, and depends on the `effect/unstable/cli` namespace. The 4.0 line entered release candidates on 2026-08-14; starting a rewrite on the preceding beta line would buy a forced migration for nothing, and an RC is a stronger stability signal than a beta by definition. The `unstable` namespace is a deliberate, eyes-open dependency on a moving surface — hence the exact pin, so a version change is always something we chose.

Churn on the specific surface we depend on has been narrow: `Flag` and `Argument` were byte-identical from `beta.100` to `rc.109`, and the only breaking rename found across that range was `Command.withHidden` → `Command.unlisted`. The surrounding core is the greater hazard — several plausible-from-memory `Config` APIs do not exist — so verify against the installed package rather than recall.

**No build step.** `"bin"` points straight at `src/cli.ts` with a shebang, run by Node 24's native type-stripping and installed by linking globally. `tsc` remains only as `--noEmit` type-checking. The old `tsc`-to-`dist` build existed solely to produce an entrypoint for the MCP `bin`; with nothing publishing this package, it was ceremony. Type-stripping never sees Effect's own TypeScript, because Effect's exports map resolves to compiled `dist/*.js`.

## Consequences

- **`erasableSyntaxOnly` is on in `tsconfig.json`.** Node's type-stripping cannot handle enums, namespaces, decorators, or parameter properties; this makes the compiler reject them, turning the no-build setup from a hope into something enforced.
- **The first ticket carries a smoke check.** The CLI shape was verified end-to-end on `beta.107` — subcommands, generated `--help` and `--version`, `Config` and `.env` with `Redacted` secrets, service layers with finalizers, and custom exit codes — while `rc.109` was verified only as far as its exports map. Confirm the same shape runs on the pinned version before building on it.
- **Toolchain.** pnpm, with both ESLint and Prettier retained. `zod` is dropped in favour of Effect `Schema`, which the CLI's `Flag`/`Argument` params consume directly.

## Amendment: package subpath imports, not compiler path mapping

The no-build rule above stands. Imports across `src` and `tests` go through
package.json `"imports"` — a `#src/*` pattern mapping to `./src/*`, plus a bare
`#package.json` entry for the manifest — because Node resolves those natively
under type-stripping with no bundler. An ESLint rule then forbids
parent-relative (`../`) imports so the convention cannot erode one file at a
time.

**Compiler `paths` / `baseUrl` mapping cannot work here.** TypeScript would
type-check the aliased imports, then Node would fail at runtime: there is no
build step to rewrite specifiers, and Node's type stripping does not rewrite
them either. Do not "fix" the `#src/*` entries into `tsconfig` path mapping —
that combination type-checks and then breaks every process that imports through
the alias. Subpath imports were verified on Node 24 during design, including a
JSON import attribute through the manifest entry.
