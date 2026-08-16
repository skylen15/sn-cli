# 09 — `run-background-script`

Status: ready-for-agent

## What to build

`sn run-background-script` executes server-side JavaScript against the instance.
The most complex and most deviating command, kept behaviourally identical to the
version it replaces — the two-path design below is not a refactoring opportunity.

**Direct `.do` path.** A small raw request pipeline sharing the token source: GET
the background-script endpoint to scrape the CSRF token out of the HTML, then POST
the script as a form-urlencoded body, **replaying the GET's cookies on the POST**.
Cookie continuity is load-bearing — without it ServiceNow opens a new session and
rejects the token. Parse the preformatted output block out of the HTML response.

**`sys_trigger` fallback.** When the `.do` processor refuses — no logged-in marker
or no CSRF token, which is what a hardened web-service-only service account gets —
create a Scheduled Job through the JSON client seam instead: wrap the script so it
logs its return value or error under a unique source, poll the system log for that
source with a bounded number of attempts, then delete the trigger Record.

Tag the result with which path produced it. If both paths fail, surface both
errors rather than only the last. Rollback recording defaults **on**. Never log the
CSRF or Bearer token. Use anchored, backtracking-free expressions for the HTML
scraping. Resolve any scope name to its `sys_id` through the JSON client seam.

Ground the `.do`, CSRF, and session behaviour against the `sn-docs` skill rather
than memory before changing anything here.

Delete the old `run_background_script` tool file once ported.

Covers user story 29. Respects ADR 0002.

## Acceptance criteria

- [ ] The direct path scrapes the CSRF token, replays the GET's cookies on the POST, and returns the script's output tagged with the path used.
- [ ] When the direct path is refused, the command falls back to a Scheduled Job, polls the system log for the tagged source, returns the captured return value or error tagged with the fallback path, and deletes the trigger Record.
- [ ] The poll is bounded and a timeout is a clear tagged error, not a hang.
- [ ] When both paths fail, both errors are surfaced.
- [ ] Neither the CSRF token nor the Bearer token appears in any output or log.
- [ ] Rollback recording defaults on.
- [ ] `node:test` checks with a stubbed client Layer assert the successful direct path including cookie replay, the refusal-then-fallback path, the poll timeout, and the double-failure surfacing.
- [ ] The old `run_background_script` tool file is deleted.

## Blocked by

- 02 (client service, token source, output and exit-code contract)
