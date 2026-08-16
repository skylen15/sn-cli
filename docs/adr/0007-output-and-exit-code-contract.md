---
status: accepted
---

# stdout carries ServiceNow JSON and nothing else

`sn` is invoked by coding agents, so its output is a machine contract. stdout carries the raw ServiceNow response as compact JSON, uncoerced and unwrapped. Diagnostics, warnings, and errors go to stderr as a JSON error object, and the process exits with a **classified** code so a caller can branch without parsing text.

Raw passthrough was chosen over our own `{ ok, data }` envelope because an envelope is a translation layer nobody asked for: it would obscure ServiceNow's own field shapes — notably `sysparm_display_value=all`, which returns each field as a `{value, display_value}` object rather than a scalar. Compact over pretty, because tokens are the cost the primary consumer pays.

Exit codes are classified rather than binary because the tagged-error taxonomy exists anyway (ADR 0001), so mapping each tag to a code is nearly free, and it is the difference between an agent knowing to re-authenticate and knowing to fix its arguments. Keep the set small, and **never renumber it** — exit codes become a public contract the moment anything scripts against them. The one behaviour explicitly ruled out is a bare non-zero exit with empty stderr, the failure mode that burns the most agent turns.

## Consequences

- **Effect's default logger writes to stdout, which would corrupt the contract.** `runMain`'s error reporting goes through that logger, so an unhandled error dumps its cause into the same stream carrying the JSON. Providing `Logger.LogToStderr` alone does **not** fix this, because `runMain` wraps the effect from the outside via `Effect.tapCause`. The verified fix is `disableErrorReporting: true` plus our own `Effect.tapCause` writing `Cause.pretty(cause)` to stderr — required part of the entrypoint, not a nicety. Custom codes come from `Runtime.errorExitCode`.
- **The SDK can bypass the taxonomy by exiting the process itself.** `refreshAccessToken` calls `process.exit(1)` from inside its catch block on a failed refresh, which cannot be caught or wrapped. `sn` pre-empts this by reading `expires_at` off the credential and deciding before calling in — see ADR 0001's amendment. Without that, the most common auth failure is the one failure that produces no JSON on stderr.
