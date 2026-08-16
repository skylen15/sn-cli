# 05 — Group the record commands

Status: done

## What to build

`sn record create`, `sn record update`, and `sn record delete` — the three
single-Record writes reached through a shared group, following the pattern
established in ticket 04.

These stay distinct from the batch group. A Record write targets one `sys_id`;
a Batch write targets an explicit list and returns a per-item status. Keeping
them in separate groups is what stops an operator reaching a list when they
meant one Record.

Nothing about the three commands changes beyond the path typed to reach them.
Their old flat names are retired outright.

Covers user stories 10, 11, 12, 14 and 15. Respects ADR 0004 and ADR 0007.

## Acceptance criteria

- [x] All three record commands are reachable through the group and behave
      exactly as before — arguments, flags, defaults, and stdout unchanged.
- [x] Bare `sn record` prints the group's help and exits zero.
- [x] The group's help lists its three leaves; the root's help lists the group.
- [x] The root Alias flag reaches these leaves, given before or after the group
      name.
- [x] Each retired flat name exits non-zero with an explanation on stderr and
      nothing on stdout.
- [x] Command modules and their tests are organised by group, mirroring the
      command tree.
- [x] Migrated tests changed only their argv arrays; their assertions are
      untouched.
- [x] Commands not yet grouped still work flat.
- [x] `pnpm check` passes.

## Blocked by

- 04 (establishes the group pattern; independent of 06 and 07, so any order
  among those three is fine)

## Comments

**Done.** `src/commands/record.ts` + leaves under `src/commands/record/`;
tests under `tests/cli/record/`. Same Effect help-on-stdout note for retired
names as ticket 04. AGENTS.md / README deferred to 08.
