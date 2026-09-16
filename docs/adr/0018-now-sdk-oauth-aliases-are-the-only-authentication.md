---
status: accepted
---

# Now SDK OAuth Aliases are the only authentication

`sn` is a global CLI for developers and local coding agents, not a headless CI
service. Authentication therefore uses only Now SDK OAuth Aliases stored in the
machine keychain. The `client_credentials` mode, walk-up `.env` discovery, and
the `SN_AUTH_TYPE`, `SN_AUTH_ALIAS`, `SN_CLIENT_ID`, `SN_CLIENT_SECRET`, and
`SN_INSTANCE_URL` variables are removed. A ServiceNow command selects its Alias
explicitly with `--alias`, or considers the SDK default under the confirmation
policy below; it never changes identity because of its working directory or
process environment.

In a TTY, an instance-facing command without `--alias` prints the default
Alias and hostname on stderr and accepts only `y`/`yes` before continuing.
Global `--yes` / `-y` skips this confirmation. In a non-TTY, an
instance-facing leaf may use the default without prompting but must announce the
Alias and hostname on stderr. An explicit `--alias` never prompts. These rules
do not weaken the Instance Guard.

The Read-only CLI exposes native `auth add`, `auth list`, `auth use`, and `auth
remove` leaves over the already-installed Now SDK APIs. They are `sn` commands
rather than a pass-through to `now-sdk auth`, so they retain compact JSON
stdout, tagged errors, classified exit codes, OAuth-only credentials, and the
Instance Guard. The adapter reuses the SDK's browser OAuth flow and keychain;
`sn` does not implement either protocol.

`auth add <instance-url> --alias <name>` requires an explicit HTTPS origin and
Alias. A trailing slash is accepted; credentials in the URL, a non-root path,
query, or fragment are rejected. It applies the Instance Guard before opening
the browser or sending a request, fails with explicit
`sn auth remove <alias>`-then-retry guidance when the Alias already exists, and
needs no TTY because a human may complete the browser flow after an agent or
task launches it. OAuth instructions and progress use stderr; only the final
compact JSON result uses stdout. Cancellation or login failure leaves stdout
empty and returns `SnAuthError` with exit code **3**. The first Alias becomes
default; later additions do not replace an existing default. `auth use` rejects
missing, non-OAuth, and Blocked Aliases. `auth remove` removes one Alias and
never chooses a replacement default.

`auth list` returns a secret-free JSON array containing `alias`, `instanceUrl`,
`isDefault`, `type`, and `blocked`; no credentials returns `[]`. Existing
Blocked or Basic Aliases remain visible and removable even though `sn` cannot
select or use them. The upstream `now-sdk auth` command may still manage the
same keychain outside `sn`; regardless of how an Alias was created or made
default, the Instance Guard prevents `sn` from connecting to a Blocked
Instance.

This supersedes ADR 0005. The deliberate cost is that `sn` no longer supports
headless client-credentials authentication. That capability can return only if
a concrete non-interactive use case justifies a second auth model.
