# 10 — native Search Engine blocked

Status: done

Parent: [spec.md](../spec.md) · ADR 0015 · ADR 0011 (amended)

## What to build

Ticket 08 left `--engine native` searching the whole instance and dropping
Sensitive Hits from stdout afterwards, because ServiceNow's Code Search API
takes no Table filter. That is the fetch-then-drop ADR 0015 refuses for reads,
so the native Engine is blocked outright instead: `sn script search --engine
native` fails with `SnGuardError` / exit 9 before any HTTP, and the native
request path is deleted rather than left as unreachable code.

The `--engine` flag keeps `native` as a choice so the caller gets the Guard's
reason rather than a flag-parse error.

## Acceptance criteria

- [x] `--engine native` fails with `SnGuardError` / exit 9 and makes zero requests.
- [x] The Guard owns the decision (Engine policy sits in `guard.ts`, tested at that seam).
- [x] Native request, Hit mapping, and the native-only `--search-all-scopes` / `--current-app` flags are deleted, not left unreachable.
- [x] A GraphQL failure no longer offers `--engine native` as a fallback.
- [x] The GraphQL Engine still searches in-bounds Artifacts as today.
- [x] ADR 0011 amended, ADR 0015 consequence added, `CONTEXT.md` Engine entry, `README.md`, and `--help` say the native Engine is blocked.

## Blocked by

- 08 — script search skips Sensitive Tables

## Comments

Chosen over three alternatives: keeping the post-fetch filter with a documented
ceiling, recording the exception in ADR 0015, and warning on stderr when native
Hits were dropped. All three leave identity/HR rows arriving in the CLI process
on every native run, which is the exposure the Guard exists to prevent.
