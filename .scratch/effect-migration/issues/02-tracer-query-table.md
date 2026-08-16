# 02 — Tracer bullet: `query-table` end to end

Status: done

## What to build

The whole stack proven by one command. Running `sn query-table incident` against
a real instance returns ServiceNow's response as compact JSON on stdout and exits
zero; a failure puts a JSON error object on stderr and exits with a classified
code.

Build the ServiceNow client as an Effect service exposing a low-level request
against the Table API, backed by `HttpClient`, with Bearer-token injection and
the 401 refresh-retry as an `HttpClient` transform rather than per-command code.
The token source resolves credentials from the Now SDK **default Alias** only for
this ticket — no `.env`, no client credentials, no `--alias`. Cache the token in a
`SynchronizedRef` so concurrent refreshers collapse into one.

Two deviations from the previous server are load-bearing and are the reason this
ticket exists rather than a straight port. **Pre-flight expiry:** read
`expires_at` (Unix seconds) off the credential and decide before calling into the
SDK's refresh path, which calls `process.exit(1)` from inside a catch block and
would otherwise kill the process and bypass the exit-code contract. **Conditional
retry:** only retry a 401 when the token source returned a genuinely different
token; when it returned the same one, fail immediately saying the token was
rejected but is not expired, so it was probably revoked.

Errors are tagged and travel the typed error channel to the exit-code mapping.
Command handlers **return** the data to emit; exactly one writer at the
entrypoint serializes it to stdout. The entrypoint must set
`disableErrorReporting: true` and supply its own `Effect.tapCause` writing to
stderr, because Effect's default logger writes to stdout and `runMain`'s error
reporting goes through it — providing `Logger.LogToStderr` alone does not fix
this.

`query-table` supports an Encoded Query, a comma-separated field list,
limit/offset paging, Display Value mode, and the exclude-reference-link option,
returning the raw response uncoerced. Delete the MCP entrypoint and the old
`query_table` tool file once ported.

Covers user stories 5–9, 21–23, 31–33, 35. Respects ADR 0001 as amended, 0004, 0007.

## Acceptance criteria

- [x] `sn query-table incident` returns raw ServiceNow JSON on stdout, compact and uncoerced, with nothing else on that stream.
- [x] Every parameter combination issues the correct Table API request — Encoded Query, fields, limit, offset, Display Value mode, exclude-reference-link — including the verbatim `--sysparm-*` escape hatch.
- [x] A non-2xx response becomes a tagged error, rendered as a JSON error object on stderr with a classified non-zero exit code. No bare non-zero exit with empty stderr is reachable.
- [x] An unhandled defect writes its cause to stderr, never stdout. Verified, not assumed — this is the trap that silently survives the naive fix.
- [x] A 401 with a genuinely refreshed token retries exactly once and succeeds; a 401 where the token source returns the same token fails immediately with a "probably revoked, re-authenticate" error rather than retrying.
- [x] A credential inside the SDK's 15-minute refresh window is pre-flighted, so the SDK's internal `process.exit(1)` is never reached.
- [x] Concurrent callers arriving with a missing or expired token trigger exactly one refresh.
- [x] Handlers return values rather than writing to stdout, so tests need no fake `Stdio`.
- [x] `node:test` checks drive the command from an argument vector with a stub client Layer, asserting the request shape, the returned value, stderr, and the exit code across the parameter matrix and both 401 paths.
- [x] The MCP entrypoint and the old `query_table` tool file are deleted.

## Comments

**Done.** Tracer bullet: Effect `SnClient` + default-Alias `TokenSource` + `query-table` command end to end.

**Command.run returns void.** Effect 4.0's `Command.run`/`runWith` discard the handler success value (`Effect<void, …>`). Handlers therefore produce a value and hand it to an `Emit` service whose live Layer (provided once at the entrypoint) serializes compact JSON; tests substitute a capturing Layer. Same "no fake Stdio" outcome as the ticket's return-value wording.

**Escape hatch shape.** Verbatim Table API params land as `--sysparm name=value` (Effect has no dynamic `--sysparm_*` flag namespace); callers pass the full `sysparm_*` key.

**Pre-flight.** Inside the 15-minute window we call `refreshAccessToken` + `storeCredentials` ourselves under `Effect.tryPromise`, never `getCredentials`, so a failed refresh is a tagged `SnAuthError` rather than the SDK catch path.
