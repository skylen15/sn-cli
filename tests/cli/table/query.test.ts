import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Layer, Cause, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { SnClient } from "#src/servicenow/client.ts";
import {
  SnRequestError,
  isSnError,
  snErrorJson,
} from "#src/servicenow/errors.ts";

type Seen = {
  path?: string;
  params?: Record<string, string>;
};

type Request = (
  path: string,
  params?: Record<string, string>,
) => Effect.Effect<unknown, SnRequestError>;

const run = (
  args: ReadonlyArray<string>,
  clientLayer: Layer.Layer<SnClient>,
  writes: Array<unknown>,
) =>
  Effect.runPromiseExit(
    Command.runWith(
      sn.pipe(Command.provide(Layer.merge(clientLayer, emitCapture(writes)))),
      { version: "0.0.0-test", renderErrors: false },
    )(args).pipe(Effect.provide(NodeServices.layer)),
  );

const stub = (impl: Request): { layer: Layer.Layer<SnClient>; seen: Seen } => {
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
        token: () => Effect.die("SnClient.token unused in stub"),
      }),
    ),
  };
};

describe("table query", () => {
  it("returns the ServiceNow body and forwards table + params", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() =>
      Effect.succeed({ result: [{ number: "INC001" }] }),
    );

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
      [
        "table",
        "query",
        "incident",
        "--sysparm",
        "sysparm_suppress_pagination_header=true",
      ],
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
      Command.runWith(
        sn.pipe(Command.provide(Layer.merge(layer, emitCapture(writes)))),
        { version: "0.0.0-test", renderErrors: false },
      )(["table", "query", "bogus"]).pipe(
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
    }) as SnRequestError;
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
});
