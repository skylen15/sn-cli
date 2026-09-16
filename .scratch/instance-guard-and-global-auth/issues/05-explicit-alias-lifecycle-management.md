# 05 — Explicit Alias lifecycle management

**What to build:** Let users deliberately change or remove Now SDK Aliases
through native `sn auth use` and `sn auth remove` commands without silently
switching instances.

**Blocked by:** 03 — Secret-free Alias inventory

**Status:** done

- [x] `auth use <alias>` and `auth remove <alias>` are available in both CLI
      variants and operate on the shared Now SDK keychain.
- [x] `auth use` makes an existing allowed OAuth Alias the SDK default.
- [x] `auth use` rejects missing, Basic, and Blocked Aliases without changing
      the current default or contacting an instance.
- [x] `auth remove` can remove allowed, Blocked, OAuth, and legacy Basic Aliases.
- [x] Removing the default does not choose another Alias; later implicit use
      fails and reports the Aliases still available.
- [x] Both leaves return compact JSON on success and classified, actionable
      errors with empty stdout on failure.
- [x] Aliases managed by upstream `now-sdk auth` remain visible and compatible,
      while every later ServiceNow use is still subject to the Instance Guard.
- [x] Tests use a fake Now SDK adapter and never access the real keychain.
