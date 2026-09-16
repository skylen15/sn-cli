# 07 — script run TTY-gate

Status: done

Parent: [spec.md](../spec.md) · ADR 0015

## What to build

`sn script run` is always under the Guard: **non-TTY** stdin fails closed with
`SnGuardError` before any Background Script execution. On a TTY, each
invocation prompts once on stderr (Guard + remote code execution); only
`y` / `yes` (case-insensitive) proceeds to the existing run paths. Accidental
Enter does not confirm. No `--no-guard` / env kill switch.

## Acceptance criteria

- [x] Non-TTY `script run` fails with `SnGuardError` and does not execute a Background Script.
- [x] TTY `script run` prints a once-per-invocation confirm on stderr naming Guard and RCE.
- [x] Only `y` / `yes` (case-insensitive) accepts; other input (including bare Enter) denies without running.
- [x] After accept, existing Background Script behaviour (ADR 0002 paths) is unchanged.
- [x] Tests cover non-TTY deny and confirm accept/reject without a live instance.

## Blocked by

- 01 — T1 Exact on table query
