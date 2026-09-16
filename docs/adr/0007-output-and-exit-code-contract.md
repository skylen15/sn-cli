---
status: accepted
---

# stdout carries ServiceNow JSON and nothing else

`sn` is invoked by coding agents, so its output is a machine contract. stdout carries the raw ServiceNow response as compact JSON, uncoerced and unwrapped. Diagnostics, warnings, and errors go to stderr as a JSON error object, and the process exits with a **classified** code so a caller can branch without parsing text.

Raw passthrough was chosen over our own `{ ok, data }` envelope because an envelope is a translation layer nobody asked for: it would obscure ServiceNow's own field shapes — notably `sysparm_display_value=all`, which returns each field as a `{value, display_value}` object rather than a scalar. Compact over pretty, because tokens are the cost the primary consumer pays.

Exit codes are classified rather than binary because the tagged-error taxonomy exists anyway (ADR 0001), so mapping each tag to a code is nearly free, and it is the difference between an agent knowing to re-authenticate and knowing to fix its arguments. Keep the set small, and **never renumber it** — exit codes become a public contract the moment anything scripts against them. The one behaviour explicitly ruled out is a bare non-zero exit with empty stderr, the failure mode that burns the most agent turns.

## Advisory remediation hints

An individual classified error may add an optional top-level `hint` string to
its stderr JSON object. `message` diagnoses what happened; `hint` gives a short,
safe next action in English, including an exact command when the error site
knows enough context to provide one. Existing messages remain unchanged, nested
search payloads remain unchanged, and `hint` is omitted rather than filled with
generic advice when no concrete remediation is known.

The error site supplies the hint; the central renderer only serializes it. Exit
codes and tags are too broad to choose remediation safely: one `SnAuthError`
may require selecting an Alias while another requires re-authentication, and
one `SnRequestError` may be a validation failure while another may be an
ambiguous transport failure. Read-only or idempotent call sites may recommend a
retry when they can establish that it is safe.

The `hint` field is an additive output contract, but its prose is advisory and
may improve over time. Callers branch on the exit code, `_tag`, `status`, and
other structured fields; they do not parse `message` or `hint`. A hint may also
direct the caller to inspect `reasons` and `unsearched` for an incomplete
search. Hints never contain tokens or credentials.

## Consequences

- **Effect's default logger writes to stdout, which would corrupt the contract.** `runMain`'s error reporting goes through that logger, so an unhandled error dumps its cause into the same stream carrying the JSON. Providing `Logger.LogToStderr` alone does **not** fix this, because `runMain` wraps the effect from the outside via `Effect.tapCause`. The verified fix is `disableErrorReporting: true` plus our own `Effect.tapCause` writing `Cause.pretty(cause)` to stderr — required part of the entrypoint, not a nicety. Custom codes come from `Runtime.errorExitCode`.
- **The SDK can bypass the taxonomy by exiting the process itself.** `refreshAccessToken` calls `process.exit(1)` from inside its catch block on a failed refresh, which cannot be caught or wrapped. `sn` pre-empts this by reading `expires_at` off the credential and deciding before calling in — see ADR 0001's amendment. Without that, the most common auth failure is the one failure that produces no JSON on stderr.
