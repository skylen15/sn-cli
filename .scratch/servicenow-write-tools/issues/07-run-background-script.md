# Add run_background_script (sys.scripts.do + CSRF)

Status: in-progress (revised post-spike — see "Revision" at the bottom)

## Parent

`.scratch/servicenow-write-tools/PRD.md`

## What to build

A `run_background_script` tool that executes arbitrary server-side JavaScript via
ServiceNow's `sys.scripts.do` UI processor (there is no REST equivalent). It
reuses the existing Bearer `TokenSource` for auth — **not** a separate login —
but does its own raw `fetch` for the two `.do` calls because they need HTML
responses and a form-urlencoded body, which the JSON `request()` seam can't
express (see ADR 0002).

Approach is grounded in the owner-supplied reference
(`now-sdk-ext-core`: `BackgroundScriptExecutor.ts`, `CSRFTokenHelper.ts`).

### Inputs

- `script` (string, required) — the server-side JS to run.
- `scope` (string, optional, default `global`) — app scope; a 32-char hex value
  is treated as a `sys_id` and passed through, a name is resolved via `sys_scope`.
- `record_for_rollback` (boolean, optional, **default true**) — record a rollback
  context so the run is reversible. Safety default; the reference hardcodes off.

### Flow

1. **CSRF preamble** — GET `${instanceUrl}/sys.scripts.do` with the Bearer
   token. Require response header `x-is-logged-in: true`; scrape `sysparm_ck`
   from the HTML with the anchored regex `name="sysparm_ck"[^>]*value="([^"]+)"`.
   If not logged in or no token, throw a clear "lacking Scripts – Background
   access" error.
2. **Resolve scope → sys_id** — 32-hex passes through; otherwise
   `client.request()` a `sys_scope` query (`scope=<name>`, field `sys_id`). This
   reuses the JSON seam.
3. **Execute** — POST `${instanceUrl}/sys.scripts.do`,
   `Content-Type: application/x-www-form-urlencoded`, body:
   `script`, `sysparm_ck`, `runscript=Run script`, `sys_scope=<sysid>`,
   `record_for_rollback=<on|off>`, `quota_managed_transaction=off`.
4. **Parse output** — strip a leading `[timestamp]` prefix, extract the `<PRE>`
   block with `<PRE[^>]*>([\s\S]*?)</PRE>` (non-greedy, no backtracking bomb),
   decode HTML entities. Return compact JSON `{ output, loggedIn: true }`; include
   raw HTML only if cheaply bounded.

### Security guardrails (this tool is RCE by design)

- **Never log** `sysparm_ck` or the Bearer token.
- No XML-parser dependency — regex extraction only (supply-chain + ReDoS surface
  kept minimal; both regexes are anchored and backtracking-free).
- `ponytail:` comment marks the parse ceiling: returns console/`<PRE>` text only,
  does not classify system/script/debug lines or extract affected records;
  upgrade to a real parser if that fidelity is ever needed.
- Annotations: destructive, non-idempotent, open-world — host prompts each run.

### Wiring

`index.ts` retains the `TokenSource` (`const tokenSource = createTokenSource()`)
and passes it to this tool's `register(server, client, tokenSource, fetchImpl?)`
(fetch injectable for tests). Other tools keep the plain `register(server,
client)` signature.

## Acceptance criteria

- [ ] GETs `/sys.scripts.do`, verifies `x-is-logged-in`, scrapes `sysparm_ck`
- [ ] Throws a clear access error when not logged in or token is absent
- [ ] Resolves scope names via `sys_scope`; passes 32-hex sys_ids through; defaults to `global`
- [ ] POSTs form-urlencoded with all required fields; `record_for_rollback` defaults to on
- [ ] Returns the parsed `<PRE>` output as compact JSON
- [ ] Never logs the CSRF or Bearer token; no XML-parser dependency added
- [ ] Registered with title, description (flags arbitrary code execution), annotations (destructive, non-idempotent, open-world)
- [ ] Tests cover: CSRF scrape, not-logged-in failure, scope passthrough vs lookup, and the POST request shape (stubbed fetch + stubbed client)

## Blocked by

None - can start immediately (reuses the existing `TokenSource` and GET-only
`client.request()`; does not need the write-verb seam from issue 03).

## Revision (post-spike, 2026-06-21)

The first implementation shipped but returned `not authorized` on every run,
even as an `admin`. A spike (`.scratch/servicenow-write-tools/probe-bg-cookie.ts`,
now deleted) found the root cause and reshaped the design.

### Root cause: missing session cookie (not roles, not Bearer)

`sys.scripts.do` is a UI processor. The scraped `sysparm_ck` (CSRF token) is
bound to the **glide session established by the GET** (cookies `JSESSIONID`,
`glide_session_store`, …). Our first version sent only `Authorization: Bearer`
on both calls and **discarded the GET's `set-cookie`** — so the POST landed in a
_new_ session for which the `sysparm_ck` was invalid → `not authorized`. The
Bearer/admin identity was never the problem.

