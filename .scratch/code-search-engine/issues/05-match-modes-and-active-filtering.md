# 05 — Match modes and active filtering

Status: done

## What to build

Let a caller widen or narrow a search without retyping the term.

A **match mode** flag decides how a term with whitespace becomes words to match:
**phrase** (the default — the whole term stays one literal string), **all** (split
into words, every word must appear), or **any** (split into words, one is enough).
Matching is substring in every mode, which is what lets a short word match inside
an unrelated one.

Inactive Records are excluded by default, and includable on demand, so a search
reflects what the instance actually runs. Active filtering is added only for an
Artifact that declares an `active` field. Where the Encoded Query expresses OR
across words, the active clause has to be repeated into each alternative, because
that operator starts a fresh query — the ported tests cover exactly this and it is
the easiest thing here to get quietly wrong.

The term stays **literal** throughout. `table:` and `field:` style tokens are not
lifted out of it: that is what the flags are for, and a tool for searching code
has to be able to find a string containing a colon.

Covers user stories 15, 16, 17, 18.

## Acceptance criteria

- [x] Phrase mode is the default and treats a multi-word term as one literal string.
- [x] All mode requires every word to appear in a Record; any mode requires one.
- [x] Matching is substring and case-insensitive in every mode.
- [x] Inactive Records are excluded by default, and a flag includes them.
- [x] Active filtering is applied only to an Artifact that declares an `active` field.
- [x] In any mode, the active clause is repeated into each alternative of the Encoded Query.
- [x] A term containing a colon is searched literally, not parsed as a filter.
- [x] Ported tests for match modes and query building pass, including the repeated-active-clause case.

## Blocked by

- 02 (GraphQL Engine against one named Artifact)
