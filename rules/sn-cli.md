# Live ServiceNow via `sn` CLI

For **instance-specific** facts (schema, live data, table config, existing code), use `sn` on PATH. Do not guess field names, types, or choices. Generic product/API behaviour stays with `sn-docs`.

## Reads — no approve

Run freely when the answer depends on this instance:

- `sn table query|schema|config`
- `sn script search`

## Mutating — approve first

Show the exact payload or script, then wait for explicit approve before:

- `sn record create|update|delete`
- `sn batch update|delete`
- `sn script run` (Background Script — remote code execution)

## How

- Learn flags from `sn <group> <leaf> --help` — do not guess.
- Sort inside `--query` with `ORDERBY` / `ORDERBYDESC`.
