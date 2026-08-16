# 08 — `get-table-config`

Status: done

## What to build

`sn get-table-config incident` reconstructs everything configured on a Table, so a
caller understands its behaviour before changing it. The largest single operation
in the set.

There is no JSON endpoint for the platform's own config view and the UI page is
blocked under hardened auth, so this reconstructs the picture over the Table API
from a curated category map: business rules, client scripts, UI policies, UI
actions, data policies, email actions, classic workflows, and ACLs — each keyed by
its own link column. Walk the inheritance chain using the shared helper from
ticket 04 and tag every returned Record with the Table it came from.

Two specifics carry over exactly. ACLs use an **irregular naming scheme** and must
be matched on both the bare Table name and the dot-prefixed field form, then
attributed correctly. Script and condition bodies are included in full by
default, with a `categories` filter as the size lever when the fan-out is too
large. Flow Designer support remains the documented gap.

Delete the old `get_table_config` tool file once ported.

Covers user story 25. Respects ADR 0003.

## Acceptance criteria

- [x] All curated categories are returned for a Table, each Record tagged with its originating Table across the inheritance chain.
- [x] ACL Records are matched on both naming forms and attributed to the right Table.
- [x] Script and condition bodies are included in full by default.
- [x] The `categories` filter narrows the fan-out to the requested categories only.
- [x] A Table with nothing configured in a category returns an empty entry for it rather than omitting or failing.
- [x] Everything goes through the client service — no raw HTTP, no `try`/`catch` in the command.
- [x] `node:test` checks with a stub client Layer assert the category fan-out, inheritance tagging, ACL attribution, and the `categories` filter.
- [x] The old `get_table_config` tool file is deleted.

## Blocked by

- 02 (client service, output and exit-code contract)
- 04 (the shared inheritance-chain helper)
