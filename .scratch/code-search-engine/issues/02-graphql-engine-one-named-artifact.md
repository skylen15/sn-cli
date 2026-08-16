# 02 — GraphQL Engine against one named Artifact

Status: done

## What to build

The thinnest complete path through the GraphQL Engine, with the user naming the
Artifact so nothing has to be discovered yet:

```
sn script search gs.info --engine graphql --table sys_script --field script
```

That means: turn the term into words, build the Encoded Query for the named
Table and field, send it as a GraphQL query through the client seam, and turn the
response into Hits. Because the query returns the whole field value, the Engine
re-confirms per field that the word really is in the text — a field with no word
present is not a Field match, and a Record with no Field match is not a Hit. This
is what stops the stemmed near-misses the native Engine returns.

Deliberately not in this ticket: Dictionary discovery, searching more than one
Table, batching, match modes, active filtering, context lines, error accounting.
Excerpts here are Matched lines only.

`--engine` arrives with this ticket and defaults to `native`, so the new path is
opt-in until ticket 08 flips it.

The pure logic is ported by hand from the browser tool's search core. **Port the
tests for a slice before porting the slice** — they are the only thing that
catches a hand-port changing behaviour, and they already use `node:test` and
`node:assert`.

Covers user stories 4, 6, 22. Respects ADR 0001, ADR 0011, ADR 0012.

## Acceptance criteria

- [x] A GraphQL search on one named Table and field returns Hits in the same model ticket 01 established.
- [x] Each Excerpt line carries the line number the line holds in the stored field value.
- [x] A field whose value does not contain the term produces no Field match, even when the instance returned the Record.
- [x] The GraphQL request goes through the client seam using its existing method-and-body support; the seam is not modified.
- [x] `--engine` accepts `graphql` and `native` and defaults to `native`.
- [x] Ported tests for term parsing, query building and response processing pass, near-verbatim from the source suite.
- [x] A stub `SnClient` Layer test asserts the exact Encoded Query that went out.
- [x] A term matching nothing returns an empty result and exits zero.

## Blocked by

- 01 (Hit model on the native Engine)
