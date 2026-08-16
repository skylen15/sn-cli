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
