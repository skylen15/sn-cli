# 04 — `get-table-schema`

Status: done

## What to build

`sn get-table-schema incident` returns the Table's Dictionary columns so a caller
understands a Table's shape before writing to it. For each column: name, type,
label, mandatory, max length, and default value; for Reference columns, the
referenced Table; for Choice columns, the Choice list.

Walk the inheritance chain so inherited columns are included, and tag each column
with the Table it came from. This ticket **establishes the shared
inheritance-chain helper** that `get-table-config` also needs, which is why it
gates ticket 08.

Delete the old `get_table_schema` tool file once ported.

Covers user story 24. Respects ADR 0003.

## Acceptance criteria

- [x] Columns are returned with type, label, mandatory, max length, and default value.
- [x] Reference columns resolve their referenced Table; Choice columns return their Choice list.
- [x] The inheritance chain is walked and every column is attributed to its originating Table.
- [x] The inheritance-chain walk is a reusable helper, not inlined in the command.
- [x] Everything goes through the client service — no raw HTTP, no `try`/`catch` in the command.
- [x] `node:test` checks with a stub client Layer assert the column shape, Reference resolution, Choice lists, and inheritance attribution.
- [x] The old `get_table_schema` tool file is deleted.

## Blocked by

- 02 (client service, output and exit-code contract)
