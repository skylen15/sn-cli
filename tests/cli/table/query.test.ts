import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { makeTokenSourceLayer } from "#src/servicenow/auth.ts";
import { SnClient, snClientLayer } from "#src/servicenow/client.ts";
import { aliasConfirmLayer } from "#src/servicenow/confirm.ts";
import { SnRequestError, isSnError, snErrorJson } from "#src/servicenow/errors.ts";

type Seen = {
  path?: string;
  params?: Record<string, string>;
};

type Request = (
  path: string,
  params?: Record<string, string>,
) => Effect.Effect<Schema.Json, SnRequestError>;

const run = (
  args: ReadonlyArray<string>,
  clientLayer: Layer.Layer<SnClient>,
  writes: Array<unknown>,
) =>
  Effect.runPromiseExit(
    Command.runWith(sn.pipe(Command.provide(Layer.merge(clientLayer, emitCapture(writes)))), {
      version: "0.0.0-test",
      renderErrors: false,
    })(args).pipe(Effect.provide(NodeServices.layer)),
  );

const stub = (impl: Request) => {
  const seen: Seen = {};
  return {
    seen,
    layer: Layer.succeed(
      SnClient,
      SnClient.of({
        request: Effect.fn("stub.request")(function* (path, params) {
          seen.path = path;
          seen.params = params;
          return yield* impl(path, params);
        }),
      }),
    ),
  };
};

describe("table query", () => {
  it("returns the ServiceNow body and forwards table + params", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [{ number: "INC001" }] }));

    const exit = await run(
      ["table", "query", "incident", "--limit", "5", "--query", "active=true"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [{ result: [{ number: "INC001" }] }]);
    assert.equal(seen.path, "/api/now/table/incident");
    assert.deepEqual(seen.params, {
      sysparm_limit: "5",
      sysparm_query: "active=true",
    });
  });

  it("maps display-value, exclude-reference-link, fields, and offset to sysparm_*", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [] }));

    const exit = await run(
      [
        "table",
        "query",
        "incident",
        "--limit",
        "10",
        "--fields",
        "number,short_description",
        "--display-value",
        "all",
        "--exclude-reference-link",
        "--offset",
        "20",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(seen.params, {
      sysparm_limit: "10",
      sysparm_fields: "number,short_description",
      sysparm_display_value: "all",
      sysparm_exclude_reference_link: "true",
      sysparm_offset: "20",
    });
  });

  it("omits optional sysparm_* params when their flags are absent", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [] }));

    const exit = await run(["table", "query", "incident"], layer, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(seen.params, { sysparm_limit: "20" });
  });

  it("merges the verbatim --sysparm escape hatch into the request", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [] }));

    const exit = await run(
      ["table", "query", "incident", "--sysparm", "sysparm_suppress_pagination_header=true"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(seen.params, {
      sysparm_limit: "20",
      sysparm_suppress_pagination_header: "true",
    });
  });

  it("surfaces a tagged request error with classified exit code and JSON shape", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub(() =>
      Effect.fail(
        new SnRequestError({
          message: "Invalid table name",
          detail: "no such table",
          status: 400,
        }),
      ),
    );

    const exit = await Effect.runPromiseExit(
      Command.runWith(sn.pipe(Command.provide(Layer.merge(layer, emitCapture(writes)))), {
        version: "0.0.0-test",
        renderErrors: false,
      })(["table", "query", "bogus"]).pipe(
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
    assert.equal(writes.length, 0);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(error instanceof SnRequestError);
    assert.equal(error._tag, "SnRequestError");
    assert.equal(error[Runtime.errorExitCode], 4);
    assert.deepEqual(stderr, [
      JSON.stringify({
        _tag: "SnRequestError",
        message: "Invalid table name",
        detail: "no such table",
        status: 400,
      }),
    ]);
  });

  it("queries formerly Sensitive Tables directly on an allowed instance", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [{ user_name: "admin" }] }));

    const exit = await run(["table", "query", "sys_user"], layer, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [{ result: [{ user_name: "admin" }] }]);
    assert.equal(seen.path, "/api/now/table/sys_user");
  });

  it("permits formerly Sensitive References in --fields without rejection or omission", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [] }));

    const exit = await run(
      ["table", "query", "incident", "--fields", "number,caller_id,caller_id.email"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/now/table/incident");
    assert.equal(seen.params?.sysparm_fields, "number,caller_id,caller_id.email");
  });

  it("permits formerly Sensitive References in --query without rejection", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed({ result: [] }));

    const exit = await run(
      ["table", "query", "incident", "--query", "caller_id=abc^caller_id.email=admin@example.com"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/now/table/incident");
    assert.equal(seen.params?.sysparm_query, "caller_id=abc^caller_id.email=admin@example.com");
  });

  it("integration: non-TTY read-only query proceeds using default alias and announces target", async () => {
    const writes: unknown[] = [];
    const announcements: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/now/table/incident")) {
        return new Response(JSON.stringify({ result: [{ number: "INC123" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ result: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const sdk = {
      getStored: async (alias?: string) => ({
        alias: alias ?? "dev-default",
        isDefault: true,
        creds: {
          type: "oauth" as const,
          instanceUrl: "https://dev12345.service-now.com",
          access_token: "tok",
          token_type: "Bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      }),
      refreshAccessToken: async () => {
        throw new Error("should not refresh");
      },
      storeCredentials: async () => undefined,
      fetchCredentials: async () => new Map(),
    };

    const confirm = {
      isTTY: false,
      readLine: Effect.succeed(""),
      writePrompt: (p: string) =>
        Effect.sync(() => {
          announcements.push(p);
        }),
    };

    const fetchLayer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImpl)),
    );
    const clientLive = snClientLayer.pipe(
      Layer.provide(fetchLayer),
      Layer.provide(makeTokenSourceLayer(sdk)),
    );

    const exit = await Effect.runPromiseExit(
      Command.runWith(
        sn.pipe(
          Command.provide(
            Layer.mergeAll(clientLive, aliasConfirmLayer(confirm), emitCapture(writes)),
          ),
        ),
        { version: "0.0.0-test", renderErrors: false },
      )(["table", "query", "incident"]).pipe(Effect.provide(NodeServices.layer)),
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [{ result: [{ number: "INC123" }] }]);
    assert.equal(announcements.length, 1);
    assert.match(announcements[0] ?? "", /dev-default/);
    assert.match(announcements[0] ?? "", /dev12345\.service-now\.com/);
  });
});
