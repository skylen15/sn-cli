# sn

Read ServiceNow from the command line. Query tables, inspect schema and config, and search server-side code without exposing commands that mutate the instance.

Built in TypeScript on Effect 4.0 (`effect/unstable/cli`). Node 24 runs the entry TypeScript directly; there is no build step.

Repository: [https://github.com/skylen15/sn-cli](https://github.com/skylen15/sn-cli)

## Requirements

- **Node 24+**
- **pnpm** (see `packageManager` in `package.json`)
- A ServiceNow instance and a Now SDK OAuth Alias (see [Authentication](#authentication))

## Install

### macOS / Linux / Git Bash

```bash
curl -fsSL https://github.com/skylen15/sn-cli/raw/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://github.com/skylen15/sn-cli/raw/main/install.ps1 | iex
```

The installer clones `main` into `~/sn-cli` when that path does not exist, updates `main` when it does, and runs `pnpm add --global .` so `sn` is linked to your `PATH`. Set `SN_INSTALL_DIR` to use a different directory.

Verify installation:

```bash
sn --help
```

### Manual Installation

```bash
git clone --branch main https://github.com/skylen15/sn-cli.git
cd sn-cli
pnpm install
pnpm add --global .
```

## Authentication

Credentials are Now SDK OAuth Aliases in your machine keychain. Add one from any working directory and complete the browser login:

```bash
sn auth add https://your-instance.service-now.com --alias dev
```

Key auth management commands:

- `sn auth list` — list saved Aliases without revealing secrets.
- `sn auth use <alias>` — set the default active Alias.
- `sn auth remove <alias>` — delete an Alias from the keychain.

Pass `--alias <name>` to select an explicit Alias for any command; omitting it defaults to the configured SDK default. Authentication failures return `SnAuthError` (exit code **3**).

## Instance Guard

To protect sensitive environments, `sn` incorporates an **Instance Guard** that blocks network requests to prohibited instances.

Blocked instances can be configured in a `sn.config.json` file in the project root:

```json
{
  "blockedInstances": ["prod.service-now.com", "prod-uat.service-now.com"]
}
```

- When `sn.config.json` is absent or `blockedInstances` is empty, no instances are blocked by default.
- Any request matching a blocked hostname is rejected before any network traffic or token refresh occurs.
- Blocked attempts fail immediately with `SnGuardError` (exit code **9**).

## Agent Rule

Install the shipped agent rule into a workspace so AI coding agents (such as Cursor) use live `sn` for schema inspection, queries, and script search rather than guessing field names:

```bash
sn rule install
```

This creates `.cursor/rules/sn-cli.mdc` in the git root or current directory.

## Commands

Command output on stdout is compact JSON. Diagnostics and errors are emitted on stderr as JSON with exit codes.

```bash
# Authentication
sn auth list

# Table queries & schema
sn table query incident --query 'active=true' --limit 5 --fields number,short_description
sn table schema incident
sn table config incident --categories business_rules --categories acls

# Script search
sn script search 'gs.info' --limit 20 --format json

# Local rule installation
sn rule install
```

## Breaking Changes in 4.0.0

- **Read-only CLI only:** The mutating commands (`record`, `batch`, and `script run`) have been removed.
- **Global OAuth Aliases:** Uses Now SDK OAuth Aliases in keychain; custom dotenv files and basic credentials have been retired.
- **Configurable Instance Guard:** Blocked instances are loaded from `sn.config.json` rather than static vendor instances.
- **Hierarchical Script Hits:** `sn script search` returns grouped hit records with matched lines and counts.

## Development

```bash
pnpm check    # type-check, format check, lint, tests
pnpm test     # run node:test suite
pnpm fmt      # format with oxfmt
```

Architectural decisions are documented under `docs/adr/`.
