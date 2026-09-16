# 03 — T1 on remaining data leaves

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

Every remaining data-plane leaf that targets a Table applies the same T1
Exact+Ext Guard: `table schema`, `table config`, `record create|update|delete`,
and `batch update|delete`. Sensitive Table targets hard-fail before HTTP with
`SnGuardError` / exit 9.

In-bounds targets keep working (still no requirement to finish T2 in this
ticket).

## Acceptance criteria

- [x] `table schema` and `table config` on a Sensitive Table fail before HTTP with `SnGuardError`.
- [x] `record create|update|delete` targeting a Sensitive Table fail before HTTP with `SnGuardError`.
- [x] `batch update|delete` targeting a Sensitive Table fail before HTTP with `SnGuardError`.
- [x] Ext and fail-closed from 02 apply on these leaves the same as on query.
- [x] Thin CLI/Guard tests prove representative denies make no data-plane request.

## Blocked by

- 02 — T1 Ext fail-closed
