# 03 — The Dictionary supplies an Artifact's code fields

Status: done

## What to build

Make `--field` optional. Given a named Table, work out which of its fields hold
code by reading the Dictionary and classifying by field type:

```
sn script search gs.info --engine graphql --table sys_script
```

finds the term in `script` and in `condition` without being told either name.

An **Artifact** is a Table together with those fields, and this ticket is what
makes the Artifact discoverable rather than declared. `--field` still works, and
narrows to the named fields when given.

Field-type classification is ported from the browser tool's discovery path, which
already reads a Dictionary payload and sorts code-bearing types from plain-text
ones.

Respects ADR 0010.

## Acceptance criteria

- [x] A GraphQL search on a named Table with no `--field` searches every code field the Dictionary reports for that Table.
- [x] `--field` still narrows to the named fields.
- [x] Field-type classification distinguishes code-bearing fields from plain-text ones, and the ported classification tests pass.
- [x] A Table the Dictionary reports no code fields for produces a clear error rather than an empty search.
- [x] The Dictionary read goes through the client seam.
- [x] A stub `SnClient` Layer test drives discovery from a canned Dictionary payload and asserts the fields that ended up in the query.

## Blocked by

- 02 (GraphQL Engine against one named Artifact)
