---
status: accepted
---

# The Engine is chosen, never detected

The browser tool this approach is ported from defaults to an automatic Engine
choice and runs a capability probe before every search. It has to: GraphQL
answers an unauthenticated browser session with an empty `HTTP 200`, which is
indistinguishable from a search that found nothing, so a probe, a second
confirming probe, and a whole "unverified artifact" concept exist to contain
that one behaviour. `sn` has no browser session — the client seam reads
`expires_at` and decides before calling in, and refreshes once on a `401`
(ADR 0001) — so that premise does not hold here. `--engine` is therefore an
explicit choice defaulting to the GraphQL Engine, and a GraphQL failure fails
loudly naming `--engine native` instead of quietly becoming one.

## Consequences

- The capability probe, the confirming probe, and unverified artifacts are all
  dropped from the port. This is the largest single scope cut in the work.
- Silent fallback was rejected for the same reason exit code 7 exists
  (ADR 0012): a caller handed weaker results without being told cannot tell
  absence from a bounded search.
- Someone on an instance with GraphQL switched off pays one failed run before
  they learn the flag. That is cheap and self-correcting.
- Whether `/api/now/graphql` really does answer an expired **Bearer** token with
  an empty `HTTP 200` — as opposed to an honest `401` — is unconfirmed; every
  source describes cookie sessions only. If it turns out to, that is a known risk
  recorded here, not a reason to reinstate a probe on every search.

## Amendment: there is only one Engine left to choose

Chosen-not-detected stands, and so does failing loudly rather than falling back.
What no longer stands is the other side of the choice: read "loudly naming
`--engine native`" above, and "pays one failed run before they learn the flag"
below, as history — the native Engine is **blocked by the Guard** (ADR 0015). ServiceNow's Code Search API takes no Table
filter, so it always searches Sensitive Tables and `sn` could only drop their
Hits after the response arrived — the fetch-then-drop that ADR 0015 refuses for
reads. The GraphQL Engine names its Artifacts in the query, so it can leave
Sensitive Tables out before any HTTP.

- **`--engine native` fails with `SnGuardError` and exit 9**, before any request.
  The flag keeps the choice rather than dropping it, because an agent that asks
  for the Engine deserves the Guard's reason instead of a flag-parse error.
- **A GraphQL failure no longer names a fallback.** The message says GraphQL is
  the only Search Engine and the native one is Guard-blocked. Someone on an
  instance with GraphQL switched off now has no `sn` path to code search at all;
  that cost is accepted over a path that reads identity Tables on every run.
- **`--search-all-scopes` and `--current-app` are gone**, along with the native
  request and Hit mapping they fed. A flag that can never take effect is the
  same theatre ADR 0015 rejected `--force` for.

## Amendment: the native Engine is available again

ADR 0017 supersedes the data-level Guard in ADR 0015. On every allowed instance,
`--engine native` is therefore available again and relies on ServiceNow ACLs
like the GraphQL Engine. The explicit-choice and no-fallback decisions still
stand: GraphQL remains the default, a caller chooses native explicitly, and a
failure never silently switches Engines.
