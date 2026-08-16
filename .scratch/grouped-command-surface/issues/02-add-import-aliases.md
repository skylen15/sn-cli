# 02 — Add the import aliases

Status: done

## What to build

A package-relative way to name any module, working with no build step, added
beside the existing relative imports without disturbing them.

Node resolves `package.json` subpath imports natively, so a single pattern entry
covering the source tree plus a bare entry for the package manifest gives every
module in both source and tests one stable name for any other module, however
deep it sits. The manifest needs its own entry because it lives outside the
source tree, and leaving it out would force the lint rule in ticket 03 to carry
an exception.

This is the expand half of an expand–contract sequence: the entries are additive,
nothing is migrated onto them yet, and every existing relative import keeps
working. Prove the entries resolve, then stop.

Compiler path mapping is not an option and should not be reintroduced — it
type-checks and then fails at runtime, because there is no build step and Node's
type stripping does not rewrite import specifiers.

Covers user stories 17 and 19. Respects ADR 0008.

## Acceptance criteria

- [x] Both subpath entries are declared, and at least one module in the source
      tree and one test import through them.
- [x] The manifest entry works with a JSON import attribute.
- [x] The aliases resolve in-process under the test runner.
- [x] The aliases resolve when the CLI is spawned through its own shebang from a
      working directory outside the repo — the existing entrypoint smoke tests
      cover this and must pass unchanged.
- [x] No build step, bundler, or new dependency is introduced.
- [x] Every pre-existing relative import still works; nothing is migrated in
      this ticket.
- [x] `pnpm check` passes.

## Blocked by

- None — can start immediately.
