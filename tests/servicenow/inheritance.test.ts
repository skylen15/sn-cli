import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Effect, Layer, Schema } from "effect";

import { SnClient } from "#src/servicenow/client.ts";
import { SnRequestError } from "#src/servicenow/errors.ts";
import { inheritanceChain, parseTableRows } from "#src/servicenow/inheritance.ts";

const stub = (
  impl: (path: string, params?: Record<string, string>) => Effect.Effect<Schema.Json>,
): Layer.Layer<SnClient> =>
  Layer.succeed(
    SnClient,
    SnClient.of({
      request: Effect.fn("stub.request")(function* (path, params) {
        return yield* impl(path, params);
      }),
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

    const chain = await Effect.runPromise(inheritanceChain("incident").pipe(Effect.provide(layer)));

    assert.deepEqual(chain, ["incident", "task"]);
  });

  it("fails when the starting table has no sys_db_object row", async () => {
    const layer = stub(() => Effect.succeed({ result: [] }));

    await assert.rejects(
      () => Effect.runPromise(inheritanceChain("u_missing").pipe(Effect.provide(layer))),
      (error) => error instanceof SnRequestError,
    );
  });

  it("accepts JSON-valued fields in otherwise valid Table API rows", async () => {
    assert.deepEqual(
      await Effect.runPromise(
        parseTableRows({
          result: [
            {
              name: "incident",
              caller_id: {
                link: "https://x.service-now.com/api/now/table/sys_user/abc",
                value: "abc",
              },
            },
          ],
        }),
      ),
      [
        {
          name: "incident",
          caller_id: {
            link: "https://x.service-now.com/api/now/table/sys_user/abc",
            value: "abc",
          },
        },
      ],
    );
  });

  it("fails with SnRequestError for a malformed present Table API result", async () => {
    await assert.rejects(
      () => Effect.runPromise(parseTableRows({ result: "not-an-array" })),
      (error) => error instanceof SnRequestError,
    );
  });
});
