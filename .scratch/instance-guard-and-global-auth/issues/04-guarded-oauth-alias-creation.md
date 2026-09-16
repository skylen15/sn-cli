# 04 — Guarded OAuth Alias creation

**What to build:** Let a user create a Now SDK OAuth Alias through
`sn auth add` while validating the target before browser authentication,
protecting existing credentials, and preserving the CLI output contract.

**Blocked by:** 03 — Secret-free Alias inventory

**Status:** done

- [x] `sn auth add <instance-url> --alias <name>` is available in both CLI
      variants and uses the Now SDK browser OAuth flow and keychain.
- [x] The instance input must be an HTTPS origin; a trailing slash is accepted,
      while embedded credentials, non-root paths, query, fragment, non-HTTPS,
      and malformed URLs fail before OAuth.
- [x] A Blocked Instance is rejected before opening a browser or sending any
      request.
- [x] An existing Alias is never overwritten; the error clearly instructs the
      user to run `sn auth remove <alias>` and retry.
- [x] The first Alias becomes default, while later additions preserve the
      existing default.
- [x] The command does not require a TTY, allowing an agent or task to launch it
      while a human completes the browser flow.
- [x] OAuth instructions and progress use stderr; only the final compact JSON
      result uses stdout.
- [x] Cancellation or login failure leaves stdout empty and returns
      `SnAuthError` exit code 3.
- [x] Tests use a fake Now SDK adapter and prove rejected inputs never invoke
      browser OAuth or keychain writes.
