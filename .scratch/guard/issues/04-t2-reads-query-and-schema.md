# 04 — T2 reads on table query and schema Name-ok

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

On an **in-bounds** Table, Sensitive References stay off the read wire:
`table query` omits those fields from the request when the caller did not ask
for them, and **rejects** Encoded Queries, `--fields`, and dot-walks that
touch them. `table schema` may still **name** Reference targets that are
Sensitive Tables (Name-ok) without exposing Record values.

Dictionary/Reference-target resolution fail-closed when T2 enforcement needs
it.

## Acceptance criteria

- [x] Querying an in-bounds Table does not request Sensitive Reference field values (H1/R2).
- [x] An Encoded Query that references a Sensitive Reference or dot-walks into a Sensitive Table is rejected with `SnGuardError` before HTTP.
- [x] `--fields` naming a Sensitive Reference or a dot-walk into a Sensitive Table is rejected with `SnGuardError` before HTTP.
- [x] `table schema` on an in-bounds Table may include Reference target names that are Sensitive Tables; it does not return Record values for them.
- [x] Failure to resolve Reference targets when needed fails closed with `SnGuardError`.
- [x] Tests cover omit, reject-query, reject-fields, and Name-ok schema behaviour through the Guard seam.

## Blocked by

- 02 — T1 Ext fail-closed
