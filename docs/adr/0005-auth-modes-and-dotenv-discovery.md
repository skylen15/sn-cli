---
status: accepted
---

# Two auth modes, selected by the nearest `.env`

`sn` keeps both auth modes: the Now SDK auth Alias (the zero-config default) and OAuth client credentials. With no configuration anywhere, `sn` authenticates as your default Alias, because the Alias already carries `instanceUrl` alongside the token — so the whole configuration surface can collapse to _which Alias_. A project that needs a specific instance or a service identity drops a `.env` beside its code and pins itself explicitly.

**Config resolution.** Walk up from the current working directory looking for `.env`, stopping at `$HOME` inclusive and never going above it. The first file found wins; real environment variables override its entries (Effect's `ConfigProvider.fromDotEnv` composed via `ConfigProvider.layerAdd` gives this precedence natively, no `dotenv` dependency). One rule with no special cases: it yields per-project config where you want it, an optional `~/.env` machine-wide fallback, and it can never read a stray `.env` from `/` or another user's home. Stopping at the git root was rejected — it needs a second rule for when you are not in a repo, and behaves confusingly one directory outside one.

**Mode selection is explicit, never inferred.** Where config is found, `SN_AUTH_TYPE` must say which mode (`Config.literals(["now-sdk", "client_credentials"], "SN_AUTH_TYPE")`). Where no config is found at all, `sn` uses the Now SDK default Alias. Switching mode implicitly based on which keys happen to be present was rejected: it is the behaviour that misleads you at 2am. `SN_CLIENT_SECRET` is read through `Config.redacted`, so it prints as `<redacted>` unless explicitly unwrapped.

**Alias selection** is `--alias`, then `SN_AUTH_ALIAS`, then the SDK's own default (`getCredentials(undefined)` resolves it; the first profile ever stored is automatically the default). When nothing resolves, fail with the Aliases actually available on this machine listed, and name the command that creates one — `fetchCredentials()` returns alias → `{ isDefault, instanceUrl, type }` with no secrets. For an agent-invoked CLI the error message is the entire user interface for this failure, and "no alias configured" burns a turn where a list does not.

## Consequences

- **Trust boundary: announce a discovered `.env`.** Reading credentials from whatever directory you are standing in means `sn` can silently target the wrong instance — and half the commands write, including `run-background-script`, which executes arbitrary server-side JavaScript. Whenever a discovered `.env` file is the config source, print one line to stderr naming the file's absolute path and the instance host (never the secret). Stay silent when config came from real environment variables or the Now SDK default, which are the unsurprising cases. stdout stays clean, so this does not touch the output contract in ADR 0007. A `--yes` gate on writes was rejected: the CLI is agent-first precisely to avoid interactive friction, and a prompt an agent must learn to satisfy is worse than a line it can read.
- **Headless CI does not need a third path.** The SDK bypasses the keychain entirely when `SN_SDK_NODE_ENV=SN_SDK_CI_INSTALL`, reading `SN_SDK_INSTANCE_URL` plus basic or client-credential env vars.
- **`fetchCredentials()` and `removeCredentials()` return empty when `NODE_ENV === "test"`.** Tests must not run under that value, or Alias enumeration silently reports zero profiles.
- **`getCredentials` throws on a missing Alias rather than returning null**, so the current `!credential` guard in `src/servicenow/auth.ts` is dead code and a raw `Error` escapes where an `SnError` was intended. The port fixes this rather than reproducing it.
