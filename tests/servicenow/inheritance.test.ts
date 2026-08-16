import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Effect, Layer } from "effect";

import { SnClient } from "#src/servicenow/client.ts";
import { inheritanceChain } from "#src/servicenow/inheritance.ts";

const stub = (
  impl: (
    path: string,
    params?: Record<string, string>,
  ) => Effect.Effect<unknown>,
): Layer.Layer<SnClient> =>
  Layer.succeed(
    SnClient,
    SnClient.of({
      request: Effect.fn("stub.request")(function* (path, params) {
        return yield* impl(path, params);
      }),
      token: () => Effect.die("SnClient.token unused in stub"),
    }),
  );

describe("inheritanceChain", () => {
  it("walks super_class from the table up to the root", async () => {
    const layer = stub((path, params) => {
      assert.equal(path, "/api/now/table/sys_db_object");
      const q = params?.sysparm_query;
      if (q === "name=incident") {
        return Effect.succeed({
          result: [{ name: "incident", "super_class.name": "task" }],
        });
      }
      if (q === "name=task") {
        return Effect.succeed({
          result: [{ name: "task", "super_class.name": "" }],
        });
      }
      return Effect.succeed({ result: [] });
    });

    const chain = await Effect.runPromise(
      inheritanceChain("incident").pipe(Effect.provide(layer)),
    );

    assert.deepEqual(chain, ["incident", "task"]);
  });
});