Spike result (same token, same `sysparm_ck`):

- POST **without** the GET's cookies → `not authorized`
- POST **with** the GET's cookies replayed as a `Cookie:` header → script ran,
  `<PRE>` output returned

### Revised design

1. **Primary path = cookie continuity.** Capture `set-cookie` from the CSRF GET
   and replay it as a `Cookie:` header on the execute POST (still send Bearer).
   This is the whole fix for the happy path — no new dependency, no UI-session
   library (`getSafeUserSession`/`UISession` aren't even in our installed deps),
   no logtail/ChannelAjax.
2. **Fallback path = `sys_trigger`.** If the direct execute is _rejected_ (POST
   non-2xx, or body has no `<PRE>` / matches `/not authorized/i`), or any direct
   step throws, fall back to creating a `sys_trigger` Scheduled Job via the JSON
   `client.request()` seam (Table API ACLs are a different, looser gate than the
   `.do` processor — confirmed: a non-`.do` `sys_trigger` insert succeeds where
   `.do` is refused). If the fallback **also** fails, surface **both** errors.
3. **Trigger output capture (async).** The job runs later in a scheduler thread,
   so it can't return output over HTTP. Wrap the user script to capture its
   **explicit `return` value and any uncaught error** and `gs.log()` them under a
   unique `source`; then poll `syslog` for that source (bounded), and delete the
   trigger row. It does **not** capture `gs.print`/`gs.info` — that is the
   honest contract difference from the direct path.
4. **Tagged return shape**, so the caller knows which path ran and the fidelity:
   - direct → `{ "output": "<PRE text>", "via": "background_script" }`
   - trigger → `{ "output": "<return value + errors>", "via": "trigger",
"note": "ran async via sys_trigger; only the script's return value and
errors are captured, not gs.print/gs.info" }`
   - trigger timeout → `{ "output": "", "via": "trigger", "note": "queued; no
result within Ns" }`

### Revised acceptance criteria (supersede the originals where they conflict)

- [ ] Direct path replays the GET's session cookies on the execute POST
- [ ] Direct success returns `{ output, via: "background_script" }` from `<PRE>`
- [ ] Direct rejection (non-2xx, `not authorized`, or no `<PRE>`) or any thrown
      error triggers the `sys_trigger` fallback
- [ ] Fallback wraps the script (captures `return`/throw via `gs.log` under a
      unique source), inserts `sys_trigger` with `next_action` due now, polls
      `syslog` by source (bounded), returns `{ output, via: "trigger", note }`,
      and deletes the trigger row
- [ ] Fallback timeout returns the `via: "trigger"` note with empty output
- [ ] If both direct and fallback fail, both error messages are surfaced
- [ ] Never logs the CSRF token, Bearer token, or session cookies; no XML-parser
      dependency added
- [ ] Tests cover: direct cookie replay + shape, rejection→fallback→trigger
      output, and the fallback timeout

## Revision (post-spike 2, 2026-06-22) — which auth gets the direct path

Investigated why `client_credentials` (service account) fell back to `trigger`
while `now-sdk` (admin) got the direct path. Instance-confirmed on dev282837;
the earlier suspicion (role gate / g_ck scraping) was wrong.

### Root cause: the direct `.do` path needs an _interactive_ session

`sys.scripts.do` is a classic UI processor — it only renders its form (and the
`sysparm_ck`) to an **interactive UI session**. The blocker is the
`web_service_access_only` flag on the `sys_user` record, **not** roles or
cookies:

- `web_service_access_only = true` → the account may authenticate for API only,
  never an interactive UI session. The GET to `/sys.scripts.do` returns the
  Next Experience / Polaris SPA shell (no `<textarea name="script">`, no
  `sysparm_ck`), so `runDirect` throws and the tool falls back to `sys_trigger`.
- `web_service_access_only = false` → the same OAuth `client_credentials` token
  renders the classic form and the cookie-continuous POST returns full `<PRE>`
  `gs.print` console output — identical to `now-sdk`.

Confirmed by differential probe (`probe-token.ts`, deleted): the service account
holds `admin` and satisfies `glide.script_processor.admin` either way, so it is
authorization-independent. **No code change** — `runDirect` already does the
right thing; the difference is purely the account's session capability.

### Consequence (no acceptance-criteria change)

- An integration account hardened with `web_service_access_only = true` (the
  security best practice) will always take the `trigger` path — return value
  only, no `gs.print`. That is correct, not a bug; the fallback exists for it.
- Full direct-path console output for a non-`now-sdk` identity requires an
  interactive-capable account (`web_service_access_only = false`), which widens
  that account's blast radius for an RCE-by-design tool. Posture trade-off, not
  a code task. The g_ck-scraping enhancement is **abandoned** (moot).
