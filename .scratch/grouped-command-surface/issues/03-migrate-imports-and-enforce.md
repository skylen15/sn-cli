# 03 — Migrate every import onto the alias and enforce it

Status: done

## What to build

A codebase where no module reaches another by counting parent directories, and a
lint rule that keeps it that way.

Every relative import in the source tree today is a single `../`, which is
tolerable; every relative import in the tests is two levels deep, which is the
ugliest thing in the repo and accounts for most of them. Rewrite all of them onto
the alias, then ban the old form.

The ban is strict — parent-relative imports of any depth, not just the two-level
ones. The repo has no sibling-upward imports at all, so the strict form costs
nothing and closes the hole where a single `../` creeps back in later. This is
the contract half of the sequence, and the rule passing cleanly across the whole
repo is what proves the migration complete.

This ticket must land before any command module moves. Reversing that order
rewrites the same imports twice and makes the restructure diff unreadable.

Covers user stories 16, 18, 20 and 21.

## Acceptance criteria

- [x] No parent-relative import remains anywhere in the source tree or the
      tests.
- [x] A lint rule rejects parent-relative imports at any depth, with no
      exceptions or allow-list.
- [x] The rule is demonstrated to fire: a deliberate parent-relative import
      fails lint, and the demonstration is removed before the ticket closes.
- [x] The entrypoint smoke tests still pass, proving the aliases resolve through
      the shebang from an unrelated working directory after migration.
- [x] No test assertion changed — this ticket alters how modules are named, not
      what anything does.
- [x] `pnpm check` passes.

## Blocked by

- 02 (the alias entries must exist before anything migrates onto them)
