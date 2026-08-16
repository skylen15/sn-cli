import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { SnClient, type RequestOptions } from "#src/servicenow/client.ts";
import {
  SnBatchFailedError,
  SnBatchPartialError,
  SnRequestError,
  isSnError,
  snErrorJson,
} from "#src/servicenow/errors.ts";

type Seen = {
  paths: string[];
  methods: Array<string | undefined>;
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
  const seen: Seen = { paths: [], methods: [] };
  return {
    seen,
    layer: Layer.succeed(
      SnClient,
      SnClient.of({
        request: Effect.fn("stub.request")(function* (path, params, options) {
          seen.paths.push(path);
          seen.methods.push(options?.method);
          return yield* impl(path, params, options);
        }),
        token: () => Effect.die("SnClient.token unused in stub"),
      }),
    ),
  };
};

describe("batch delete", () => {
  it("DELETEs each sys_id and returns per-item status in input order", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed(null));

    const exit = await run(
      ["batch", "delete", "incident", "good1", "good2"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      [
        { sys_id: "good1", ok: true },
        { sys_id: "good2", ok: true },
      ],
    ]);
    assert.deepEqual(seen.paths, [
      "/api/now/table/incident/good1",
      "/api/now/table/incident/good2",
    ]);
    assert.ok(seen.methods.every((m) => m === "DELETE"));
  });

  it("continues past a mid-list failure and exits 5 with status for every item", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer, seen } = stub((path) =>
      path.endsWith("/bad")
        ? Effect.fail(
            new SnRequestError({
              message: "ACL exception",
              status: 403,
            }),
          )
        : Effect.succeed(null),
    );

    const exit = await Effect.runPromiseExit(
      Command.runWith(
        sn.pipe(Command.provide(Layer.merge(layer, emitCapture(writes)))),
        { version: "0.0.0-test", renderErrors: false },
      )(["batch", "delete", "incident", "good1", "bad", "good2"]).pipe(
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
    assert.deepEqual(seen.paths, [
      "/api/now/table/incident/good1",
      "/api/now/table/incident/bad",
      "/api/now/table/incident/good2",
    ]);
    assert.deepEqual(writes, [
      [
        { sys_id: "good1", ok: true },
        { sys_id: "bad", ok: false, error: "ACL exception" },
        { sys_id: "good2", ok: true },
      ],
    ]);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    }) as SnBatchPartialError;
    assert.equal(error._tag, "SnBatchPartialError");
    assert.equal(error[Runtime.errorExitCode], 5);
    assert.equal(stderr.length, 1);
    assert.deepEqual(JSON.parse(stderr[0]!), {
      _tag: "SnBatchPartialError",
      message: "1 of 3 deletes failed",
      failed: 1,
      total: 3,
    });
  });

  it("exits 6 when every item fails and still returns per-item status", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() =>
      Effect.fail(
        new SnRequestError({ message: "No such record", status: 404 }),
      ),
    );

    const exit = await run(
      ["batch", "delete", "incident", "bad1", "bad2"],
      layer,
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    assert.equal(seen.paths.length, 2);
    assert.deepEqual(writes, [
      [
        { sys_id: "bad1", ok: false, error: "No such record" },
        { sys_id: "bad2", ok: false, error: "No such record" },
      ],
    ]);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    }) as SnBatchFailedError;
    assert.equal(error._tag, "SnBatchFailedError");
    assert.equal(error[Runtime.errorExitCode], 6);
  });

  it("fails the whole command before any request when the sys_id list is empty", async () => {
    const writes: unknown[] = [];
    let called = false;
    const { layer } = stub(() => {
      called = true;
      return Effect.succeed(null);
    });

    const exit = await run(["batch", "delete", "incident"], layer, writes);

    assert.ok(Exit.isFailure(exit));
    assert.equal(called, false);
    assert.equal(writes.length, 0);
  });
});
