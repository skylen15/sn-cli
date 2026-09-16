---
status: superseded by ADR-0019
---

# Default `sn` is read-only; maintainers invoke the Full CLI explicitly

From 3.0.0, the globally linked `sn` is a **Read-only CLI**: it exposes `table`
(`query`, `schema`, `config`), `script search`, `auth` (`add`, `list`, `use`,
`remove`), and the local-only `rule install`, but does not register `record`,
`batch`, or `script run`. Authentication management is local machine state, not
a ServiceNow mutation. This is a client-side guardrail against accidental
instance mutation, not a security boundary; a holder of the source and valid
credentials can still bypass it, and ServiceNow ACLs remain authoritative.

Maintainers retain the complete command surface as the **Full CLI**, invoked
from the repository for one command at a time with
`pnpm sn:full <group> <leaf> ...`. It is not globally linked, cannot be
enabled through a flag or persisted setting, and remains subject to the Guard,
including the TTY gate for `script run`. Its invocation is documented only in
maintainer-facing material; the default root help states that `sn` does not
change ServiceNow without advertising the Full CLI.

New ServiceNow commands fail closed: they belong only to the Full CLI until
explicitly classified as non-mutating and added to the Read-only CLI. The
Read-only CLI is assembled from an explicit allowlist rather than by subtracting
known writes from the complete command tree.

## Considered Options

- **A runtime flag or environment-variable unlock** was rejected because it is
  easy to persist, copy, or enable accidentally in the same workflows this
  decision is intended to protect.
- **A second globally linked executable** was rejected because it would place
  mutating commands back in ordinary users' discoverable command surface.
- **Instance roles or ACL changes** were rejected as the mechanism for this
  decision because the intended boundary is accidental CLI use, not the
  credential holder's authority. ACLs still provide the actual security
  boundary.

## Consequences

- Removing previously public leaves is a breaking command-surface change, so
  the version advances from 2.x to 3.0.0 with no compatibility aliases.
- ADR 0009's single four-group public surface is superseded; its grouping and
  no-alias rationale still govern the command trees that retain those groups.
- ADR 0017's Instance Guard remains always on in both variants, and ADR 0014's
  `rule install` remains in the default CLI because it cannot mutate an
  instance.
