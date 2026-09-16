# 02 — T1 Ext fail-closed

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

A Table that **extends** a Sensitive Table is itself Sensitive. If the
inheritance chain cannot be resolved, the Guard **fails closed** (deny),
never Exact-only fallthrough.

Demoable on `table query`: a child of `sys_user` is denied; a broken
inheritance lookup is denied. Exact shipped names from 01 still deny.

## Acceptance criteria

- [x] A Table whose inheritance chain includes a Sensitive Table is denied as a query target before HTTP.
- [x] When inheritance cannot be resolved, the operation fails with `SnGuardError` (fail-closed), not allow.
- [x] Exact shipped names from 01 remain denied without needing Ext.
- [x] Tests cover Ext deny and fail-closed lookup failure through the Guard seam (fake inheritance adapter).

## Blocked by

- 01 — T1 Exact on table query
