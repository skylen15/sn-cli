# 07 — Complete the global CLI contract

**What to build:** Present the finished Instance Guard and OAuth Alias model as
one coherent global CLI experience, with accurate help and documentation,
stable machine output, and repository-wide verification.

**Blocked by:** 02 — Safe SDK default selection; 04 — Guarded OAuth Alias
creation; 05 — Explicit Alias lifecycle management; 06 — Retire the data-level
Guard

**Status:** done

- [x] Root and group help describe the Instance Guard, Blocked Instances,
      OAuth Alias selection, `--yes/-y`, and the independent Background Script
      confirmation accurately.
- [x] The Read-only CLI help exposes exactly `table`, `script`, `auth`, and
      `rule`, while mutating ServiceNow groups remain Full CLI-only.
- [x] User and maintainer documentation explains global Alias setup and
      management without instructing users to configure dotenv or client
      credentials.
- [x] Current documentation no longer presents Sensitive Table/Reference
      filtering, `.sn-guard`, or native Search Engine prohibition as active
      behavior; superseded ADRs remain historical.
- [x] Smoke tests cover auth command registration, global shared flags before
      and after subcommands, clean stdout, classified errors, unrelated working
      directories, and symlink/global-install invocation.
- [x] Existing output and exit codes remain stable, including
      `SnGuardError` exit code 9 and `SnAuthError` exit code 3.
- [x] Release-facing notes identify removal of dotenv/client credentials and
      the data-level Guard as breaking behavior.
- [x] The repository's full type-check, format check, lint, and test command
      passes.
