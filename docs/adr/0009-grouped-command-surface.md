---
status: accepted
---

# Command surface is four groups, broken at 2.0.0

`sn` exposes its ten operations as leaves under four groups — `table` (`query`,
`schema`, `config`), `record` (`create`, `update`, `delete`), `batch` (`update`,
`delete`), and `script` (`run`, `search`) — rather than as a flat kebab-case
list. The version is 2.0.0, and the retired flat names are not kept as aliases:
an old invocation fails loudly, and the major version alone tells an operator
their calls are no longer valid. Nothing else about any command changes — same
flags, arguments, defaults, and stdout contract (ADR 0007).

This supersedes ADR 0004's consequences that the surface stay flat and
kebab-case for the CLI restructure. The ten operations themselves are unchanged;
only the path that reaches them moved.

## Considered Options

- **Four glossary-named groups (chosen)** — the flat list had stopped carrying
  the shape of the tool: three table reads, three single-Record writes, two
  batch writes, and two script concerns sat as siblings with the grouping only
  in the operator's head. Groups named for glossary terms make `sn --help`
  readable as the surface grows.
- **Fold `batch` into `record`** — rejected. Batch returns a per-item status
  result, so merging would change an output contract rather than just a name.
  The glossary treats Batch as first-class; the surface follows it.
- **Keep code search flat beside `script run`** — rejected. A lone flat
  exception is worse than a group name that spans two glossary terms
  (Background Script and Script Record). The glossary carries the precision the
  group name gives up.
- **Hyphenated verb leaves (`get-schema`, `run-background`)** — rejected. Noun
  leaves (`schema`, `config`) read shorter in the common case, and kebab-case
  belongs at the group/shell boundary (ADR 0004), not inside a group.
- **Retain hidden aliases for the flat names** — rejected. Silent dual paths
  would hide the break; a clean major-version cut makes stale invocations fail
  with a correctable error instead.

## Consequences

- **Module layout mirrors the tree.** Command modules and their tests live in a
  directory per group, one file per leaf.
- **Agent-facing docs describe groups, not flat names.** An agent reading
  `AGENTS.md` must be able to emit a live invocation.
- **ADR 0008's no-build constraint still holds.** Import aliases that let the
  modules move without relative-path pain are recorded there as an amendment.
