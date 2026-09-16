# 06 — `.sn-guard` project-narrow-only

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

A walk-up `.sn-guard` file (cwd → `$HOME` inclusive, first file wins — same
stop rules as `.env`) may only **add** Sensitive Table names to the shipped
set. Added names participate in Ext. There is no way to remove shipped names
or disable the Guard via the file; unrecognized weaken/disable directives
must not silently widen access (prefer hard fail).

Missing or empty `.sn-guard` means shipped defaults only. `#` comments and
blank lines are ignored.

## Acceptance criteria

- [x] A Table named only in `.sn-guard` is treated as Sensitive (T1 deny on query) in addition to the shipped set.
- [x] Project-added names are subject to Ext like shipped names.
- [x] The file cannot remove a shipped Sensitive Table or turn the Guard off; weaken/disable directives do not widen access.
- [x] Walk-up discovery matches ADR 0005 stop rules (cwd → `$HOME`, never above).
- [x] `#` comments and blank lines are ignored; absent file → shipped defaults only.
- [x] Tests cover union-add, walk-up precedence, and rejection/no-op of widen attempts.

## Blocked by

- 02 — T1 Ext fail-closed
