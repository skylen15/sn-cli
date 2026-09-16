# 01 — OAuth Alias-only Instance Guard

**What to build:** Make Now SDK OAuth Aliases the only credential source and
prevent every ServiceNow command from obtaining a usable token for either
Blocked Instance. The rejection must happen before refresh or instance network
access and remain true even if the SDK returns an unexpected instance URL.

**Blocked by:** None — can start immediately

**Status:** done

- [x] ServiceNow commands resolve only an explicit Now SDK OAuth Alias or the
      SDK default; dotenv, custom auth environment variables, and
      client-credentials minting no longer participate.
- [x] Both exact Blocked Instance hostnames are rejected before token refresh or
      any ServiceNow HTTP call, with `SnGuardError`, exit code 9, the hostname,
      and confirmation that no request was sent.
- [x] Hostname matching is case-insensitive, ignores a trailing dot and URL
      decorations, and does not block sibling or subdomain near-matches.
- [x] A malformed stored instance URL fails as `SnAuthError` exit code 3 rather
      than a Guard denial.
- [x] A refreshed or otherwise returned token is checked again before it can be
      used.
- [x] Tests at the token-source seam prove blocked paths make zero refresh and
      HTTP calls while allowed Aliases continue to work.
