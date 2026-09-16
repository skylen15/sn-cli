# Spec: Guard for Sensitive Tables and Sensitive References

Status: ready-for-agent

Grounded in the grilling that produced ADR 0015 and the glossary terms
**Guard**, **Sensitive Table**, and **Sensitive Reference** in `CONTEXT.md`.
Read ADR 0015 before changing anything here. Exit-code and stderr JSON stay
under ADR 0007; auth/dotenv walk-up under ADR 0005; the HTTP client under
ADR 0001 (Guard sits *beside* that seam, not inside `request`).

## Problem Statement

Coding agents invoke `sn` with an Alias that can already read identity and HR
data the operator would rather not land in a model context. A `table query` on
`sys_user`, a Reference value on `incident.caller_id`, a dot-walk into a user
email, or a `script run` that dumps those Tables all succeed today whenever the
Alias can — instance ACLs do not express "not through this CLI."

There is no client-side policy: no shipped floor of out-of-bounds Tables, no
stripping of Sensitive References on otherwise in-bounds reads, and no way for
a project to *narrow* further without forking the tool. Operators who need
Background Scripts still need a path that agents cannot casually take.

## Solution

`sn` gains a **Guard**: a client-side policy module every instance-facing leaf
consults before talking to ServiceNow.

**Sensitive Tables** (shipped Exact set plus every Table that extends one) are
out of bounds as *targets* — hard fail before HTTP, `SnGuardError`, exit 9.
Inheritance resolution is fail-closed.

**Sensitive References** keep the parent Table in bounds but keep the field
value off the wire on reads; Encoded Queries, field lists, and dot-walks that
touch them are rejected; write payloads that set them are rejected; write
responses strip those values on stdout. Schema/config may still *name* a
Reference target so callers understand the strip.

The Guard is always on. A walk-up `.sn-guard` may only *add* Sensitive Table
names (project-narrow-only). `script run` requires a once-per-invocation TTY
confirm; non-TTY fails closed. `rule install` stays local and out of scope.

## User Stories

1. As a coding agent, I want `table query` on a Sensitive Table to fail before
   any HTTP call, so that user/HR rows never enter my context.
2. As a coding agent, I want `table schema` on a Sensitive Table to fail the
   same way, so that I cannot invent a "metadata only" bypass.
3. As a coding agent, I want `table config` on a Sensitive Table to fail the
   same way, so that reconstructing configuration is not a side door into
   identity Tables.
4. As a coding agent, I want `record create|update|delete` targeting a
   Sensitive Table to fail before HTTP, so that writes are not a bypass of the
   read Guard.
5. As a coding agent, I want `batch update|delete` targeting a Sensitive Table
   to fail before HTTP, so that by-list writes are covered too.
6. As a coding agent, I want `script search` not to treat a Sensitive Table as
   a searchable Artifact target when the Engine would otherwise hit it, so that
   code search does not become a Table dump of identity/HR.
7. As an operator, I want a Table that *extends* a Sensitive Table treated as
   Sensitive, so that a custom `u_employee` extending `sys_user` is not an
   open hole.
8. As an operator, I want inheritance resolution to fail closed when the chain
   cannot be resolved, so that "we could not tell" never means "allow."
9. As a coding agent, I want `table query incident` to still succeed, so that
   ordinary work Tables remain usable.
10. As a coding agent, I want Sensitive Reference field values omitted from a
    successful query request, so that `caller_id` (and kin) never ride the wire
    on reads.
11. As a coding agent, I want an Encoded Query that filters on a Sensitive
    Reference to be rejected, so that a user `sys_id` in `--query` is not an
    identity handle I can probe with.
12. As a coding agent, I want `--fields` that name a Sensitive Reference or
    dot-walk into a Sensitive Table to be rejected, so that
    `caller_id.email` is not a disguised user-Table read.
13. As a coding agent, I want `table schema` on an in-bounds Table to still
    name Reference targets that are Sensitive Tables, so that I can see why a
    field will be stripped without receiving Record values.
14. As a coding agent, I want `table config` on an in-bounds Table to keep
    working when related metadata merely *mentions* Sensitive Table names, so
    that configuration reconstruction is not blocked by Name-ok references.
15. As a coding agent, I want `record create|update` to reject a payload that
    sets a Sensitive Reference, so that I cannot write identity handles through
    `sn`.
16. As a coding agent, I want Sensitive Reference values stripped from write
    responses on stdout even when ServiceNow returned them, so that the CLI
    contract stays Guard-shaped after a successful write.
17. As a coding agent, I want batch item payloads that set Sensitive References
    rejected per the same write rules, so that batch is not a softer path.
