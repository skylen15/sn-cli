# Add delete_record

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

A `delete_record` tool: `DELETE /api/now/table/{table}/{sys_id}`. Returns a
small confirmation (e.g. `{ sys_id, deleted: true }`) as compact JSON text.
Register with title, description, and annotations (destructive, idempotent,
open-world).

## Acceptance criteria

- [ ] Sends DELETE to `/api/now/table/{table}/{sys_id}`
- [ ] Returns a clear deletion confirmation
- [ ] Registered with title, description, annotations (destructive + idempotent)
- [ ] A test asserts the DELETE request shape

## Blocked by

- `03-create-record-and-write-seam` (needs the write-verb seam)
