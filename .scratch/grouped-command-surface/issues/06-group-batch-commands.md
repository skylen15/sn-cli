# 06 — Group the batch commands

Status: done

## What to build

`sn batch update` and `sn batch delete` — the two by-list writes reached through
a shared group, following the pattern established in ticket 04.

Batch stays a first-class group rather than folding into the record group as a
list-accepting variant. That folding was considered and rejected during design:
the batch commands return a per-item status result and continue past individual
failures, so merging them would change an output contract rather than just a
name. The glossary treats Batch as its own term and the surface follows it.

The per-item status output is untouched by this ticket.

Covers user stories 9, 10, 11, 12, 14 and 15. Respects ADR 0002 and ADR 0007.

## Acceptance criteria

- [x] Both batch commands are reachable through the group and behave exactly as
      before — arguments, flags, defaults, and stdout unchanged.
- [x] The per-item status result shape is byte-identical to before, including
      the partial-failure case.
- [x] Bare `sn batch` prints the group's help and exits zero.
- [x] The group's help lists its two leaves; the root's help lists the group.
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

- 04 (establishes the group pattern; independent of 05 and 07, so any order
  among those three is fine)
