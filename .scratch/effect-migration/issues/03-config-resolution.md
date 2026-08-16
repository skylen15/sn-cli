# 03 — Config resolution and both auth modes

Status: done

## What to build

`sn` learns where to get its credentials from, so a project can pin the instance
its agents talk to. Dropping a `.env` in a directory and running `sn query-table`
from a subdirectory targets that instance; running it with no `.env` anywhere
still works off the default Alias, exactly as ticket 02 left it.

Discover config by walking up from the working directory looking for `.env`,
stopping at `$HOME` **inclusive** and never above it, first match winning. Real
environment variables override file entries. Build it on
`ConfigProvider.fromDotEnv` composed with `ConfigProvider.layerAdd` — no `dotenv`
dependency, and no cwd-only lookup.

Add the OAuth client-credentials mode back alongside the Now SDK Alias mode,
selected **explicitly** by `SN_AUTH_TYPE` wherever config is found; where no
config is found anywhere, the Now SDK default Alias is used. Mode is never
inferred from which keys happen to be present. The client secret is read through
`Config.redacted` so it renders as `<redacted>` unless explicitly unwrapped.

Alias selection is `--alias`, then `SN_AUTH_ALIAS`, then the SDK's own default.
When nothing resolves, fail with the Aliases actually available on this machine
listed and the command that creates one named — the SDK exposes a secret-free
preview call for this. For an agent, that error message is the entire user
interface for this failure.

Finally, the trust boundary: whenever a **discovered `.env` file** was the config
source, print one line to stderr with the file's absolute path and the instance
host, never the secret. Stay silent when config came from real environment
variables or the default Alias, which are the unsurprising cases.

Covers user stories 11–20. Respects ADR 0005, 0006.

## Acceptance criteria

- [x] With no config anywhere, commands still authenticate via the Now SDK default Alias.
- [x] A `.env` in an ancestor directory is found from a nested working directory; the nearest one wins when several exist.
- [x] The walk stops at `$HOME` inclusive and never reads a `.env` above it.
- [x] Real environment variables override entries from the discovered file.
- [x] `SN_AUTH_TYPE` selects the mode explicitly wherever config exists; a config set with client-credential keys but no declared type is an error, not an inference.
- [x] Both auth modes resolve a token and reach the instance.
- [x] The client secret never appears in any diagnostic or error output.
- [x] Alias precedence is `--alias`, then `SN_AUTH_ALIAS`, then the SDK default; an unresolvable Alias fails with the available Aliases listed and the creating command named.
- [x] A discovered `.env` is announced on stderr with its absolute path and the instance host; no announcement when config came from environment variables or the default Alias; stdout is untouched either way.
- [x] Config resolution is tested at its own seam — a starting directory in, resolved config or a tagged error out — against temporary directory trees covering the nested, several-candidates, and at-`$HOME` cases.
- [x] Tests do not run with `NODE_ENV=test`, which would make the SDK's Alias enumeration silently report zero profiles.

## Comments

**Done.** Config walk + `ConfigProvider.fromDotEnv`/`layerAdd`, both auth modes, `--alias` / `SN_AUTH_ALIAS` precedence, Alias-list failure, `.env` stderr announcement.
