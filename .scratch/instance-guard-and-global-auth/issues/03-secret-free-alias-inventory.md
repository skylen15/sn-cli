# 03 — Secret-free Alias inventory

**What to build:** Give global CLI users a native `sn auth list` command that
shows the Now SDK Aliases already available on the machine without exposing
credentials or requiring repository-local tooling.

**Blocked by:** 01 — OAuth Alias-only Instance Guard

**Status:** ready-for-agent

- [ ] The `auth` group and `list` leaf are available in both the Read-only CLI
      and Full CLI.
- [ ] `auth list` returns compact JSON entries containing only `alias`,
      `instanceUrl`, `isDefault`, `type`, and `blocked`.
- [ ] Existing OAuth, Basic, allowed, and Blocked Aliases are all represented
      accurately without exposing tokens, refresh tokens, usernames, passwords,
      or other credential material.
- [ ] No stored credentials returns `[]` successfully.
- [ ] Listing is local keychain inspection: it does not prompt for a default
      Alias or contact an instance.
- [ ] Command, help, output, and failure behavior are tested through a fake Now
      SDK adapter and captured CLI output without touching the real keychain.
