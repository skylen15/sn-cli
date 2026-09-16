---
status: superseded by ADR-0017
---

# Guard keeps Sensitive Tables and Sensitive References out of `sn`

`sn` is agent-first: a careless `table query sys_user` or a Reference value on `incident.caller_id` lands identity/HR data in a model context. Instance ACLs still apply, but they do not stop an authorised Alias from reading what the Alias can read. The Guard is a **client-side** policy for accidental exposure and a compliance floor — not a security boundary against a hostile holder of those credentials.

**Sensitive Tables** are a shipped Exact set — `sys_user`, `sys_user_group`, `sys_user_grmember`, `sys_user_has_role`, `cmn_location`, `cmn_department`, `sn_hr_core_profile` — plus every Table that extends one (Ext). Inheritance resolution is **fail-closed**: if the chain cannot be resolved, the operation is denied. Any instance-facing leaf that _targets_ a Sensitive Table hard-fails **before** HTTP with `SnGuardError` (exit code **9**). `rule install` is local-only and out of scope.

**Sensitive References** (T2) are References whose target is a Sensitive Table. The parent Table stays in bounds; the field's value does not. Reads omit those fields from the request (never fetch-then-redact). Encoded Queries, `--fields`, and dot-walks that touch a Sensitive Reference are rejected outright — a user `sys_id` in a filter is still an identity handle. Schema/config may name the Reference _target_ (Name-ok) so callers can see why a field is stripped; they must not surface Record values. Writes reject a payload that sets a Sensitive Reference; responses still **strip** those values on the way to stdout, accepting that ServiceNow may have put them on the wire once.

**Always on, project-narrow-only.** There is no `--no-guard` / `SN_GUARD=off`. A walk-up `.sn-guard` (same cwd → `$HOME` stop as `.env` in ADR 0005) may only _add_ Sensitive Table names; it cannot remove shipped defaults or disable the Guard. That favours compliance over an agent-shaped escape hatch.

**Background Script.** `script run` is remote code execution with the Alias's full rights, so a table-only Guard would be theatre. It stays available to a human via a **TTY gate**: each invocation prompts once on stderr; non-TTY (typical agent) fails closed. Permanent deny was rejected as too blunt for operators who still need the leaf; a `--force` flag was rejected because agents learn flags.

## Consequences

- **Exit code 9 is now part of the ADR 0007 contract** — never renumber; callers may branch on Guard vs auth vs request failures.
- **Dictionary / inheritance is on the Guard's critical path** for Ext and for discovering Sensitive References on an in-bounds Table; lookup failure denies the operation rather than falling back to Exact-only names.
- **Write responses are best-effort strip**, not a proof that values never left the instance — reads are the path that must stay off the wire.
- **`script search` searches only what it can name.** The GraphQL Engine leaves Sensitive Artifacts out of the query before HTTP; the native Code Search Engine cannot express that exclusion, so it is blocked outright (ADR 0011 as amended) rather than filtered after the fact.