18. As an operator, I want the shipped Sensitive Table set to include
    `sys_user`, `sys_user_group`, `sys_user_grmember`, `sys_user_has_role`,
    `cmn_location`, `cmn_department`, and `sn_hr_core_profile`, so that the
    common identity/HR surface is covered without per-project setup.
19. As a project owner, I want a `.sn-guard` file that only *adds* Sensitive
    Table names, so that I can narrow further for this repo without weakening
    the shipped floor.
20. As a project owner, I want `.sn-guard` discovery to walk up from cwd to
    `$HOME` inclusive (first file wins), so that it matches how `.env` already
    behaves.
21. As a project owner, I want `.sn-guard` to reject any attempt to remove
    shipped names or disable the Guard, so that compliance cannot be opted out
    of via a project file.
22. As an operator, I want no `--no-guard` / env kill switch, so that agents
    cannot learn a flag that voids the policy.
23. As a human operator at a TTY, I want `script run` to prompt once per
    invocation before executing, so that Background Scripts remain available
    when I deliberately confirm.
24. As a coding agent (non-TTY), I want `script run` to fail closed without a
    prompt loop I can fake, so that remote code execution is not an unguarded
    escape hatch.
25. As a coding agent, I want Guard failures as `SnGuardError` JSON on stderr
    with exit code 9, so that I can branch differently from auth (3) or
    request (4) failures.
26. As a coding agent, I want Guard error messages to name the Sensitive Table
    or Sensitive Reference involved, so that I can correct the command without
    guessing.
27. As a developer, I want `rule install` unaffected by the Guard, so that
    local filesystem Rule install does not pretend to be an instance policy.
28. As a developer, I want Display Value mode irrelevant to whether a
    Sensitive Reference is requested, so that `display-value=true` is not a
    bypass for names on References we refused to fetch.
29. As a coding agent, I want verbatim `--sysparm` overrides that would re-add
    stripped fields or smuggle a Sensitive Table path to still be subject to
    the Guard, so that escape hatches in raw params do not void T1/T2.
30. As an operator, I want the Guard to apply under both `now-sdk` and
    `client_credentials` auth, so that auth mode is not a policy bypass.
31. As a coding agent, I want repeated Guard denials to be deterministic and
    side-effect free (no partial writes, no partial script execution), so that
    retries after fixing args are safe.
32. As a developer writing tests, I want to exercise Guard policy without a
    live instance, so that T1/T2/query/TTY/`.sn-guard` behaviour is locked in
    CI.
33. As a developer writing CLI tests, I want a thin proof that leaves consult
    the Guard (no HTTP on T1 deny; non-TTY `script run` fails), so that a
    missed call site cannot silently regress.
34. As an operator, I want adding a table name to `.sn-guard` to automatically
    treat References *to* that Table as Sensitive References, so that one list
    drives both T1 and T2.
35. As a coding agent, I want empty or missing `.sn-guard` to mean "shipped
    defaults only," so that projects without a file still get the floor.
36. As an operator, I want `#` comments and blank lines ignored in `.sn-guard`,
    so that the file stays readable.
37. As a coding agent, I want Guard checks to run after Alias/config resolution
    succeeds but before ServiceNow data-plane calls, so that auth errors stay
    auth errors and Guard errors stay Guard errors.
38. As a human who confirmed `script run` at a TTY, I want a clear stderr
    prompt that names Guard and remote code execution, so that Enter/`y`
    is an informed choice.
39. As a coding agent, I want only `y`/`yes` (case-insensitive) to accept the
    TTY gate, so that accidental Enter does not run a Background Script.
40. As an operator, I want documentation (help text / ADR pointer) that states
    the Guard exists and is always on, so that surprise denials are explainable.

## Implementation Decisions

- **Primary seam: one Guard module** with a small interface and deep
  implementation. Every instance-facing leaf consults it before HTTP. Do **not**
  fold Guard into `SnClient.request` — leaves do not share one HTTP shape
  (Table API vs code search vs `.do` Background Script), and T2 needs Encoded
  Query / field-list semantics.
- **Error taxonomy:** add `SnGuardError` with exit code 9; include it in the
  tagged error union and stderr JSON helper alongside existing `SnError`s.
  Never renumber 3–8.
- **Shipped Sensitive Table set (Exact):** `sys_user`, `sys_user_group`,
  `sys_user_grmember`, `sys_user_has_role`, `cmn_location`, `cmn_department`,
  `sn_hr_core_profile`. Ext = any Table whose inheritance chain includes one of
  these (or a project-added name).
