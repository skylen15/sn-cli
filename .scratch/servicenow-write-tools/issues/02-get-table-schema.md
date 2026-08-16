# Add get_table_schema (Dictionary discovery)

Status: ready-for-agent

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

A read-only `get_table_schema` tool that returns a table's column metadata from
the Dictionary. Query `sys_dictionary` for the table, then walk
`sys_db_object.super_class` to include inherited columns (so `incident` returns
`task`'s fields too). For each column return: name, type, label, mandatory,
max_length, default_value, reference (the target table for Reference fields,
resolved from `sys_dictionary.reference`), and choices (the Choice list from
`sys_choice` for choice-typed columns, grouped by element). Register with title,
description, and read-only annotations. Compact JSON text response.

Choice lists can be large — fetch them in as few queries as possible (e.g. one
`sys_choice` query scoped to the table+parents) and mark the volume ceiling with
a `ponytail:` comment.

## Acceptance criteria

- [ ] Tool returns own + inherited columns for an extended table
- [ ] Each column includes name, type, label, mandatory, max_length, default_value
- [ ] Reference columns include the resolved target table name
- [ ] Choice columns include their Choice list
- [ ] Registered with title, description, readOnly + idempotent + open-world annotations
- [ ] A test asserts schema assembly for a table with a parent, a reference field, and a choice field (stubbed client)

## Blocked by

None - can start immediately.
