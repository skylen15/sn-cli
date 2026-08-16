# Enhance query_table: options + metadata

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

Extend the existing `query_table` tool with three options and bring it up to the
project's metadata standard. New inputs map to `sysparm_display_value`
(`false`/`true`/`all`), `sysparm_exclude_reference_link` (boolean), and
`sysparm_offset` (number). Sorting is NOT a new input — it stays inside the
Encoded Query via `ORDERBY`. Register the tool with a `title`, a `description`
that warns the consumer that field shape depends on display_value (`all` yields
`{value, display_value}` per field), and read-only annotations. Response stays
compact JSON text, passed through untouched. No client-seam change (still GET).

This issue establishes the metadata pattern (title + description + annotations)
that every later tool copies.

## Acceptance criteria

- [ ] `query_table` accepts `display_value`, `exclude_reference_link`, `offset`, each optional, with descriptions
- [ ] The three map to the correct `sysparm_*` params; omitted ones are not sent
- [ ] Tool registers with title, description (notes display_value shape effect), and annotations (readOnly, idempotent, open-world)
- [ ] Response is compact JSON text, uncoerced
- [ ] A test asserts the built params for representative inputs (including display_value=all)

## Blocked by

None - can start immediately.
