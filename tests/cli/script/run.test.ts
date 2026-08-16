import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Redacted, Runtime } from "effect";
import { Command } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { sn } from "#src/cli.ts";
import { BgScriptPoll } from "#src/commands/script/run.ts";
import { emitCapture } from "#src/emit.ts";
import {
  SnClient,
  type RequestOptions,
  type Token,
} from "#src/servicenow/client.ts";
import {
  SnRequestError,
  isSnError,
  snErrorJson,
} from "#src/servicenow/errors.ts";

type Request = (
  path: string,
  params?: Record<string, string>,
  options?: RequestOptions,
) => Effect.Effect<unknown, SnRequestError>;

const tok: Token = {
  instanceUrl: "https://x.service-now.com",
  accessToken: Redacted.make("tok"),
};

const stubClient = (impl: Request): Layer.Layer<SnClient> =>
  Layer.succeed(
    SnClient,
    SnClient.of({
      request: Effect.fn("stub.request")(function* (path, params, options) {
        return yield* impl(path, params, options);
      }),
      token: () => Effect.succeed(tok),
    }),
  );

const loggedInGet = (html: string, cookies: string[]) => {
  const headers = new Headers({ "x-is-logged-in": "true" });
  for (const c of cookies) {
    headers.append("set-cookie", c);
  }
  return new Response(html, { headers });
};

const run = (
  args: ReadonlyArray<string>,
  // Also carries Fetch / BgScriptPoll overrides when a test needs them.
  layers: Layer.Layer<SnClient, never, never>,
  writes: Array<unknown>,
) =>
  Effect.runPromiseExit(
    Command.runWith(
      sn.pipe(Command.provide(Layer.merge(layers, emitCapture(writes)))),
      { version: "0.0.0-test", renderErrors: false },
    )(args).pipe(Effect.provide(NodeServices.layer)),
  );

const refuseDirect: typeof fetch = (async (
  _url: string | URL,
  init?: RequestInit,
) => {
  if ((init?.method ?? "GET") === "GET") {
    return loggedInGet('<input name="sysparm_ck" value="CK"/>', [
      "JSESSIONID=a",
    ]);
  }
  return new Response("not authorized");
}) as unknown as typeof fetch;

const scopeOk = () =>
  Effect.succeed({
    result: [{ sys_id: "abcdef0123456789abcdef0123456789" }],
  });

