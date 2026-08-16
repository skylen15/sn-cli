# Add update_record (PATCH, partial)

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

An `update_record` tool that partially updates a Record:
`PATCH /api/now/table/{table}/{sys_id}` with a `fields` object body. PATCH, never
PUT — only the named fields change, the rest are untouched. Returns the updated
Record as compact JSON text. Register with title, description, and annotations
(destructive, idempotent, open-world).

## Acceptance criteria

- [ ] Sends PATCH (not PUT) to `/api/now/table/{table}/{sys_id}` with `fields`
- [ ] Returns the updated Record
- [ ] Registered with title, description, annotations (destructive + idempotent)
- [ ] A test asserts the PATCH request shape

## Blocked by

- `03-create-record-and-write-seam` (needs the write-verb seam)
