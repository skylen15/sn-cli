import { randomUUID } from "node:crypto";

import { Context, Effect, Redacted, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import { SnRequestError } from "#src/servicenow/errors.ts";

const HEX32 = /^[0-9a-f]{32}$/i;
// Backtracking-free (single bounded capture, lazy body): no XML parser, minimal
// ReDoS/supply-chain surface. Scraped mid-document, so they can't anchor to ^.
const CK = /name="sysparm_ck"[^>]*value="([^"]+)"/;
const PRE = /<PRE[^>]*>([\s\S]*?)<\/PRE>/;
const LEADING_TIMESTAMP = /^\s*\[[^\]]*\]\s*/;

// Trigger-fallback polling ceiling. ponytail: a sleepy scheduler can miss this
// window and return the "queued, no result" note. Upgrade path: widen the
// budget or expose a separate get-script-result command that reads syslog later.
const POLL_TRIES = 15;
const POLL_INTERVAL_MS = 1000;

/** Injectable poll budget for the sys_trigger fallback (tests shrink it). */
export const BgScriptPoll = Context.Reference<{
  readonly tries: number;
  readonly intervalMs: number;
}>("sn/commands/BgScriptPoll", {
  defaultValue: () => ({ tries: POLL_TRIES, intervalMs: POLL_INTERVAL_MS }),
});

// Surfaces only if the sys_trigger fallback ALSO fails. The usual cause is not
// a bad credential but a non-interactive session: sys.scripts.do renders its
// form only to an interactive UI session, so a web_service_access_only account
// gets the Polaris shell instead (no sysparm_ck). See ADR 0002.
const accessError = () =>
  new SnRequestError({
    message:
      "sys.scripts.do did not return the Background Scripts form (no " +
      "x-is-logged-in / no sysparm_ck). The session likely can't open an " +
      "interactive UI session (e.g. a web_service_access_only account); the " +
      "sys_trigger fallback handles that case.",
  });

