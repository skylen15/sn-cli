# 08 — GraphQL becomes the default Engine

Status: done

## What to build

Flip the default, and make the way round discoverable.

```
sn script search gs.info
```

now runs on the GraphQL Engine. `--engine native` selects the older path, which
stays exactly as it is for instances where GraphQL is switched off.

There is no automatic detection and no capability probe: the Engine is chosen,
never detected. So a GraphQL failure **fails loudly**, and the error names
`--engine native` so a caller learns the way round in the same breath as the
error. Silent fallback is specifically rejected — a caller handed weaker results
without being told cannot tell absence from a bounded search, which is the same
reason exit 7 exists.

This is the ticket where the feature becomes the default behaviour, so it is also
where the whole thing gets verified end to end: both Engines returning the same
Hit model, the leaf's `--help` describing every flag the work added, and the
breaking output change from ticket 01 written up for the release.

Covers user stories 19, 20. Respects ADR 0011.

## Acceptance criteria

- [x] `sn script search <term>` uses the GraphQL Engine with no flags.
- [x] `--engine native` still works and returns the same Hit model.
- [x] A GraphQL failure produces an error naming `--engine native`, and never silently degrades to it.
- [x] No capability probe runs before a search.
- [x] `sn script search --help` documents every flag added across tickets 02 to 07.
- [x] The output contract change is written up as breaking for the next release.
- [x] `pnpm check` passes — type-check, format, lint, tests.

## Blocked by

- 04 (search every Artifact on the instance)
- 05 (match modes and active filtering)
- 06 (full Excerpts, with context lines)
- 07 (error accounting, and admitting an incomplete run)

## Comments

- Default Engine is GraphQL; `--engine native` remains the Code Search path.
- GraphQL `SnRequestError` from `/api/now/graphql` appends guidance to retry with
  `--engine native` (ADR 0011). No probe, no silent fallback.
- Breaking Hit-model write-up lives in README under "Breaking changes (next release)".
