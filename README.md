# sn

ServiceNow from the command line. Query and mutate tables, inspect schema and
config, search server-side code, run background scripts, and install agent rules
through grouped commands on a locally installed `sn` binary.

Built in TypeScript on Effect 4.0 (`effect/unstable/cli`). Node 24 runs the
entry TypeScript directly; there is no build step.

## Requirements

- **Node 24+**
- **pnpm** (see `packageManager` in `package.json`)
- A ServiceNow instance and credentials (see [Authentication](#authentication))

## Install

Quick install via [`install.sh`](./install.sh) — checks prerequisites (Node 24+,
installs pnpm if missing), clones the repo into `~/.sn-cli`, and links `sn` onto
your `PATH`:

```bash
curl -fsSL https://raw.githubusercontent.com/skylen15/sn-cli/main/install.sh | bash
```

Or install manually:

```bash
git clone <this-repo-url>
cd sn-cli
pnpm install
pnpm add --global .
```

Confirm `sn` is on your `PATH` (pnpm's global bin directory must be on it), then:

```bash
sn --help
```

Copy `.env.example` to `.env` only when you need to pin a mode or Alias; with no
config file, `sn` uses your Now SDK default Alias.

## Authentication

Two modes. Pick **one**.

**Which mode?**

- **`now-sdk`** — best for **local development**. Log in once through an
  interactive browser flow; the SDK stores the OAuth credential under an Alias
  and self-refreshes it. Nothing secret ends up in `.env`.
- **`client_credentials`** — best for **CI / headless / shared** runs. No
  interactive login: `sn` mints a token from a client ID + secret. Requires
  one-time setup inside ServiceNow (below) and puts a secret in `.env`, so keep
  that file out of version control.

Config resolution: walk up from the current directory for `.env`, stop at
`$HOME`, never above it. Real environment variables override file entries. When
config is present, `SN_AUTH_TYPE` must be set explicitly — mode is never
inferred from which keys are set. Alias selection is `--alias`, then
`SN_AUTH_ALIAS`, then the SDK default.

### Mode 1 — Now SDK Alias (`now-sdk`)

```bash
pnpm now-sdk:auth --add https://your-instance.service-now.com --type oauth --alias default
```

Follow the prompts. Use `pnpm now-sdk:auth --list` to see stored Aliases and
`--use <alias>` to change the default. The credential must be **OAuth**
(`--type oauth`).

Optional `.env` when you want a non-default Alias without passing `--alias`:

```ini
SN_AUTH_TYPE=now-sdk
SN_AUTH_ALIAS=default
```

### Mode 2 — OAuth client credentials (`client_credentials`)

Needs the **`oauth_admin`** (or `admin`) role and the **OAuth 2.0** plugin.

1. **Enable the client-credentials grant.** In the nav filter go to
   `sys_properties.list`, create a System Property named
   `glide.oauth.inbound.client.credential.grant_type.enabled`, type
   `true | false`, value `true`.
2. **Create the OAuth endpoint.** **All > System OAuth > Application Registry >
   New**, choose **Create an OAuth API endpoint for external clients**, give it
   a **Name**, and **Submit**. Note the **Client ID** and **Client Secret**.
3. **Set OAuth Application User** on that client to the account whose roles the
   calls should run as.
4. Fill in `.env`:

```ini
SN_AUTH_TYPE=client_credentials
SN_CLIENT_ID=your_client_id
SN_CLIENT_SECRET=your_client_secret
SN_INSTANCE_URL=https://your-instance.service-now.com
```

## Commands

Every command prints compact JSON on stdout. Errors go to stderr with a
classified exit code. For flags and defaults, run `sn <command> --help`.

### `rule install`

Install the shipped agent instructions in the current repository. General
agents use `AGENTS.md` by default; Cursor and Claude are explicit platforms.

```bash
sn rule install
sn rule install --platform cursor
sn rule install --platform claude
```

### `table query`

Read records with an Encoded Query, field list, paging, and Display Value mode.

```bash
sn table query incident --query 'active=true' --limit 5 --fields number,short_description
```

### `table schema`

Discover Dictionary columns (including inherited), with Reference targets and
Choice lists.

```bash
sn table schema incident
```

### `table config`

Reconstruct configuration across the inheritance chain — business rules, client
scripts, UI policies/actions, ACLs, data policies, notifications, and classic
workflows. Limit with `--categories` (repeatable).

```bash
sn table config incident --categories business_rules --categories acls
```

### `script search`

Find a code snippet via ServiceNow Code Search.

```bash
sn script search 'gs.info' --limit 20 --format json
```

### `record create`

Insert a Record; returns the created Record uncoerced. Repeat `--field`.

```bash
sn record create incident --field short_description='Example' --field urgency=3
```

### `record update`

Partial PATCH by `sys_id`; returns the updated Record uncoerced.

```bash
sn record update incident <sys_id> --field urgency=2
```

### `record delete`

Delete by `sys_id`; confirms with `{ sys_id, deleted: true }`.

```bash
sn record delete incident <sys_id>
```

### `batch update`

PATCH each item in an explicit JSON list of `{ "sys_id", "fields" }`. Continues
past per-item failures and returns a per-item status array.

```bash
sn batch update incident '[{"sys_id":"...","fields":{"urgency":"2"}}]'
```

### `batch delete`

DELETE each `sys_id` in an explicit list. Continues past per-item failures.

```bash
sn batch delete incident <sys_id_1> <sys_id_2>
```

### `script run`

Execute server-side JavaScript. This is remote code execution by design: the
script runs with the authenticated user's full rights. Primary path is
`sys.scripts.do` (synchronous, returns console output); if that processor
refuses the session, falls back to a `sys_trigger` Scheduled Job. The `via`
field in the result says which path ran.

```bash
sn script run 'gs.info("hello");'
```

## Breaking changes (next release)

`sn script search` stdout is an array of **Hits**, not one flat row per Field
match:

```
Hit          { sysId, name, table, fieldMatches[] }
FieldMatch   { field, matchedLineCount, omittedMatchedLines, lines[] }
Line         { lineNumber, content, matched }
```

`--format text` groups Field matches under each Record. The default Engine is
**GraphQL** (`--engine graphql`); use `--engine native` for Code Search when
GraphQL is unavailable on the instance. A GraphQL failure fails loudly and names
`--engine native` — there is no silent fallback.

## Development

```bash
pnpm check    # type-check, format check, lint, tests
pnpm test     # node:test
pnpm format   # prettier --write
```

See [`AGENTS.md`](./AGENTS.md) for agent conventions and `docs/adr/` for the
decisions behind the design.