// ponytail: decodes only the handful of entities sys.scripts.do actually emits.
// Ceiling: arbitrary named/numeric entities pass through literally. Upgrade path:
// a full entity table (still dependency-free) if richer output ever appears.
function decodeEntities(s: string): string {
  // &amp; is decoded last so an encoded entity like &amp;lt; is not double-decoded.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// ponytail: parse ceiling. Returns the console/<PRE> text only; it does not
// classify system/script/debug lines or extract affected records. Upgrade to a
// real parser if that fidelity is ever needed.
function parsePre(html: string): string {
  const block = html.match(PRE)?.[1] ?? "";
  const withNewlines = block.replace(/<br\s*\/?>/gi, "\n");
  return decodeEntities(withNewlines.replace(LEADING_TIMESTAMP, "")).trim();
}

/** Cookie names a glide session needs are carried verbatim; we replay every
 * `set-cookie` the GET returned as a single `Cookie:` header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** Wraps the user script so an async sys_trigger run can hand back a result:
 * it gs.log()s the explicit return value (or thrown error) under a unique
 * source we can poll syslog for.
 * ponytail: fidelity ceiling — captures only the script's `return` value and
 * uncaught error, NOT gs.print/gs.info (those scatter into syslog untagged and
 * can't be correlated). Upgrade path: inject a capture buffer/helper the script
 * writes to, or read the session log via the ChannelAjax logtail processor. */
function wrapForTrigger(runId: string, script: string): string {
  return (
    `(function(){var __src=${JSON.stringify(runId)};try{` +
    `var __r=(function(){${script}\n})();` +
    `gs.log(__r===undefined?'[no return value]':` +
    `(typeof __r==='string'?__r:JSON.stringify(__r)),__src);` +
    `}catch(__e){gs.log('ERROR: '+(__e.message||__e),__src);}})();`
  );
}

const fetchDo = Effect.fn("script.run.fetchDo")(function* (
  url: string,
  init?: RequestInit,
) {
  const fetchImpl = yield* FetchHttpClient.Fetch;
  return yield* Effect.tryPromise({
    try: () => fetchImpl(url, init),
    catch: (cause) =>
      new SnRequestError({
        message: `sys.scripts.do transport failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }),
  });
});

// Direct path: cookie-continuous sys.scripts.do. Fails on any rejection so
// the caller can fall back. Returns the synchronous <PRE> console output.
const runDirect = Effect.fn("script.run.runDirect")(function* (
  script: string,
  scope: string,
  recordForRollback: boolean,
) {
  const { alias } = yield* sn;
  const client = yield* SnClient;
  const withAlias = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(AliasFlag, alias));

  const token = yield* withAlias(client.token());
  const url = `${token.instanceUrl}/sys.scripts.do`;
  const auth = `Bearer ${Redacted.value(token.accessToken)}`;

  const get = yield* fetchDo(url, { headers: { Authorization: auth } });
  if (!get.ok) {
    return yield* new SnRequestError({
      message: `sys.scripts.do CSRF GET failed (status ${get.status}).`,
      status: get.status,
    });
  }
  if (get.headers.get("x-is-logged-in") !== "true") {
    return yield* accessError();
  }
  const cookies = cookieHeader(get);
  const html = yield* Effect.tryPromise({
    try: () => get.text(),
    catch: (cause) =>
      new SnRequestError({
        message: `sys.scripts.do CSRF GET body read failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }),
  });
  const ck = html.match(CK)?.[1];
  if (!ck) {
    return yield* accessError();
  }

  let sysScope = scope;
  if (!HEX32.test(scope)) {
    const data = yield* withAlias(
      client.request("/api/now/table/sys_scope", {
        sysparm_query: `scope=${scope}`,
        sysparm_fields: "sys_id",
        sysparm_limit: "1",
      }),
    );
    // SAFETY: Table API wraps rows in `{ result }`; we only read sys_id.
    const sysId = (data as { result?: { sys_id?: string }[] } | null)
      ?.result?.[0]?.sys_id;
    if (!sysId) {
      return yield* new SnRequestError({
        message: `No app scope named "${scope}" found in sys_scope.`,
      });
    }
    sysScope = sysId;
  }

  const headers: Record<string, string> = {
    Authorization: auth,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cookies) {
    headers.Cookie = cookies;
  }
  const res = yield* fetchDo(url, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      script,
      sysparm_ck: ck,
      runscript: "Run script",
      sys_scope: sysScope,
      record_for_rollback: recordForRollback ? "on" : "off",
      quota_managed_transaction: "off",
    }),
  });
  if (!res.ok) {
    return yield* new SnRequestError({
      message: `sys.scripts.do execution failed (status ${res.status}).`,
      status: res.status,
    });
  }

  const body = yield* Effect.tryPromise({
    try: () => res.text(),
    catch: (cause) =>
      new SnRequestError({
        message: `sys.scripts.do response body read failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }),
  });
  // A refusal ("not authorized") comes back with no <PRE> block; that's our
  // signal the processor rejected this session so we can fall back.
  if (!PRE.test(body)) {
    return yield* new SnRequestError({
      message: `sys.scripts.do rejected execution: ${
        body
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 200) || "no <PRE> output"
      }`,
    });
  }
  return parsePre(body);
});

// Fallback: create a Run-Once sys_trigger via the JSON seam, poll syslog for
// the wrapped script's logged result, then delete the trigger row.
const runViaTrigger = Effect.fn("script.run.runViaTrigger")(function* (
  script: string,
) {
  const { alias } = yield* sn;
  const client = yield* SnClient;
  const poll = yield* BgScriptPoll;
  const withAlias = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.provideService(AliasFlag, alias));

  const runId = `SN-${randomUUID().replace(/-/g, "")}`;
  const nextAction = new Date(Date.now() - 5000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const created = yield* withAlias(
    client.request("/api/now/table/sys_trigger", undefined, {
      method: "POST",
      body: {
        name: runId,
        trigger_type: "0",
        state: "0",
        script: wrapForTrigger(runId, script),
        next_action: nextAction,
      },
    }),
  );
  // SAFETY: Table API create returns `{ result: { sys_id } }`.
  const triggerSysId = (created as { result?: { sys_id?: string } } | null)
    ?.result?.sys_id;

  let output = "";
  let found = false;
  for (let i = 0; i < poll.tries; i++) {
    yield* Effect.sleep(`${poll.intervalMs} millis`);
    const logs = yield* withAlias(
      client.request("/api/now/table/syslog", {
        sysparm_query: `source=${runId}^ORDERBYsys_created_on`,
        sysparm_fields: "message",
        sysparm_limit: "50",
      }),
    );
    // SAFETY: syslog query returns `{ result: [{ message }] }`.
    const rows =
      (logs as { result?: { message?: string }[] } | null)?.result ?? [];
    if (rows.length > 0) {
      output = rows
        .map((r) => r.message ?? "")
        .join("\n")
        .trim();
      found = true;
      break;
    }
  }

  // Run-Once triggers self-remove after firing; delete defensively in case it
  // never ran. Cleanup failure must not mask the result.
  if (triggerSysId) {
    yield* withAlias(
      client.request(
        `/api/now/table/sys_trigger/${encodeURIComponent(triggerSysId)}`,
        undefined,
        { method: "DELETE" },
      ),
    ).pipe(Effect.catch(() => Effect.void));
  }

  return found
    ? {
        output,
        note: "ran async via sys_trigger; only the script's return value and errors are captured, not gs.print/gs.info",
      }
    : {
        output: "",
        note: `queued via sys_trigger; no result within ${(poll.tries * poll.intervalMs) / 1000}s`,
      };
});

/**
 * ADR 0002: this command owns a small raw-`fetch` path (sharing the Bearer
 * `TokenSource`) for the two `sys.scripts.do` calls, because they need HTML
 * responses and a form-urlencoded body the JSON `request()` seam can't express.
 * The `.do` path MUST carry the GET's session cookies onto the POST — the
 * scraped sysparm_ck is bound to that session (without the cookies ServiceNow
 * returns "not authorized"). When the `.do` processor refuses (or anything in
 * the direct path fails), it falls back to a sys_trigger Scheduled Job created
 * through the JSON `client.request()` seam.
 */
const run = Command.make(
  "run",
  {
    script: Argument.string("script").pipe(
      Argument.withSchema(Schema.NonEmptyString),
      Argument.withDescription("The server-side JavaScript to execute"),
    ),
    scope: Flag.string("scope").pipe(
      Flag.withDefault("global"),
      Flag.withDescription(
        "App scope: a 32-char hex value is treated as a sys_id and passed through; " +
          "any other value is resolved to a sys_id via sys_scope. Defaults to global.",
      ),
    ),
    recordForRollback: Flag.boolean("record-for-rollback").pipe(
      Flag.withDefault(true),
      Flag.withDescription(
        "Record a rollback context so the run is reversible (recommended). " +
          "Defaults to true. Applies to the direct path only.",
      ),
    ),
  },
  Effect.fn("script.run")(function* ({ script, scope, recordForRollback }) {
    // ADR 0002: deliberate try/catch — fall back to sys_trigger and surface both
    // errors on double failure. CSRF / Bearer tokens are never logged.
    const result = yield* runDirect(script, scope, recordForRollback).pipe(
      Effect.map((output) => ({
        output,
        via: "background_script" as const,
      })),
      Effect.catch((directErr) => {
        const directMsg = directErr.message;
        return runViaTrigger(script).pipe(
          Effect.map(({ output, note }) => ({
            output,
            via: "trigger" as const,
            note,
          })),
          Effect.mapError(
            (fbErr) =>
              new SnRequestError({
                message: `Direct background script failed (${directMsg}); sys_trigger fallback also failed (${fbErr.message}).`,
              }),
          ),
        );
      }),
    );
    yield* emitJson(result);
  }),
).pipe(
  Command.withDescription(
    "Execute arbitrary server-side JavaScript. This is remote code execution by " +
      "design: the script runs with the authenticated user's full rights. Primary " +
      "path is the sys.scripts.do UI processor (synchronous, returns console output). " +
      "If that processor refuses the session, it falls back to a sys_trigger Scheduled " +
      "Job (asynchronous — only the script's return value and errors are captured). " +
      "The 'via' field in the result says which path ran. --record-for-rollback defaults " +
      "to on (direct path only).",
  ),
);

export { run };
