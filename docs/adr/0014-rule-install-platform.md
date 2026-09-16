---
status: accepted
---

# `rule install` places a Rule for a Platform

`sn cursor install-rule` is replaced by `sn rule install [--platform cursor]`.
The fifth group is glossary-named `rule` with leaf `install`. `--platform` is a
choice flag defaulting to `cursor`; it selects only the on-disk layout (today
`.cursor/rules/`), not which shipped file to copy — still
`.cursor/rules/sn-cli.mdc` from the package. Unknown platforms fail at flag
parse. The old `cursor` group is removed with no alias.

Filesystem contract is unchanged from ADR 0013: git toplevel or cwd with a
stderr warning, `--force` to overwrite, `SnLocalError` exit 8 on collision,
success stdout `{"path":"…"}`, no Alias / `.env` / `SnClient`.

Grouping under `rule` + `--platform` was chosen over a host-named group so a
second Platform can share one leaf without another group. Defaulting
`--platform` to `cursor` keeps the common invocation short while still naming
the host when omitted.

This supersedes ADR 0013.

## Consequences

- **ADR 0013 is superseded**; its exit code, JSON shape, and ship path still
  apply.
- **Module layout** is `src/commands/rule/install.ts` (ADR 0009).
- **CONTEXT.md** carries **Rule** and **Platform** so the group name stays
  glossary-backed.
