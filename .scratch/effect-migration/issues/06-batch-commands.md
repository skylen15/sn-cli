# 06 — Batch commands: `batch-update`, `batch-delete`

Status: done

## What to build

The two Batch commands, so one bad Record doesn't abort a whole run. Each takes
an **explicit list of `sys_id`s** — by-list, never by-query, which is what Batch
means in this domain — iterates them capturing each item's outcome, continues past
per-item failures, and returns a per-item status array.

Express the iteration with Effect's own per-item outcome capture rather than
`try`/`catch`, so a failed item becomes data instead of a thrown error. A failure
to even start — malformed input, an empty list, an unknown Table — still fails the
whole command; only per-item ServiceNow failures are tolerated.

Stdin-piped `sys_id`s are explicitly out of scope; the list is passed as an
argument, as it is today.

Delete the old `batch_update` and `batch_delete` tool files once ported.

Covers user story 28. Respects ADR 0002.

## Acceptance criteria

- [x] Both commands operate on an explicit `sys_id` list and return one status entry per input `sys_id`, in input order.
- [x] A mid-list failure does not abort the run; subsequent items are still attempted and the failed item's status carries the extracted ServiceNow message.
- [x] A run with some failures is distinguishable by exit code from a wholly successful one and from a wholly failed one.
- [x] Malformed input fails the whole command before any item is attempted.
- [x] `node:test` checks with a stub client Layer assert the all-success, partial-failure, all-failure, and bad-input cases.
- [x] The two old batch tool files are deleted.

## Blocked by

- 02 (client service, output and exit-code contract)
