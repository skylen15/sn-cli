# ServiceNow client seam owns auth, refresh, and errors

All ServiceNow HTTP access goes through a single client exposing a low-level `request(path, params)`. The client owns the token lifecycle (cache token, refresh purely reactively on a `401`, retry once) and error parsing (non-2xx → throw `SnError` whose `.message` is the extracted ServiceNow `error.message`/`detail`). Commands live one-per-file under `src/commands/` and build their own URLs on top of `request()`; they contain pure logic with no auth, no retry, and no try/catch around the seam.

Refresh is a single seam that re-runs the auth-type's token source: `now-sdk` re-calls `getCredentials(alias)` (the SDK's `getRefreshedCredentials` uses the stored `refresh_token` and persists the new token to the keychain); `client_credentials` re-calls `getClientCredentialsToken(...)`. If the refresh itself fails (dead `refresh_token`), the second `401` throws a clean `SnError` telling the user to re-run `pnpm now-sdk:auth`.

## Considered Options

- **Token lifecycle:** purely reactive refresh-on-401 (chosen) over background refresh timers (extra moving parts, can drift/leak across a long-lived process), over fetching a fresh token per call (wasteful round-trip), and over tracking expiry ourselves (the now-sdk path's `getCredentials` already self-refreshes, so client-side expiry tracking would re-implement clock/expiry logic the SDK owns). Cost of reactive-only: one wasted round-trip on the first call after a >30-min idle gap.
  - **Grounded in ServiceNow docs (australia/latest, Tier 1 official).** The access token has a default **absolute** lifespan of 1800s / 30 min (not idle-based); the refresh token defaults to 8,640,000s / ~100 days. With the default `glide.authenticate.oauth.post.token.expiration.cookie_auth.disabled=true` hardening, "Sessions end immediately when the access token expires" and "long-running jobs without token renewal logic may encounter 401 errors" — while "integrations that renew tokens proactively" / "standard OAuth flows with refresh tokens" keep working. Our cache + 401-refresh is exactly that renewal logic, so the cache is justified: it serves every call within the 30-min window without re-minting, and self-heals on expiry. (`platform-security/instance-security-hardening-settings/sc-invalidate-session-after-oauth-token-expiration.md`; `platform-security/authentication/configure-an-oauth-client-credential-grant.md`; `platform-security/authentication/t_CreateEndpointforExternalClients.md`.)
- **Retry scope:** the only automatic retry is the single 401-refresh retry, which is safe because a 401 means the request was rejected, not executed. Transient failures (429, 5xx, network) **fail fast** → `SnError` → classified exit code on stderr (ADR 0007); the caller decides whether to retry. We deliberately do **not** add blanket retry-with-backoff: it would risk duplicate writes on non-idempotent (POST) commands, and the caller is a better retry judge than the client.
- **Client surface:** one generic `request()` (chosen) over per-API typed helpers; typed helpers can be added later only when a command repeats a pattern.

## Consequences

- **No error wrapper at the seam.** Commands throw `SnError`; the CLI entrypoint maps tagged errors to stderr JSON and classified exit codes (ADR 0007). Do **not** add a per-command try/catch that swallows or re-packages those errors — it would duplicate the entrypoint contract.

## Amendment: the retry is conditional, and we do track expiry

The seam and the fail-fast retry scope above stand. Two specifics do not, because they rested on a premise about `getCredentials` that turned out to be false. The Now SDK's refresh is **gated on the locally-recorded `expires_at`**: it only refreshes when the token is within 15 minutes of expiry, and otherwise hands back whatever is stored. So a token revoked server-side while still nominally unexpired yields a 401, and re-calling the token source returns the _same_ stale token — the refresh-on-401 retry cannot break that deadlock, it just fails twice. Only `now-sdk auth --add` recovers it.

- **The 401 retry is conditional.** Retry only when the token source returned a token genuinely different from the one that just failed. When it returned the same token, fail immediately with an error saying the token was rejected but is not expired, so it was probably revoked, and to re-authenticate. That message is worth more to the caller than a silent second attempt.
- **We do pre-flight expiry**, reversing the "tracking expiry ourselves" option rejected above. The rejection assumed the SDK owns the clock logic safely, but its refresh path calls `process.exit(1)` from inside a catch block when a refresh fails — killing the process from library code, uncatchable, unwrappable, and bypassing the exit-code contract in ADR 0007. Since we read the credential anyway to get `instanceUrl` and `access_token`, reading `expires_at` (Unix seconds) alongside it costs one comparison and converts the most common auth failure into a real error with a real exit code. This is calibration against the platform as it actually behaves, not re-implementing the SDK's refresh.

The `.do` path and write commands were later retired by ADR 0019. For how this
seam is reached from the CLI front-end, see ADR 0004; for current auth mode
selection, see ADR 0018.

## Amendment: OAuth Aliases are the only token source

ADR 0018 supersedes ADR 0005 and removes client-credentials and dotenv-based
configuration. `TokenSource` now resolves only Now SDK OAuth Aliases, refreshes
inside the SDK refresh window, and maps refresh failures to `SnAuthError`.
Re-authentication guidance points users to the global `sn auth` commands. The
client seam still owns the conditional retry after a `401`: it retries only
when `TokenSource` returns a different token.

ADR 0017 also makes `TokenSource` the Instance Guard boundary. It rejects the
production and UAT Blocked Instances before refresh and validates the refreshed
token again before returning it, so the client cannot send an HTTP request to
either hostname.
