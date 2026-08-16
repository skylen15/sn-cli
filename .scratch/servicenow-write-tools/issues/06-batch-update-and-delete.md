# Add batch_update and batch_delete (by-list, continue-on-error)

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

Two batch tools operating on an explicit list of `sys_id`s (by-list, never
by-query):

- `batch_update`: input `[{ sys_id, fields }]`, PATCHes each.
- `batch_delete`: input `[sys_id]`, DELETEs each.

Both run as a client-side loop over the single write seam, **continue past
per-item failures**, and return a per-item status array (`{ sys_id, ok, error? }`
per item) as compact JSON text. O(n) round trips is the known ceiling — mark it
with a `ponytail:` comment naming the native Batch API as the upgrade path. The
per-item try/catch is the one sanctioned exception to ADR 0001's no-try/catch
rule (see ADR 0002); a failure to start the batch (bad input) still throws.

## Acceptance criteria

- [ ] `batch_update` PATCHes each `{sys_id, fields}` in the list
- [ ] `batch_delete` DELETEs each `sys_id` in the list
- [ ] A failing item does not abort the batch; remaining items still run
- [ ] Response is a per-item status array showing which succeeded/failed
- [ ] Both registered with title, description, annotations (destructive + idempotent)
- [ ] A test asserts continue-on-error: mid-list failure yields a full status array
- [ ] `ponytail:` comment names the O(n) ceiling + Batch API upgrade path

## Blocked by

- `04-update-record` (batch_update reuses the PATCH path)
- `05-delete-record` (batch_delete reuses the DELETE path)
