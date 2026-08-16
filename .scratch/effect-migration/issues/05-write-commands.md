# 05 — Write commands: create, update, delete

Status: done

## What to build

The three single-Record write commands, so a caller can change instance data by
`sys_id`. `sn create-record` inserts a Record into a Table from supplied field
values and returns the created Record. `sn update-record` patches a Record
identified by its `sys_id`. `sn delete-record` removes one.

Field names stay **snake_case verbatim** — these are ServiceNow fields, not CLI
ergonomics, so the seam rule applies and there is no translation. The `sys_id` is
the positional subject where a command has one.

Delete the old `create_record`, `update_record`, and `delete_record` tool files
once ported.

Covers user story 27. Respects ADR 0001 as amended.

## Acceptance criteria

- [x] Each command issues the correct Table API request; create/update return the raw ServiceNow response uncoerced, delete confirms with `{ sys_id, deleted: true }` (204 has no body).
- [x] Field names are passed through snake_case verbatim with no translation layer.
- [x] A rejected write (validation failure, missing mandatory field, ACL refusal) surfaces the extracted ServiceNow message as a tagged error with a classified exit code.
- [x] A non-existent `sys_id` produces a clear failure rather than a silent success.
- [x] `node:test` checks with a stub client Layer assert the request shape for each command, including the failure paths.
- [x] The three old write tool files are deleted.

## Blocked by

- 02 (client service, output and exit-code contract)

## Comments

**Done.** Three write commands on the Table API via `SnClient.request` with method/body.

**Field input.** `--field name=value` (repeatable `Flag.keyValuePair`), same shape as `--sysparm`. Keys stay snake_case at the ServiceNow seam; the flag name itself is kebab-case per ADR 0004.

**Delete confirmation.** ServiceNow returns 204 empty; command emits `{ sys_id, deleted: true }` so stdout isn't blank (matches the old tool; story 30).

**sys_id position.** `update-record` / `delete-record` take `<table> <sys_id>` positionals; create takes `<table>` only.
