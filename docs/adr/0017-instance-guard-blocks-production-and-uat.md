---
status: accepted
---

# Instance Guard blocks production and UAT before network access

`sn` is intended for development instances. Its former data-level Guard tried
to make broader instance access safe by excluding Sensitive Tables and
Sensitive References, but that policy was complex and unnecessary when
production instances themselves are out of bounds. The **Instance Guard**
therefore blocks configured **Blocked Instances** by exact hostname, loaded from
`sn.config.json` (or default empty list when unconfigured).

Matching parses the configured instance URL, lowercases its hostname, and
ignores a trailing dot, scheme, port, path, and query. It does not match sibling
or subdomain hostnames. A malformed instance URL is an authentication/config
failure, not a Guard denial.

The blocked set is loaded at runtime from `sn.config.json`.
`TokenSource` owns the policy for ServiceNow commands: it
checks the locally resolved Alias before any token refresh, then checks the
Blocked Instance. `auth add` applies the same policy to its explicit URL before
starting the SDK's OAuth flow. Reading local Alias/keychain state is allowed;
network access to a configured Blocked Instance is not. This is protection
against accidental configuration, not a security boundary against DNS aliases,
redirects, or a hostile credential holder.

Every instance-facing leaf inherits the policy through `TokenSource`. Parsing,
help, and local-only `rule install` remain available because they do not contact
an instance. A denial remains `SnGuardError` with exit code **9**, and names the
blocked hostname while stating that no request was sent.

This supersedes ADR 0015. Sensitive Table and Sensitive Reference filtering,
inheritance and Dictionary fail-closed lookups, `.sn-guard`, write-response
stripping, and the Guard-specific ban on the native Search Engine are removed.
All non-blocked instances are trusted for read operations.
