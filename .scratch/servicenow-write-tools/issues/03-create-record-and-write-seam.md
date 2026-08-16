# Add create_record (+ extend client seam for write verbs)

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

Prefactor first: extend the single `SnClient.request()` seam to take an options
argument `{ method?, body? }`, defaulting to GET with no body, JSON-encoding the
body and setting the content-type. The 401 refresh-and-retry-once logic stays in
the one seam and now covers writes (safe: a 401 means rejected, not executed).
This honors ADR 0001, which already anticipated POST tools. Do not add per-tool
try/catch.

Then add `create_record`: `POST /api/now/table/{table}` with a `fields` object
body, returning the created Record as compact JSON text. Register with title,
description, and annotations (not readOnly, not destructive, not idempotent,
open-world).

## Acceptance criteria

- [ ] `request()` accepts `{ method, body }`, defaults to GET, JSON-encodes body + sets content-type
- [ ] 401 retry-once still works for a write request (test)
- [ ] `create_record` POSTs `fields` to the table and returns the created Record
- [ ] Registered with title, description, annotations (create-appropriate)
- [ ] Tests cover the seam (method/body + 401 retry) and create_record request shape

## Blocked by

None - can start immediately (this slice carries the seam prefactor).
