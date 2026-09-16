# 02 — Safe SDK default selection

**What to build:** Make implicit use of the SDK default Alias visible and
appropriate to the invocation context: interactive users confirm it, non-TTY
read-only callers receive an announcement, and non-TTY mutations require an
explicit target.

**Blocked by:** 01 — OAuth Alias-only Instance Guard

**Status:** done

- [x] An explicit `--alias` proceeds without a default-Alias prompt and remains
      subject to the Instance Guard.
- [x] A TTY invocation without `--alias` prints the default Alias and hostname
      on stderr and accepts only `y` or `yes` before any network access.
- [x] Global `--yes` and `-y` skip only the default-Alias confirmation.
- [x] A non-TTY read-only leaf may use the SDK default after announcing Alias
      and hostname on stderr; stdout remains clean.
- [x] A non-TTY mutating leaf without `--alias` fails before network access even
      when `--yes` is present.
- [x] Read-only versus mutating behavior follows leaf classification and is the
      same in the Read-only CLI and Full CLI.
- [x] Rejection returns `SnAuthError` exit code 3 with empty stdout and
      actionable `--alias` guidance.
- [x] The independent Background Script TTY confirmation remains required and
      cannot be bypassed by `--yes`.
- [x] The full decision matrix is covered at the shared policy seam, with one
      representative read-only and one mutating command integration check.
