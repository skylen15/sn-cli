---
status: superseded by ADR-0014
---

# `cursor` group installs the shipped sn-cli Cursor rule locally

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

Superseded by ADR 0014 (`sn rule install --platform`).