describe("script run", () => {
  it("direct path replays GET cookies on the POST and returns <PRE> output", async () => {
    let postCookie: string | null = null;
    let postBody: string | null = null;
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return loggedInGet('<input name="sysparm_ck" value="CK"/>', [
          "JSESSIONID=abc; Path=/",
          "glide_session_store=xyz; Path=/",
        ]);
      }
      postCookie = new Headers(init?.headers).get("cookie");
      postBody = String(init?.body ?? "");
      return new Response(
        "[0:00:00.042] <PRE>*** Script: hi 1<BR/>done<BR/></PRE>",
      );
    }) as unknown as typeof fetch;

    const writes: unknown[] = [];
    const exit = await run(
      ["script", "run", "gs.print('hi');"],
      // SAFETY: mergeAll also provides FetchHttpClient.Fetch; SnClient is the
      // only service Command.provide needs typed, and References resolve by value.
      Layer.mergeAll(
        stubClient(() => scopeOk()),
        Layer.succeed(FetchHttpClient.Fetch, fetchImpl),
      ) as Layer.Layer<SnClient>,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      { output: "*** Script: hi 1\ndone", via: "background_script" },
    ]);
    assert.equal(postCookie, "JSESSIONID=abc; glide_session_store=xyz");
    assert.match(postBody ?? "", /sysparm_ck=CK/);
  });

  it("rejection (no <PRE>) falls back to sys_trigger and returns logged output", async () => {
    const calls: { path: string; method: string }[] = [];
    const writes: unknown[] = [];
    const exit = await run(
      ["script", "run", "return 42;"],
      Layer.mergeAll(
        stubClient((path, _params, options) => {
          const method = options?.method ?? "GET";
          calls.push({ path, method });
          if (path === "/api/now/table/sys_scope") {
            return scopeOk();
          }
          if (path === "/api/now/table/sys_trigger" && method === "POST") {
            return Effect.succeed({ result: { sys_id: "trig123" } });
          }
          if (path === "/api/now/table/syslog") {
            return Effect.succeed({ result: [{ message: "42" }] });
          }
          return Effect.succeed(null);
        }),
        Layer.succeed(FetchHttpClient.Fetch, refuseDirect),
        Layer.succeed(BgScriptPoll, { tries: 3, intervalMs: 1 }),
        // SAFETY: mergeAll also provides Fetch + BgScriptPoll; SnClient is the
        // only service Command.provide needs typed, and References resolve by value.
      ) as Layer.Layer<SnClient>,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        output: "42",
        via: "trigger",
        note: "ran async via sys_trigger; only the script's return value and errors are captured, not gs.print/gs.info",
      },
    ]);
    assert.ok(
      calls.some(
        (c) => c.path === "/api/now/table/sys_trigger" && c.method === "POST",
      ),
    );
    assert.ok(
      calls.some(
        (c) =>
          c.path === "/api/now/table/sys_trigger/trig123" &&
          c.method === "DELETE",
      ),
    );
  });

  it("fallback timeout returns the trigger note with empty output", async () => {
    const writes: unknown[] = [];
    const exit = await run(
      ["script", "run", "doStuff();"],
      Layer.mergeAll(
        stubClient((path, _params, options) => {
          if (path === "/api/now/table/sys_scope") {
            return scopeOk();
          }
          if (
            path === "/api/now/table/sys_trigger" &&
            (options?.method ?? "GET") === "POST"
          ) {
            return Effect.succeed({ result: { sys_id: "trig123" } });
          }
          if (path === "/api/now/table/syslog") {
            return Effect.succeed({ result: [] });
          }
          return Effect.succeed(null);
        }),
        Layer.succeed(FetchHttpClient.Fetch, refuseDirect),
        Layer.succeed(BgScriptPoll, { tries: 3, intervalMs: 1 }),
        // SAFETY: mergeAll also provides Fetch + BgScriptPoll; SnClient is the
        // only service Command.provide needs typed, and References resolve by value.
      ) as Layer.Layer<SnClient>,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        output: "",
        via: "trigger",
        note: "queued via sys_trigger; no result within 0.003s",
      },
    ]);
  });

  it("when both direct and fallback fail, both errors are surfaced", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const exit = await Effect.runPromiseExit(
      Command.runWith(
        sn.pipe(
          Command.provide(
            Layer.merge(
              Layer.mergeAll(
                stubClient((path) => {
                  if (path === "/api/now/table/sys_scope") {
                    return scopeOk();
                  }
                  return Effect.fail(
                    new SnRequestError({
                      message: "sys_trigger insert forbidden",
                    }),
                  );
                }),
                Layer.succeed(FetchHttpClient.Fetch, refuseDirect),
              ),
              emitCapture(writes),
            ),
          ),
        ),
        { version: "0.0.0-test", renderErrors: false },
      )(["script", "run", "x();"]).pipe(
        Effect.tapError((error) =>
          isSnError(error)
            ? Effect.sync(() => {
                stderr.push(snErrorJson(error));
              })
            : Effect.void,
        ),
        Effect.provide(NodeServices.layer),
      ),
    );

    assert.ok(Exit.isFailure(exit));
    assert.deepEqual(writes, []);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(isSnError(error));
    assert.match(error.message, /rejected execution/);
    assert.match(error.message, /sys_trigger insert forbidden/);
    assert.equal(error[Runtime.errorExitCode], 4);
    assert.equal(stderr.length, 1);
    assert.ok(!stderr[0]?.includes("CK"));
    assert.ok(!stderr[0]?.includes("tok"));
  });
});
