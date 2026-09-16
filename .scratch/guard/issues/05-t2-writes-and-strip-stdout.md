# 05 — T2 writes and strip stdout

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

Writes cannot set Sensitive References: `record create|update` and
`batch update` reject payloads that include those fields with
`SnGuardError` before HTTP. On a successful write response, Sensitive
Reference values are **stripped** from stdout JSON even if ServiceNow
returned them.

## Acceptance criteria

- [x] `record create` / `record update` reject a payload that sets a Sensitive Reference before HTTP.
- [x] `batch update` rejects items whose fields set a Sensitive Reference under the same rules.
- [x] Successful write stdout has Sensitive Reference values removed/nullified (strip), without changing unrelated fields.
- [x] Tests cover payload reject and response strip through the Guard seam; CLI coverage for at least one write leaf.

## Blocked by

- 04 — T2 reads on table query and schema Name-ok
