# 07 — `search-code`

Status: done

## What to build

`sn search-code "GlideRecord"` finds where code lives in an instance. Wrap the
Code Search REST API's global search verb — term, search-all-scopes or
current-app, and a limit — and **flatten** its deep group→hit→field→lineMatch tree
to one row per field match, each carrying the table, the record name, the field,
the line matches with their line numbers and context, and a match count.

The API sometimes collapses a single `result` to an object rather than an array;
normalise that to an array so callers never branch on it. Keep the existing
`format` option (structured by default, with a human summary alternative).

Delete the old `search_code` tool file once ported.

Covers user story 26. Respects ADR 0003.

## Acceptance criteria

- [x] Results are flattened to one row per field match, with table, name, field, line matches, and match count.
- [x] A single-object `result` is normalised to an array, so a one-hit search and a many-hit search have the same output shape.
- [x] Both output formats work; the structured one is the default.
- [x] A search with no hits returns an empty result rather than failing.
- [x] Everything goes through the client service — no raw HTTP, no `try`/`catch` in the command.
- [x] `node:test` checks with a stub client Layer assert the flattening, including the collapsed-single-result case and the no-hits case.
- [x] The old `search_code` tool file is deleted.

## Blocked by

- 02 (client service, output and exit-code contract)
