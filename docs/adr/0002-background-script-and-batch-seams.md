---
status: superseded by ADR-0019
---

# Background-script auth and batch error handling deviate from the single-seam rule

ADR 0001 mandates that _all_ ServiceNow HTTP go through one Bearer-token
`request()` seam, and that commands throw `SnError` for the CLI entrypoint to
map (ADR 0007) rather than catching locally. Two write/batch commands must
deliberately break those rules; this records why so a future reader doesn't
"fix" them.

## Background Script uses a second HTTP path (same auth)

The `run-background-script` command drives ServiceNow's `sys.scripts.do` UI
processor, for which there is no official REST API. It does **not** open a
separate login: it reuses the same Bearer `TokenSource` as everything else. The
deviation from ADR 0001's "all HTTP through the JSON `request()` seam" is purely
about request/response _shape_, which the JSON seam can't express:

1. **Raw HTML responses**, not JSON — the `.do` processor returns an HTML page.
2. **`application/x-www-form-urlencoded` body**, not JSON.
3. **A CSRF preamble** — a GET to `/sys.scripts.do` first, scraping
   `sysparm_ck` from the HTML; that token is then sent as a form field on the
   POST. The CSRF token is an extra form field on the _same_ Bearer-authenticated
   session, not a separate credential.

So the command owns a small raw-`fetch` path (sharing the `TokenSource`) for the
two `.do` calls, while still using `client.request()` for the JSON `sys_scope`
lookup that resolves the scope name to a `sys_id`.

### Cookie continuity is load-bearing (and was the real bug)

The `.do` raw path **must carry the glide session cookies between its two
calls**. The `sysparm_ck` scraped from the GET is bound to the session the GET
established (cookies `JSESSIONID`, `glide_session_store`, …). The first
implementation sent only the Bearer token and discarded the GET's `set-cookie`,
so the POST opened a _new_ session for which the token was invalid — ServiceNow
returned `not authorized` even for an admin. The fix is to replay the GET's
`Cookie` header on the POST. This is **not** a second credential; it is the same
Bearer-authenticated session kept continuous. (Verified by spike: identical
token + `sysparm_ck`, the POST fails without the cookies and succeeds with
them.) Consequently we do **not** need a UI-session library
(`getSafeUserSession`/`UISession`) or the ChannelAjax/logtail stream — the
`<PRE>` returns synchronously on the cookie-continuous POST.

### Which identities get the direct path (interactive-session requirement)

The classic `sys.scripts.do` form only renders to an **interactive UI session**.
Instance-confirmed (dev282837): the gate is the `web_service_access_only` flag on
the executing `sys_user`, not roles. With it **on** (the hardening best practice
for integration accounts), even an `admin` OAuth `client_credentials` session
gets the Next Experience / Polaris SPA shell back — no form, no `sysparm_ck` — so
the direct path throws and we fall back to `sys_trigger`. With it **off**, the
same token renders the classic form and returns full `<PRE>` output. This is why
`now-sdk` (interactive login) gets `via: background_script` while a hardened
`client_credentials` service account gets `via: trigger`. No code distinguishes
them; `runDirect` simply succeeds or throws on what the session is served. (An
earlier hypothesis blamed a role gate / a scrapable `g_ck`; both were
disproved — the service account is `admin` and the `g_ck` in the Polaris shell
is not an executable classic-form session.)

### `sys_trigger` fallback when the `.do` processor refuses

When the direct `.do` execute is rejected (non-2xx, a `not authorized` body, or
no `<PRE>`) or any direct step throws, the command falls back to creating a
`sys_trigger` Scheduled Job through the **normal JSON `client.request()` seam**.
The `.do` UI processor and the Table API authorize through different gates, so
an identity the processor refuses can still insert a trigger (confirmed on a
PDI). Because the job runs asynchronously in a scheduler thread, it cannot
return output over HTTP: the command wraps the script to `gs.log()` its explicit
return value / error under a unique `source`, polls `syslog` for that source
(bounded), and deletes the trigger row. The return value is tagged `via`
(`background_script` vs `trigger`) so callers know which path ran and that the
trigger path captures only return-value/errors, not `gs.print`/`gs.info`. If
both paths fail, both errors are surfaced.

Security posture (this command grants remote code execution by design):

- The CSRF token and Bearer token are **never logged**.
- HTML scraping uses anchored, backtracking-free regexes (no XML-parser
  dependency) — supply-chain and ReDoS surface kept minimal.
- Missing rights (no `x-is-logged-in: true` / no `sysparm_ck`) fail with a clear
  error; the executing user needs elevated Scripts – Background access.
- `record_for_rollback` defaults to **on** (reversible) rather than the
  reference's hardcoded off, since we are not lazy about data loss.

Approach grounded in the `now-sdk-ext-core` `BackgroundScriptExecutor` /
`CSRFTokenHelper` reference (owner-supplied).

## Batch commands are the one place a command may try/catch

ADR 0001 says commands must not `try/catch`. The `batch-update` and `batch-delete`
commands are the deliberate exception: they loop over a list of `sys_id`s,
**continue past per-item failures**, and return a per-item status array. That
per-item result is the command's entire value, and it is impossible to build
without catching each item's error. The catch is scoped to one item of the loop;
a failure to even start the batch (e.g. bad input) still throws.

## Consequences

- **No new configuration.** The CSRF token and session cookies are fetched at
  runtime from the `.do` page; auth reuses the existing `TokenSource`. No new
  env vars and no new dependency.
- All ADR 0001 deviations live in exactly two places, both recorded here:
  `run-background-script` (raw cookie-continuous `.do` fetch path, plus a
  `try/catch` that falls back to `sys_trigger` and surfaces both errors on a
  double failure) and `batch-update`/`batch-delete` (per-item `try/catch`). Any
  _other_ command doing its own raw HTTP or `try/catch` is a smell.

## Amendment: authentication is OAuth-Alias-only

ADR 0018 removes client-credentials authentication. The direct `.do` path and
`sys_trigger` fallback still branch on the response ServiceNow serves, not on an
auth-mode check: an OAuth Alias may still identify a user with
`web_service_access_only` enabled. Current command names are `script run`,
`batch update`, and `batch delete`.
