# 01 — T1 Exact on table query

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

`sn table query` hard-fails **before HTTP** when the target Table is in the
shipped Exact Sensitive Table set, with `SnGuardError` on stderr and exit
code **9**. In-bounds Tables (e.g. `incident`) still query as today — no T2
yet.

Introduces the Guard module and wires it on this one leaf so the CLI is
already stricter than before. Covers the tracer floor for T1 Exact.

## Acceptance criteria

- [x] `SnGuardError` exists, is part of the tagged error union / stderr JSON helper, and maps to exit code 9 (codes 3–8 unchanged).
- [x] Shipped Exact set includes `sys_user`, `sys_user_group`, `sys_user_grmember`, `sys_user_has_role`, `cmn_location`, `cmn_department`, `sn_hr_core_profile`.
- [x] `sn table query` on a shipped Sensitive Table fails with `SnGuardError` and makes no ServiceNow data-plane request.
- [x] `sn table query` on an in-bounds Table still succeeds (behaviour unchanged aside from consulting the Guard).
- [x] Guard error message names the Sensitive Table involved.
- [x] Tests cover Exact deny and an allowed query via the Guard seam; a thin CLI test proves zero HTTP on T1 deny (Layer fake `SnClient`).

## Blocked by

- None — can start immediately.
