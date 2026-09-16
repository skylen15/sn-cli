import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime, Schema } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture, emitJson } from "#src/emit.ts";
import { SnClient } from "#src/servicenow/client.ts";
import { SnLocalError, SnRequestError } from "#src/servicenow/errors.ts";

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

const ALL_CATEGORY_IDS = [
  "business_rules",
  "client_scripts",
  "ui_policies",
  "ui_actions",
  "acls",
  "data_policies",
  "notifications",
  "workflows",
] as const;

const ConfigCategoriesOutput = Schema.Struct({
  categories: Schema.Record(Schema.String, Schema.Unknown),
});

/** Bare table with no parent and nothing configured in any category. */
const stubEmpty: Request = (path) => {
  if (path === "/api/now/table/sys_db_object") {
    return Effect.succeed({
      result: [{ name: "incident", "super_class.name": "" }],
    });
  }
  return Effect.succeed({ result: [] });
};

/** incident extends task. A business rule lives on task (inherited). */
const stubInheritedBr: Request = (path, params) => {
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
  if (path === "/api/now/table/sys_script") {
    return Effect.succeed({
      result: [
        {
          collection: "task",
          name: "Set priority",
          active: "true",
          when: "before",
          script: "current.priority = 1;",
        },
      ],
    });
  }
  return Effect.succeed({ result: [] });
};

describe("table config", () => {
  it("returns every curated category, empty when nothing is configured", async () => {
    const writes: unknown[] = [];
    const exit = await run(["table", "config", "incident"], stub(stubEmpty), writes);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        table: "incident",
        chain: ["incident"],
        categories: Object.fromEntries(
          ALL_CATEGORY_IDS.map((id) => [id, { count: 0, records: [] }]),
        ),
      },
    ]);
  });

  it("tags inherited records with source_table and includes script bodies", async () => {
    const writes: unknown[] = [];
    let scriptQuery: string | undefined;
    let excludesReferenceLinks: string | undefined;
    const exit = await run(
      ["table", "config", "incident", "--categories", "business_rules"],
      stub((path, params) => {
        if (path === "/api/now/table/sys_script") {
          scriptQuery = params?.sysparm_query;
          excludesReferenceLinks = params?.sysparm_exclude_reference_link;
        }
        return stubInheritedBr(path, params);
      }),
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(scriptQuery, "collectionINincident,task");
    assert.equal(excludesReferenceLinks, "true");
    assert.deepEqual(writes, [
      {
        table: "incident",
        chain: ["incident", "task"],
        categories: {
          business_rules: {
            count: 1,
            records: [
              {
                source_table: "task",
                name: "Set priority",
                active: "true",
                when: "before",
                script: "current.priority = 1;",
              },
            ],
          },
        },
      },
    ]);
  });

  it("omits source_table when a response omits its link field", async () => {
    const writes: unknown[] = [];
    const exit = await run(
      ["table", "config", "incident", "--categories", "business_rules"],
      stub((path) => {
        if (path === "/api/now/table/sys_db_object") {
          return Effect.succeed({
            result: [{ name: "incident", "super_class.name": "" }],
          });
        }
        if (path === "/api/now/table/sys_script") {
          return Effect.succeed({ result: [{ name: "Missing collection" }] });
        }
        return Effect.succeed({ result: [] });
      }),
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        table: "incident",
        chain: ["incident"],
        categories: {
          business_rules: {
            count: 1,
            records: [{ name: "Missing collection" }],
          },
        },
      },
    ]);
  });

  it("reports malformed category payloads as SnRequestError", async () => {
    const writes: unknown[] = [];
    const exit = await run(
      ["table", "config", "incident", "--categories", "business_rules"],
      stub((path) =>
        Effect.succeed(
          path === "/api/now/table/sys_db_object"
            ? { result: [{ name: "incident", "super_class.name": "" }] }
            : { result: "not an array" },
        ),
      ),
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

  it("classifies non-JSON command output as SnLocalError", async () => {
    const writes: unknown[] = [];
    const exit = await Effect.runPromiseExit(
      emitJson(1n).pipe(Effect.provide(emitCapture(writes))),
    );

    assert.ok(Exit.isFailure(exit));
    assert.deepEqual(writes, []);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    });
    assert.ok(error instanceof SnLocalError);
    assert.equal(error[Runtime.errorExitCode], 8);
    assert.equal(error.message, "Command result is not valid JSON");
  });

  it("matches ACLs on bare and field forms and attributes source_table from the name", async () => {
    const writes: unknown[] = [];
    let aclQuery: string | undefined;
    const exit = await run(
      ["table", "config", "incident", "--categories", "acls"],
      stub((path, params) => {
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
        if (path === "/api/now/table/sys_security_acl") {
          aclQuery = params?.sysparm_query;
          return Effect.succeed({
            result: [
              {
                name: "incident.short_description",
                operation: "write",
                type: "record",
                active: "true",
                script: "answer = gs.hasRole('itil');",
              },
              {
                name: "task",
                operation: "read",
                type: "record",
                active: "true",
                script: "answer = true;",
              },
            ],
          });
        }
        return Effect.succeed({ result: [] });
      }),
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(
      aclQuery,
      "name=incident^ORnameSTARTSWITHincident.^ORname=task^ORnameSTARTSWITHtask.",
    );
    assert.deepEqual(writes, [
      {
        table: "incident",
        chain: ["incident", "task"],
        categories: {
          acls: {
            count: 2,
            records: [
              {
                source_table: "incident",
                name: "incident.short_description",
                operation: "write",
                type: "record",
                active: "true",
                script: "answer = gs.hasRole('itil');",
              },
              {
                source_table: "task",
                name: "task",
                operation: "read",
                type: "record",
                active: "true",
                script: "answer = true;",
              },
            ],
          },
        },
      },
    ]);
  });

  it("limits the fan-out to only the requested categories", async () => {
    const writes: unknown[] = [];
    const hit: string[] = [];
    const exit = await run(
      ["table", "config", "incident", "--categories", "business_rules", "--categories", "acls"],
      stub((path, params) => {
        if (path.startsWith("/api/now/table/") && path !== "/api/now/table/sys_db_object") {
          hit.push(path.replace("/api/now/table/", ""));
        }
        return stubEmpty(path, params);
      }),
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(hit.sort(), ["sys_script", "sys_security_acl"].sort());
    const out = Schema.decodeUnknownSync(ConfigCategoriesOutput)(writes[0]);
    assert.deepEqual(Object.keys(out.categories).sort(), ["acls", "business_rules"]);
  });

  it("allows reconstructing configuration for formerly Sensitive Tables on an allowed instance", async () => {
    const writes: unknown[] = [];
    const layer = stub((path) => {
      if (path === "/api/now/table/sys_db_object") {
        return Effect.succeed({
          result: [{ name: "sys_user", "super_class.name": "" }],
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      ["table", "config", "sys_user", "--categories", "business_rules"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      {
        table: "sys_user",
        chain: ["sys_user"],
        categories: {
          business_rules: {
            count: 0,
            records: [],
          },
        },
      },
    ]);
  });
});
