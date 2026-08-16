---
status: accepted
---

# `script search` returns a Hit model, and says when a run was incomplete

ADR 0007 makes stdout the raw ServiceNow response, because an envelope obscures
ServiceNow's own field shapes. This leaf cannot honour that and never really did:
the GraphQL Engine's response is a batched GraphQL document keyed by Artifact,
and the native Engine's response was already being flattened before this decision
was taken. stdout therefore carries our own model — a **Hit** per Record carrying
its `sys_id`, with **Field matches** and their **Excerpts** beneath — and both
Engines converge on it.

A search can also be answered in part: a rejected batch, an Artifact whose
request failed. That follows the precedent `batch update` and `batch delete`
already set — Hits to stdout first, then a tagged error on stderr and a
classified exit — as `SnSearchIncompleteError` at **exit 7**.

## Consequences

- Exit 7 is distinct from the batch codes (5, 6) so a caller can tell an
  incomplete _search_ from partly failed _writes_. It joins a set ADR 0007 says
  never to renumber.
- Nothing is reported when nothing failed. A caveat printed on every successful
  search is a caveat nobody reads, and stderr is where ADR 0007 puts things it
  wants people to actually notice.
- `sys_id` is in the shape, because a result that cannot be turned back into a
  record link is a result someone has to search for twice.
- `highlightRanges` is not, and neither is `owner` (ADR 0010): both are rendering
  concerns, and a caller holding the term and the line can find offsets itself.
- `matchedLineCount` and `omittedMatchedLines` are, because they are the one
  thing a caller cannot recompute — how much the Excerpt held back.
- Matched lines take priority over context lines inside an Excerpt's line budget.
  This is a deliberate divergence from the source, whose cap counts context
  lines and so lets a sparsely-matching field surrender matched lines to
  decoration; no test there covers that case.
