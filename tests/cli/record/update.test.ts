import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { SnClient, type RequestOptions } from "#src/servicenow/client.ts";
import {
  SnRequestError,
  isSnError,
  snErrorJson,
} from "#src/servicenow/errors.ts";

type Seen = {
  path?: string;
  params?: Record<string, string>;
  options?: RequestOptions;
};

type Request = (
  path: string,
  params?: Record<string, string>,
  options?: RequestOptions,
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
        request: Effect.fn("stub.request")(function* (path, params, options) {
          seen.path = path;
          seen.params = params;
          seen.options = options;
          return yield* impl(path, params, options);
        }),
        token: () => Effect.die("SnClient.token unused in stub"),
      }),
    ),
  };
};

describe("record update", () => {
  it("PATCHes snake_case fields to table/sys_id and returns the updated Record", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() =>
      Effect.succeed({ result: { sys_id: "abc123", state: "2" } }),
    );

    const exit = await run(
      ["record", "update", "incident", "abc123", "--field", "state=2"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [{ result: { sys_id: "abc123", state: "2" } }]);
    assert.equal(seen.path, "/api/now/table/incident/abc123");
    assert.equal(seen.options?.method, "PATCH");
    assert.deepEqual(seen.options?.body, { state: "2" });
  });

  it("fails clearly when the sys_id does not exist", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer, seen } = stub(() =>
      Effect.fail(
        new SnRequestError({
          message: "No Record found",
          detail: "Record doesn't exist or ACL restricts the record",
          status: 404,
        }),
      ),
    );

    const exit = await Effect.runPromiseExit(
      Command.runWith(
        sn.pipe(Command.provide(Layer.merge(layer, emitCapture(writes)))),
        { version: "0.0.0-test", renderErrors: false },
      )([
        "record",
        "update",
        "incident",
        "missing000000000000000000000001",
        "--field",
        "state=2",
      ]).pipe(
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
    assert.equal(
      seen.path,
      "/api/now/table/incident/missing000000000000000000000001",
    );
    assert.equal(seen.options?.method, "PATCH");
    assert.deepEqual(seen.options?.body, { state: "2" });
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    }) as SnRequestError;
    assert.equal(error._tag, "SnRequestError");
    assert.equal(error.status, 404);
    assert.equal(error[Runtime.errorExitCode], 4);
    assert.equal(stderr.length, 1);
  });
});