- **Policy load:** walk-up discover `.sn-guard` with the same cwd → `$HOME`
  stop rules as `.env` (ADR 0005). Parse one Table name per line; `#` starts a
  comment; union into the shipped set; ignore attempts to remove or disable
  (malformed "off"/negation lines are errors or no-ops that never widen access —
  prefer hard fail on unrecognized directives so silent weaken is impossible).
- **T1:** if the target Table is Sensitive → `SnGuardError`, no data-plane
  HTTP. Applies to table/record/batch leaves and to any script-search path that
  would target that Table as an Artifact.
- **T2 discovery:** resolve Reference targets via Dictionary metadata for the
  in-bounds Table (existing schema/inheritance machinery as adapters behind
  the Guard, not a second public seam). Fail closed if targets cannot be
  resolved when the operation needs T2 enforcement.
- **T2 reads:** omit Sensitive Reference columns from the outbound field set;
  if the caller explicitly asked for them (or dot-walked), reject instead of
  silently omitting. Reject Encoded Queries that reference those fields or
  dot-walk into Sensitive Tables.
- **T2 metadata:** schema/config may expose Reference *target names* (Name-ok);
  never Record values.
- **T2 writes:** reject payloads that include Sensitive Reference fields;
  scrub those keys/values from stdout JSON on successful write responses
  (best-effort strip; reads remain the off-the-wire path).
- **`script run`:** Guard `allowScriptRun` — if stdin is not a TTY, fail; if it
  is, print a once-per-invocation confirm on stderr; accept only `y`/`yes`;
  then proceed to existing Background Script paths (ADR 0002).
- **No kill switch:** no flag, env var, or `.sn-guard` directive disables the
  Guard or removes shipped names.
- **`rule install`:** unchanged; local filesystem only.
- **Auth modes:** Guard is independent of `now-sdk` vs `client_credentials`.
- **Raw sysparm / path smuggling:** Guard enforcement is on the *operation's
  Table and field semantics* the leaf already knows; leaves must not forward
  caller-controlled params that retarget a Sensitive Table or reintroduce
  stripped fields after Guard preparation.
- **Trust announcement:** optional one-line stderr when a `.sn-guard` file was
  the project-narrowing source (path only, no secrets) — mirror the `.env`
  trust-boundary spirit without breaking ADR 0007 stdout rules.

## Testing Decisions

- **Good tests** assert external behaviour through the Guard interface (and a
  few CLI leaves): denials, allowed operations, stripped/rejected inputs,
  exit code 9 / `_tag`, TTY vs non-TTY — not private helpers or call graphs.
- **Primary surface:** unit/integration tests of the Guard module with fake
  Dictionary and inheritance adapters (no live instance): shipped set, Ext
  fail-closed, `.sn-guard` union-only, T2 field/query reject and read omit,
  write reject + response strip, script-run TTY gate.
- **Secondary surface:** thin CLI tests in the existing `tests/cli/...` style
  with Layer fakes for `SnClient` — prove a representative T1 deny makes zero
  requests; prove non-TTY `script run` fails with `SnGuardError` before
  execution.
- **Prior art:** `tests/servicenow/config.test.ts` (walk-up discovery),
  `tests/servicenow/inheritance.test.ts` (chain), `tests/cli/table/query.test.ts`
  and `tests/cli/script/run.test.ts` (command + Layer doubles),
  `tests/servicenow/client.test.ts` (error tagging patterns).
- Prefer `node:test` / `node:assert` and Effect Layers; no new test framework.

## Out of Scope

- Replacing or weakening instance ACLs / roles; the Guard is not a server-side
  control.
- Field-level PII denylists on non-Reference columns (emails stored as plain
  strings on in-bounds Tables) — T3 from grilling, deferred.
- Allowing projects to remove shipped Sensitive Tables or disable the Guard.
- Interactive confirm gates on `record`/`batch` writes (human approve remains
  an agent-process concern, not this feature).
- Redacting Sensitive Table names from script *source text* returned by
  `script search` Hits (string literals in code are not T1/T2 Record access).
- A GUI or Now SDK change; this is `sn`-only.
- Automatically syncing the shipped list from a live instance catalogue.

## Further Notes

- Glossary and ADR 0015 are the vocabulary source of truth; keep ticket language
  aligned (Guard / Sensitive Table / Sensitive Reference — not "rule", "filter",
  or "sanitizer").
- After this spec is split by `/to-tickets`, implement blockers-first with
  `/implement` + `/tdd`, clearing context between tickets.
- Tracer preference: ship `SnGuardError` + T1 Exact deny on one read leaf
  first, then Ext, then T2, then `.sn-guard`, then TTY `script run`, then
  remaining leaves — so each ticket leaves the CLI stricter than before.
