# AGENTS.md

Always address me as 'Barry'.

## Project

`sn`, a ServiceNow command-line tool on Effect.TS 4.0 (`effect/unstable/cli`).

Every ServiceNow HTTP call goes through one **client seam**, `src/servicenow/client.ts`, which owns auth, refresh-on-401, and error mapping. Read `docs/adr/0001-servicenow-client-seam.md` as amended, plus ADR 0004 through 0009, before changing any of those three.

## Command surface

Five groups of leaves — `table` (`query`, `schema`, `config`), `record`
(`create`, `update`, `delete`), `batch` (`update`, `delete`), `script`
(`run`, `search`), `rule` (`install`). Flags, args, defaults, and each
leaf's DESCRIPTION: `sn <group> <leaf> --help` only. ADR 0009 (grouping) and
ADR 0013 (`rule`).

Shared: `--alias` overrides Alias selection (ServiceNow leaves only). Output
contract — stdout is compact JSON (ServiceNow payloads for SN leaves;
`{"path"}` for `rule install`); diagnostics and errors on stderr with
classified exit codes: ADR 0007, ADR 0013.

## Auth and config

Settled model (ADR 0005): walk up from cwd for `.env`, stop at `$HOME` inclusive, never above; first file wins; real environment variables override file entries.

- **No config anywhere** → Now SDK default Alias (Alias already carries `instanceUrl`).
- **Config present** → `SN_AUTH_TYPE` must be `now-sdk` or `client_credentials`. Mode is never inferred from which keys are set.
- **Alias selection** → `--alias`, then `SN_AUTH_ALIAS`, then the SDK default. On miss, the error lists Aliases on this machine.
- **`client_credentials`** → `SN_CLIENT_ID`, `SN_CLIENT_SECRET` (redacted), `SN_INSTANCE_URL`.
- **Trust boundary** → when a discovered `.env` is the source, one stderr line names its path and the instance host.

Shape template: `.env.example`. Interactive Alias setup: `pnpm now-sdk:auth`.

## Grounding

- **ServiceNow behaviour** — API shapes, table and field semantics, auth, token and session expiry, system properties — comes from the `sn-docs` skill (vendored Tier 1 official docs) rather than memory.
- **The Effect 4.0 surface** comes from the installed package under `node_modules/effect`. Several plausible-from-memory APIs do not exist; `.scratch/effect-migration/research-effect-cli.md` records what was checked.

## Conventions

`CODING_STANDARDS.md` holds the TypeScript design rules — errors as values, parse-early, deep modules, real seams over mocks. Read it before introducing a pattern, library, or abstraction. The rules below are the ones specific to this repo.

- **Naming follows the seam.** Anything touching ServiceNow — record fields, API response keys, `sysparm_*` params, and the schemas mapping onto them — stays **snake_case**, matching ServiceNow verbatim with no translation layer. Pure-TypeScript names are **camelCase**. CLI flags are the documented exception and are kebab-case, because the argument vector is a seam facing the shell rather than a ServiceNow field (ADR 0004). ESLint cannot tell an SN field from an internal one, so hold this line by hand.
- **Schemas** are Effect `Schema`.
- **Tests** are `node:test` and `node:assert` — `@effect/vitest` is deliberately not adopted. Test doubles are Layers. Tests live under `tests/`, mirroring `src/`.
- **Commits** follow Conventional Commits: `type(scope): imperative summary`, scoped `cli`, `tools`, or `deps`, with a body explaining why rather than what.

## Toolchain

pnpm (`packageManager` in `package.json`). `pnpm check` is the one to run — type-check, format, lint, then tests. Two more are worth stating because nothing in the repo reveals them:

- `pnpm add --global .` puts `sn` on `PATH`, and pnpm's global bin directory has to already be on it.
- `pnpm now-sdk:auth` authenticates the Now SDK and sets up `SN_AUTH_ALIAS`.

There is no build step: `bin` points straight at `src/cli.ts` and Node 24 strips the types. That is why `erasableSyntaxOnly` is on and why `effect` and `@effect/platform-node` are pinned exact (ADR 0008).

## Pointers

- **Issues and specs** — starting a ticket, picking the next one, recording status: `docs/agents/issue-tracker.md`
- **Triage labels** — assigning or inventing a role label: `docs/agents/triage-labels.md`
- **Domain docs** — ubiquitous language, glossary disputes, or ADR context: `docs/agents/domain.md`
