# 04 — Search every Artifact on the instance

Status: done

## What to build

Make `--table` optional, so the GraphQL Engine searches everywhere:

```
sn script search gs.info --engine graphql
```

Discover every Artifact on the instance from the Dictionary, then search all of
them. This is the ticket that delivers the reason the whole feature exists: code
on a custom Table, or on a Table belonging to a store application, is as findable
as code on `sys_script`, and no administrator's search-group configuration
decides the reach.

Artifacts are batched ten per GraphQL document. Batches run concurrently at a low
limit, starting at four. Every request is a transaction attributable to the
credential in use, so treat four as a starting point to calibrate against a real
instance rather than a settled number — if the instance objects, drop it.

`--table` still narrows to named Tables when given.

Covers user stories 1, 2, 3. Respects ADR 0010.

## Acceptance criteria

- [x] A GraphQL search with no `--table` covers every Artifact the Dictionary reports.
- [x] A code-bearing custom Table is searched without anyone naming it.
- [x] `--table` still narrows to the named Tables.
- [x] Artifacts are batched ten per GraphQL document.
- [x] Batches run concurrently at a bounded limit, and the limit is one number in one place so it can be calibrated.
- [x] Hits from every batch are merged into one result, grouped per Record.
- [x] A stub `SnClient` Layer test asserts the batching — that N Artifacts produced the expected number of documents, each carrying the expected Artifacts.

## Blocked by

- 03 (the Dictionary supplies an Artifact's code fields)
