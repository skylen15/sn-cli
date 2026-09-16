# AGENTS.md

Always address me as 'Barry'.

## Project

`sn`, a ServiceNow command-line tool on Effect.TS 4.0 (`effect/unstable/cli`).

Every ServiceNow HTTP call goes through one **client seam**,
`src/servicenow/client.ts`, which owns auth, refresh-on-401, and error mapping.
Read `docs/adr/0001-servicenow-client-seam.md` as amended before changing any of
those three. **Instance Guard** (ADR 0017) runs in `TokenSource` and blocks the
production and UAT **Blocked Instances** before network access. Glossary:
`CONTEXT.md`. `rule install` is local-only.

## Command surface

The globally linked **Read-only CLI** is the only distribution of `sn`: `table`,
`script search`, `auth`, and `rule install`. It has no ServiceNow mutation or
server-side script execution path. Flags, args, defaults, and DESCRIPTION come
from that leaf's `--help`. ADR 0019.

Stdout is compact JSON (ServiceNow payloads; `{"path"}` for `rule install`).
Diagnostics and errors on stderr with classified exit codes: ADR 0007,
ADR 0014.

## Auth

Now SDK OAuth Aliases in the machine keychain are the only credentials
(ADR 0018). Select with `--alias`, otherwise the SDK default under this policy:

- **TTY** → print Alias and hostname; only `y`/`yes` accepts. `--yes/-y` skips
  this confirmation only.
- **Non-TTY instance-facing leaf** → announce Alias and hostname on stderr and
  proceed.
- **`sn auth add|list|use|remove`** manage Aliases globally and skip default
  selection.

## Grounding

- **ServiceNow behaviour** — API shapes, table and field semantics, auth, token
  and session expiry, system properties — comes from the `sn-docs` skill
  (vendored Tier 1 official docs) rather than memory.
- **The Effect 4.0 surface** comes from the installed package under
  `node_modules/effect`. Several plausible-from-memory APIs do not exist;
  `.scratch/effect-migration/research-effect-cli.md` records what was checked.

## Conventions

`CODING_STANDARDS.md` holds the TypeScript design rules — errors as values,
parse-early, deep modules, real seams over mocks. Read it before introducing a
pattern, library, or abstraction. The rules below are the ones specific to this
repo.

- **Naming follows the seam.** Anything touching ServiceNow — record fields, API
  response keys, `sysparm_*` params, and the schemas mapping onto them — stays
  **snake_case**, matching ServiceNow verbatim with no translation layer.
  Pure-TypeScript names are **camelCase**. CLI flags are the documented
  exception and are kebab-case, because the argument vector is a seam facing the
  shell rather than a ServiceNow field (ADR 0004). ESLint cannot tell an SN
  field from an internal one, so hold this line by hand.
- **Schemas** are Effect `Schema`.
- **Tests** are `node:test` and `node:assert` — `@effect/vitest` is deliberately
  not adopted. Test doubles are Layers. Tests live under `tests/`, mirroring
  `src/`.
- **Commits** follow Conventional Commits: `type(scope): imperative summary`,
  scoped `cli`, `tools`, or `deps`, with a body explaining why rather than what.

## Toolchain

pnpm (`packageManager` in `package.json`). `pnpm check` is the one to run —
type-check, format, lint, then tests. One more is worth stating because nothing
in the repo reveals it:

- `pnpm add --global .` puts `sn` on `PATH`, and pnpm's global bin directory
  has to already be on it.

There is no build step: `bin` points straight at `src/cli.ts` and Node 24
strips the types. That is why `erasableSyntaxOnly` is on and why `effect` and
`@effect/platform-node` are pinned exact (ADR 0008).

## Pointers

- **Issues and specs** — starting a ticket, picking the next one, recording
  status: `docs/agents/issue-tracker.md`
- **Triage labels** — assigning or inventing a role label:
  `docs/agents/triage-labels.md`
- **Domain docs** — ubiquitous language, glossary disputes, or ADR context:
  `docs/agents/domain.md`
