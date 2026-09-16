import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime, Schema } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { SnClient } from "#src/servicenow/client.ts";
import { SnRequestError } from "#src/servicenow/errors.ts";

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

const stub = (impl: Request): Layer.Layer<SnClient> =>
  Layer.succeed(
    SnClient,
    SnClient.of({
      request: Effect.fn("stub.request")(function* (path, params) {
        return yield* impl(path, params);
      }),
    }),
  );

/** incident extends task. incident owns caller_id (Reference -> sys_user);
 * task owns state (Choice) and short_description (String). */
const stubSchema: Request = (path, params) => {
  if (path === "/api/now/table/sys_db_object") {
    const q = params?.sysparm_query;
    if (q === "name=incident") {
      return Effect.succeed({
        result: [{ name: "incident", "super_class.name": "task" }],
      });
    }
    return Effect.succeed({
      result: [{ name: "task", "super_class.name": "" }],
    });
  }
  if (path === "/api/now/table/sys_dictionary") {
    return Effect.succeed({
      result: [
        {
          name: "incident",
          element: "caller_id",
          "internal_type.name": "reference",
          column_label: "Caller",
          mandatory: "false",
          max_length: "32",
          default_value: "",
          "reference.name": "sys_user",
        },
        {
          name: "task",
          element: "state",
          "internal_type.name": "integer",
          column_label: "State",
          mandatory: "true",
          max_length: "40",
          default_value: "1",
          "reference.name": "",
        },
        {
          name: "task",
          element: "short_description",
          "internal_type.name": "string",
          column_label: "Short description",
          mandatory: "false",
          max_length: "160",
          default_value: "",
          "reference.name": "",
        },
      ],
    });
  }
  if (path === "/api/now/table/sys_choice") {
    return Effect.succeed({
      result: [
        { name: "task", element: "state", label: "New", value: "1" },
        { name: "task", element: "state", label: "Closed", value: "7" },
        // Same element name on another table must not bleed onto task.state.
        {
          name: "incident",
          element: "state",
          label: "Incident-only",
          value: "99",
        },
      ],
    });
  }
  return Effect.succeed({ result: [] });
};

describe("table schema", () => {
  it("returns columns with shape, reference, choices, and source_table", async () => {
    const writes: unknown[] = [];
    const exit = await run(["table", "schema", "incident"], stub(stubSchema), writes);

    assert.ok(Exit.isSuccess(exit));
    // Name-ok: `reference: "sys_user"` is allowed metadata; schema never emits Record values.
    assert.deepEqual(writes, [
      {
        table: "incident",
        columns: [
          {
            name: "caller_id",
            type: "reference",
            label: "Caller",
            mandatory: false,
            max_length: "32",
            default_value: "",
            source_table: "incident",
            reference: "sys_user",
          },
          {
            name: "state",
            type: "integer",
            label: "State",
            mandatory: true,
            max_length: "40",
            default_value: "1",
            source_table: "task",
            choices: [
              { label: "New", value: "1" },
              { label: "Closed", value: "7" },
            ],
          },
          {
            name: "short_description",
            type: "string",
            label: "Short description",
            mandatory: false,
            max_length: "160",
            default_value: "",
            source_table: "task",
          },
        ],
      },
    ]);
  });

  it("reports malformed Dictionary payloads as SnRequestError", async () => {
    const writes: unknown[] = [];
    const exit = await run(
      ["table", "schema", "incident"],
      stub((path) => {
        if (path === "/api/now/table/sys_db_object") {
          return Effect.succeed({
            result: [{ name: "incident", "super_class.name": "" }],
          });
        }
        if (path === "/api/now/table/sys_dictionary") {
          return Effect.succeed({ result: "not an array" });
        }
        return Effect.succeed({ result: [] });
      }),
      writes,
    );

    assert.ok(Exit.isFailure(exit));
    assert.deepEqual(writes, []);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(error instanceof SnRequestError);
    assert.equal(error[Runtime.errorExitCode], 4);
    assert.match(error.message, /Malformed ServiceNow Table API response/);
  });

  it("allows inspecting schema for formerly Sensitive Tables on an allowed instance", async () => {
    const writes: unknown[] = [];
    const layer = stub((path) => {
      if (path === "/api/now/table/sys_db_object") {
        return Effect.succeed({
          result: [{ name: "sys_user", "super_class.name": "" }],
        });
      }
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: "sys_user",
              element: "user_name",
              "internal_type.name": "string",
              column_label: "User ID",
              mandatory: "true",
              max_length: "40",
              default_value: "",
            },
          ],
        });
      }
      if (path === "/api/now/table/sys_choice") {
        return Effect.succeed({ result: [] });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(["table", "schema", "sys_user"], layer, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        table: "sys_user",
        columns: [
          {
            name: "user_name",
            type: "string",
            label: "User ID",
            mandatory: true,
            max_length: "40",
            default_value: "",
            source_table: "sys_user",
          },
        ],
      },
    ]);
  });
});
