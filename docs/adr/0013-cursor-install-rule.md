---
status: accepted
---

# `cursor` group installs the shipped sn-cli Cursor rule locally

This original decision is superseded by the amendment below; it remains here as
the history of the first installer contract.

`sn` gains a fifth group, `cursor`, with one leaf `install-rule`. It copies the
shipped `.cursor/rules/sn-cli.mdc` from the package install into the caller's
repo — git toplevel when available, otherwise cwd with a one-line stderr
warning. Collision fails with `SnLocalError` (exit 8) unless `--force`. Success
stdout is compact JSON `{"path":"…"}` (not a ServiceNow payload). No Alias,
`.env`, or `SnClient`.

This expands the surface past the four ServiceNow groups in ADR 0009 because
agents that already invoke `sn` need one command to drop the live-instance rule
into whatever repo they are editing. A separate bin or bash script was rejected:
it would duplicate distribution and PATH setup next to `pnpm add --global .`.
Keeping the leaf auth-free avoids loading credentials for a pure filesystem
copy. Exit 8 is a new classified code for local tooling failures so callers can
branch without conflating them with HTTP `SnRequestError` (4).

## Consequences

- **ADR 0009's “four groups” count is superseded for the live surface**; the
  layout rule (directory per group, one file per leaf) still holds.
- **ADR 0007 still applies**: stdout is compact JSON for agents; errors are
  tagged JSON on stderr. The success shape here is deliberately not a
  ServiceNow response.
- **`sn-cli.mdc` is canonical in this package**; other vaults may mirror it.

## Amendment: one rule installer targets three agent conventions

The Cursor-specific surface is replaced by `sn rule install --platform
cursor|general|claude`, with `general` as the default. Each invocation targets
exactly one platform: Cursor writes `.cursor/rules/sn-cli.mdc`, General writes a
managed section in `AGENTS.md`, and Claude writes the same managed section in
`CLAUDE.md`. The old `sn cursor install-rule` path is removed rather than kept
as an alias, and this breaking surface change releases as 3.0.0.

The three representations share one core body. Cursor retains its MDC
frontmatter and Cursor-specific `required_permissions` instruction; the two
Markdown representations omit both. Missing target files and directories are
created. Existing Markdown files are preserved: `sn` owns only a section
bounded by `<!-- sn-cli rule:start -->` and `<!-- sn-cli rule:end -->`, appended
at the end of the file with a level-two heading. Cursor keeps a level-one
heading after its frontmatter.
An existing identical section is a successful no-op; a different section
requires `--force`, which replaces only that section. A lone or out-of-order
marker is always `SnLocalError`, including with `--force`, because its ownership
boundary is ambiguous. Similar unmarked text is never inferred to be owned by
`sn`. Cursor follows the same idempotency contract: an identical destination is
a successful no-op and a different destination requires `--force`.

Markdown installation preserves the file's newline style and leaves exactly
one final newline. Success remains compact `{"path":"…"}` with an absolute
target path. All platforms install at the Git toplevel when available, otherwise
at cwd with the existing one-line stderr warning. Exit classification remains as
established above.

This broader Rule Platform model supersedes the Cursor-only group because the
guidance is about using `sn`, not about one editor. A platform flag keeps the
destination explicit while the General convention provides a useful default;
managed sections allow installation without claiming ownership of project
instructions maintained by people or other tools.
