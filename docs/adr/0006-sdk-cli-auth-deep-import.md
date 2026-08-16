---
status: accepted
---

# Deep-import the Now SDK's auth internals, pinned exact

`sn` reads Now SDK credentials by importing `@servicenow/sdk-cli/dist/auth/index.js` directly. This is an unsupported deep import into a build output: the package ships **no `exports` map at all**, so the subpath resolves only because Node permits any subpath in that case; `dist/index.js` does not re-export these functions; and ServiceNow's documentation only ever describes the `now-sdk` CLI, never programmatic use of this package as a library. We accept the fragility, pin `@servicenow/sdk-cli` to an **exact** version rather than a caret range, and record it here so an upgrade failure is diagnosed rather than rediscovered.

The credential store itself is global per-user: the OS keychain (macOS Keychain via `@napi-rs/keyring`) under service `ServiceNow`, account `now-sdk`, holding one JSON blob keyed by Alias. Nothing in the auth chain touches `process.cwd()` or reads a config file, which is what makes a globally-installed binary safe to run from any directory.

## Considered Options

- **Deep import, pinned exact (chosen)** — three functions that work today, and the only option that costs nothing per invocation.
- **Shell out to the `now-sdk` binary** and use only its documented surface — rejected: it means spawning a process and parsing human-formatted output on every single command, to avoid a risk that a version pin already contains.
- **Reimplement the keychain read** against `@napi-rs/keyring` directly, now that the service name, account name, and JSON shape are known — rejected: it means owning a credential format ServiceNow can change without telling us, which trades a loud failure for a silent one.

## Consequences

- **The failure mode is abrupt and diagnosable.** The day ServiceNow adds an `exports` field, this becomes a hard `ERR_PACKAGE_PATH_NOT_EXPORTED` at import time — not a subtle misbehaviour. Restructuring `dist/` would fail similarly loudly.
- **A native module is in the dependency graph.** `@napi-rs/keyring` is N-API with prebuilt binaries for darwin, linux, win32, and freebsd on arm64 and x64, so Node 24 and global installs are fine — but `sn` cannot be bundled to a single pure-JS file, and in a container with no secret service `getPassword()` returns `null` silently, which is indistinguishable from "no credentials stored".
- **The keychain item's ACL is permissive.** A plain `node` process running as the user read it in 29ms with no GUI prompt, so an agent-invoked CLI will not hang on an authorization dialog. The security consequence is the other side of that coin: any local process running as this user can read the ServiceNow refresh token. A _locked_ login keychain remains the one plausible route to a blocking system dialog, and this was only observed on macOS.
- **The credential is a two-member union on `type`** — `oauth` (with `access_token`, `token_type`, `refresh_token`, and `expires_at` in Unix **seconds**) or `basic` (with `username`/`password`). The existing `type !== "oauth"` guard is correct and exhaustive.
