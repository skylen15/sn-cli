# 04 — Group the table commands

Status: done

## What to build

`sn table query`, `sn table schema`, and `sn table config` — the three reads of a
Table's rows, its Dictionary-derived schema, and its reconstructed configuration,
reached through a shared group instead of three flat names.

The group is a command with subcommands and no handler of its own, so a bare
`sn table` prints that group's help. Leaves are nouns rather than hyphenated
verbs: the two discovery commands drop their `get` instead of gaining a hyphen,
because kebab-case belongs at the group boundary and nowhere inside a group.

Nothing about the three commands themselves changes — same arguments, same
flags, same defaults, same bytes on stdout. Only the path typed to reach them.
Their old flat names are retired outright, with no hidden aliases.

This is the first group, so it sets the pattern the remaining three follow: how a
group module is shaped, where leaf modules live, how the shared Alias flag is
read from a leaf, and how a migrated test differs from its predecessor. Migrating
a test should mean changing the argv array and leaving every assertion untouched
— an assertion surviving unchanged is the evidence that only the invocation path
moved.

The other seven commands stay flat and passing throughout; a subcommand list
holds a mix of groups and flat commands quite happily.

Covers user stories 1, 2, 3, 4, 6, 7, 10, 11, 12, 14 and 15. Respects ADR 0004
and ADR 0007.

## Acceptance criteria

- [x] All three table commands are reachable through the group and behave
      exactly as before — arguments, flags, defaults, and stdout unchanged.
- [x] Bare `sn table` prints the group's help and exits zero.
- [x] The group's help lists its three leaves; the root's help lists the group.
- [x] The root Alias flag reaches these leaves, given before or after the group
      name.
- [x] Each retired flat name exits non-zero with an explanation on stderr and
      nothing on stdout.
- [x] Command modules and their tests are organised by group, mirroring the
      command tree.
- [x] Migrated tests changed only their argv arrays; their assertions are
      untouched.
- [x] The remaining seven commands still work flat.
- [x] `pnpm check` passes.

## Blocked by

- 01 (nested dispatch proven at runtime)
- 03 (imports aliased, so the module move rewrites nothing twice)

## Comments

**Done.** First group: `src/commands/table.ts` + leaf modules under
`src/commands/table/`; tests under `tests/cli/table/`. Retired flat names fail
loudly; Effect still dumps help on stdout for unknown subcommands (same as any
unknown name today — noted in the retired-name test). AGENTS.md / README surface
docs deferred to 08.