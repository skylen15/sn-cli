# 07 — Group the script commands

Status: done

## What to build

`sn script run` and `sn script search` — running a Background Script and
searching Script Records, brought together under one group.

This is the ticket that removes the last flat command. Code search was the one
operation with no obvious group, and leaving it flat beside `sn script run`
would have been the surface's only exception — worse, an operator who has just
typed `sn script run` would reasonably try `sn script search` next and find
nothing. Folding it in leaves the grouped surface with no exceptions at all.

The group name deliberately spans two distinct glossary terms. A Background
Script is transient, executed via the scripts endpoint under session and CSRF
auth, and never stored. A Script Record is a stored Record whose fields hold
server-side code, searched but never executed by `sn`. Both terms are already in
the glossary precisely so this shared group name cannot collapse them; the group
is a surface convenience sitting above two precise concepts.

Neither command's behaviour changes. Background script execution keeps its
distinct auth path, and code search keeps its flattening and both output
formats.

Covers user stories 8, 10, 11, 12, 14 and 15. Respects ADR 0002, ADR 0003 and
ADR 0007.

## Acceptance criteria

- [x] Both commands are reachable through the group and behave exactly as
      before — arguments, flags, defaults, and stdout unchanged.
- [x] Background script execution keeps its session and CSRF auth path,
      unaffected by the move.
- [x] Code search keeps its flattening and both output formats.
- [x] Bare `sn script` prints the group's help and exits zero.
- [x] The group's help lists its two leaves; the root's help lists the group.
- [x] The root Alias flag reaches these leaves, given before or after the group
      name.
- [x] Each retired flat name exits non-zero with an explanation on stderr and
      nothing on stdout.
- [x] No flat commands remain — every leaf is reached through a group.
- [x] Command modules and their tests are organised by group, mirroring the
      command tree.
- [x] Migrated tests changed only their argv arrays; their assertions are
      untouched.
- [x] `pnpm check` passes.

## Blocked by

- 04 (establishes the group pattern; independent of 05 and 06, so any order
  among those three is fine)

## Comments

**Done.** Last group: `src/commands/script.ts` + leaf modules under
`src/commands/script/`; tests under `tests/cli/script/`. Root now lists only
`table`, `record`, `batch`, `script`. AGENTS.md / README surface docs deferred
to 08.
