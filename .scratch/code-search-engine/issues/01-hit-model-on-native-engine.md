# 01 — Hit model on the native Engine

Status: done

## What to build

`sn script search gs.info` keeps using ServiceNow's Code Search API exactly as it
does today, but returns the **Hit** model instead of one flat row per Field match.

A Hit is a Record. It carries its `sys_id` — which the API already returns and the
current flattening throws away — plus the Table and the record name, with its
**Field matches** beneath it. A Business Rule matching in both `script` and
`condition` becomes one Hit with two Field matches rather than two unrelated
rows.

`--format text` prints the new shape, grouping a Record's Field matches under it.

This is a prefactor as much as a feature: it puts the model in place for the
GraphQL Engine to converge on, so no later ticket has to change the output shape
again. It is also a **breaking change** to the output contract — note it as such
for the next release.

Covers user stories 8, 9, 21. Respects ADR 0012.

## Acceptance criteria

- [x] A Hit carries `sysId`, and a caller can turn a result into a record link without searching again.
- [x] Two Field matches on one Record arrive as one Hit with two Field matches, not two rows.
- [x] A Field match carries its field name and its lines, each with the line number the API reported.
- [x] `--format text` groups Field matches under their Record.
- [x] A search with no Hits still emits an empty result and exits zero.
- [x] A single-object `result` from the API is still normalised to an array, so a one-Hit and a many-Hit search have the same shape.
- [x] Everything still goes through the client seam — no raw HTTP in the command.
- [x] `node:test` checks with a stub `SnClient` Layer cover the grouping, the `sysId`, the collapsed-single-result case and the no-Hits case.

## Blocked by

- None — can start immediately.

## Comments

- **BREAKING** (next release): `sn script search` stdout is now an array of Hits
  `{ sysId, name, table, fieldMatches[] }` (FieldMatch:
  `{ field, matchedLineCount, omittedMatchedLines, lines[] }`; Line:
  `{ lineNumber, content, matched }`), not one flat row per Field match.
  `--format text` groups Field matches under each Record.
