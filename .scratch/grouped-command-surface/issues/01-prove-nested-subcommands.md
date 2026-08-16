# 01 — Prove nested subcommand dispatch

Status: done

## What to build

Runtime evidence that a two-level command tree actually works on the pinned
Effect release, before any real command is restructured around the assumption.

Nesting is confirmed in the library's source — parsing and dispatch are
recursive, shared flags are peeled from the token stream at each subcommand
boundary, and help is scoped to the invoked path — but it has never been
executed here. ADR 0008 already established the standard for this situation: the
pinned release must be confirmed running, not merely resolving, which is why the
throwaway probe fixture exists. Extend that fixture with a group command holding
two leaves and assert the behaviours the whole restructure depends on.

Nothing in the real command surface moves. If nesting misbehaves, this ticket
fails alone and the rest of the plan is renegotiated before any cost is sunk.

Covers user story 22. Respects ADR 0008.

## Acceptance criteria

- [x] The probe exposes a group command with at least two leaves, and invoking
      a leaf through its group runs that leaf's handler.
- [x] A flag declared as shared on the probe's root reaches the leaf handler,
      given both before and after the group name.
- [x] Invoking the group with no leaf prints that group's help and exits zero.
- [x] The group's help lists its leaves; the root's help lists the group.
- [~] An unknown leaf under a valid group exits non-zero with an explanation on
      stderr and nothing on stdout.
- [x] `pnpm check` passes.

## Blocked by

- None — can start immediately.

## Comments

- Unknown-leaf half-met: non-zero exit and scoped stderr
  (`Unknown subcommand "…" for "probe bundle"`) are proven. Empty stdout is
  **not** — Effect's `ShowHelp` always `Console.log`s the help doc, including
  when parse errors are attached, which is the same behaviour a flat unknown
  subcommand already has. Empty-stdout for parse errors needs a `Command.run`
  change (ADR 0007), not more nesting proof. Later grouping tickets that copy
  this "nothing on stdout" wording will hit the same Effect default.
