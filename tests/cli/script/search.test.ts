import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import { sn } from "#src/cli.ts";
import { emitCapture } from "#src/emit.ts";
import { SnClient, type RequestOptions } from "#src/servicenow/client.ts";
import {
  isSnError,
  SnRequestError,
  snErrorJson,
  type SnSearchIncompleteError,
} from "#src/servicenow/errors.ts";

const CLI = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));

const spawn = (args: ReadonlyArray<string>) => {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [CLI, ...args],
    { encoding: "utf8" },
  );
  return { stdout, stderr, code: status };
};

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
  stderr: string[] = [],
) =>
  Effect.runPromiseExit(
    Command.runWith(
      sn.pipe(Command.provide(Layer.merge(clientLayer, emitCapture(writes)))),
      { version: "0.0.0-test", renderErrors: false },
    )(args).pipe(
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

/** sys_script extends nothing; Dictionary reports script + condition as code,
 * description as plain string. */
const stubSysScriptDictionary: Request = (path, params, options) => {
  if (path === "/api/now/table/sys_db_object") {
    return Effect.succeed({
      result: [{ name: "sys_script", "super_class.name": "" }],
    });
  }
  if (path === "/api/now/table/sys_dictionary") {
    assert.equal(params?.sysparm_query, "nameINsys_script^ORDERBYelement");
    assert.equal(
      params?.sysparm_fields,
      "name,element,column_label,internal_type",
    );
    assert.equal(params?.sysparm_display_value, "all");
    return Effect.succeed({
      result: [
        {
          name: { value: "sys_script", display_value: "sys_script" },
          element: { value: "", display_value: "" },
          column_label: {
            value: "Business Rule",
            display_value: "Business Rule",
          },
          internal_type: { value: "", display_value: "" },
        },
        {
          name: { value: "sys_script", display_value: "sys_script" },
          element: { value: "script", display_value: "script" },
          column_label: { value: "Script", display_value: "Script" },
          internal_type: { value: "script", display_value: "Script" },
        },
        {
          name: { value: "sys_script", display_value: "sys_script" },
          element: { value: "condition", display_value: "condition" },
          column_label: { value: "Condition", display_value: "Condition" },
          internal_type: {
            value: "condition_string",
            display_value: "Condition String",
          },
        },
        {
          name: { value: "sys_script", display_value: "sys_script" },
          element: { value: "description", display_value: "description" },
          column_label: {
            value: "Description",
            display_value: "Description",
          },
          internal_type: { value: "string", display_value: "String" },
        },
        {
          name: { value: "sys_script", display_value: "sys_script" },
          element: { value: "active", display_value: "active" },
          column_label: { value: "Active", display_value: "Active" },
          internal_type: { value: "boolean", display_value: "True/False" },
        },
      ],
    });
  }
  if (path === "/api/now/graphql") {
    assert.equal(options?.method, "POST");
    return Effect.succeed({
      data: {
        GlideRecord_Query: {
          sys_script: {
            _rowCount: 1,
            _results: [
              {
                sys_id: { value: "gql123" },
                sys_name: { value: "GraphQL BR" },
                sys_class_name: { value: "sys_script" },
                script: {
                  value: "line one;\ngs.info('needle');\nline three;",
                },
                condition: { value: "gs.info('in condition')" },
              },
            ],
          },
        },
      },
    });
  }
  return Effect.succeed({ result: [] });
};

/** One group, one Record, two Field matches (script + condition). */
const groupsResponse = {
  result: [
    {
      recordType: "sys_script",
      tableLabel: "Business Rules",
      hits: [
        {
          sysId: "abc123def456abc123def456abc123de",
          name: "My BR",
          className: "sys_script",
          tableLabel: "Business Rules",
          matches: [
            {
              field: "script",
              fieldLabel: "Script",
              lineMatches: [
                {
                  line: 12,
                  context: "gs.info('hello')",
                  escaped: "gs.info(&#39;hello&#39;)",
                },
                { line: 40, context: "var x = hello;" },
              ],
            },
            {
              field: "condition",
              fieldLabel: "Condition",
              lineMatches: [{ line: 1, context: "hello == true" }],
            },
          ],
        },
      ],
    },
  ],
};

const expectedHit = {
  sysId: "abc123def456abc123def456abc123de",
  name: "My BR",
  table: "sys_script",
  fieldMatches: [
    {
      field: "script",
      matchedLineCount: 2,
      omittedMatchedLines: 0,
      lines: [
        { lineNumber: 12, content: "gs.info('hello')", matched: true },
        { lineNumber: 40, content: "var x = hello;", matched: true },
      ],
    },
    {
      field: "condition",
      matchedLineCount: 1,
      omittedMatchedLines: 0,
      lines: [{ lineNumber: 1, content: "hello == true", matched: true }],
    },
  ],
};

const graphqlStemMissResponse = {
  data: {
    GlideRecord_Query: {
      sys_script: {
        _rowCount: 1,
        _results: [
          {
            sys_id: { value: "stem1" },
            sys_name: { value: "Near miss" },
            sys_class_name: { value: "sys_script" },
            // Instance returned the Record, but the field does not contain the term.
            script: { value: "gs.print('something else');" },
          },
        ],
      },
    },
  },
};

describe("script search", () => {
  it("returns one Hit with sysId and two Field matches for one Record", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed(groupsResponse));
    const exit = await run(
      ["script", "search", "hello", "--engine", "native", "--limit", "50"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/sn_codesearch/code_search/search");
    assert.equal(seen.params?.term, "hello");
    assert.equal(seen.params?.limit, "50");
    assert.deepEqual(writes, [[expectedHit]]);
  });

  it("defaults --engine to graphql", async () => {
    const writes: unknown[] = [];
    const paths: string[] = [];
    const { layer } = stub((path, params, options) => {
      paths.push(path);
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return stubSysScriptDictionary(path, params, options);
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(["script", "search", "needle"], layer, writes);

    assert.ok(Exit.isSuccess(exit));
    assert.ok(paths.includes("/api/now/graphql"));
    assert.ok(!paths.includes("/api/sn_codesearch/code_search/search"));
  });

  it("still returns the Hit model on --engine native", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(() => Effect.succeed(groupsResponse));
    const exit = await run(
      ["script", "search", "hello", "--engine", "native"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/sn_codesearch/code_search/search");
    assert.deepEqual(writes, [[expectedHit]]);
  });

  it("normalises a single-object result to the same Hit array shape", async () => {
    const writes: unknown[] = [];
    const { layer } = stub(() =>
      Effect.succeed({ result: groupsResponse.result[0] }),
    );
    const exit = await run(
      ["script", "search", "hello", "--engine", "native"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [[expectedHit]]);
  });

  it("renders --format text grouping Field matches under their Record", async () => {
    const writes: unknown[] = [];
    const { layer } = stub(() => Effect.succeed(groupsResponse));
    const exit = await run(
      ["script", "search", "hello", "--engine", "native", "--format", "text"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(writes.length, 1);
    const text = writes[0];
    assert.equal(typeof text, "string");
    assert.match(text as string, /Found 1 hits?/);
    assert.match(
      text as string,
      /sys_script > My BR \(abc123def456abc123def456abc123de\)/,
    );
    assert.match(text as string, /script \(2\)/);
    assert.match(text as string, /condition \(1\)/);
    assert.match(text as string, /L12: gs\.info\('hello'\)/);
    assert.match(text as string, /L1: hello == true/);
  });

  it("marks context lines apart from Matched lines in --format text", async () => {
    const writes: unknown[] = [];
    const { layer } = stub((path, params, options) => {
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: {
                _rowCount: 1,
                _results: [
                  {
                    sys_id: { value: "ctx1" },
                    sys_name: { value: "Context BR" },
                    sys_class_name: { value: "sys_script" },
                    script: {
                      value: "before;\nneedle here;\nafter;",
                    },
                  },
                ],
              },
            },
          },
        });
      }
      return stubSysScriptDictionary(path, params, options);
    });
    const exit = await run(
      [
        "script",
        "search",
        "needle",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
        "--format",
        "text",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const text = writes[0];
    assert.equal(typeof text, "string");
    assert.match(text as string, /L1- before;/);
    assert.match(text as string, /L2: needle here;/);
    assert.match(text as string, /L3- after;/);
  });

  it("returns an empty array when there are no Hits", async () => {
    const writes: unknown[] = [];
    const { layer } = stub(() => Effect.succeed({ result: [] }));
    const exit = await run(
      ["script", "search", "zzzz-no-match", "--engine", "native"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [[]]);
  });

  it("names --engine native on a GraphQL failure and never falls back", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const paths: string[] = [];
    const { layer } = stub((path) => {
      paths.push(path);
      if (path === "/api/now/table/sys_db_object") {
        return Effect.succeed({
          result: [{ name: "sys_script", "super_class.name": "" }],
        });
      }
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return Effect.fail(
          new SnRequestError({
            message: "ServiceNow returned HTTP 403",
            status: 403,
          }),
        );
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(
      [
        "script",
        "search",
        "needle",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
      stderr,
    );

    assert.ok(Exit.isFailure(exit));
    assert.equal(writes.length, 0);
    assert.ok(!paths.includes("/api/sn_codesearch/code_search/search"));
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    }) as SnRequestError;
    assert.equal(error._tag, "SnRequestError");
    assert.match(error.message, /--engine native/);
    assert.match(stderr[0] ?? "", /--engine native/);
  });

  it("does not probe capability before searching", async () => {
    const paths: string[] = [];
    const { layer } = stub((path, params, options) => {
      paths.push(path);
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return stubSysScriptDictionary(path, params, options);
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(["script", "search", "needle"], layer, []);

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(
      paths.filter((path) => path !== "/api/now/table/sys_dictionary"),
      ["/api/now/graphql"],
    );
  });
});

describe("script search --engine graphql", () => {
  it("POSTs the Encoded Query for the named Artifact through the client seam", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/now/graphql");
    assert.equal(seen.options?.method, "POST");
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
    assert.deepEqual(writes, [
      [
        {
          sysId: "gql123",
          name: "GraphQL BR",
          table: "sys_script",
          fieldMatches: [
            {
              field: "script",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "line one;",
                  matched: false,
                },
                {
                  lineNumber: 2,
                  content: "gs.info('needle');",
                  matched: true,
                },
                {
                  lineNumber: 3,
                  content: "line three;",
                  matched: false,
                },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it("drops a Record whose field value does not contain the term", async () => {
    const writes: unknown[] = [];
    const { layer } = stub((path, params, options) => {
      if (path === "/api/now/graphql") {
        return Effect.succeed(graphqlStemMissResponse);
      }
      return stubSysScriptDictionary(path, params, options);
    });
    const exit = await run(
      [
        "script",
        "search",
        "needle",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [[]]);
  });

  it("returns an empty result and exits zero when nothing matches", async () => {
    const writes: unknown[] = [];
    const { layer } = stub((path, params, options) => {
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: { _rowCount: 0, _results: [] },
            },
          },
        });
      }
      return stubSysScriptDictionary(path, params, options);
    });
    const exit = await run(
      [
        "script",
        "search",
        "zzzz-no-match",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [[]]);
  });

  it("discovers code fields from the Dictionary when --field is omitted", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(seen.path, "/api/now/graphql");
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEgs.info^ORconditionLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } condition { value displayValue } } } } }',
    );
    assert.deepEqual(writes, [
      [
        {
          sysId: "gql123",
          name: "GraphQL BR",
          table: "sys_script",
          fieldMatches: [
            {
              field: "script",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "line one;",
                  matched: false,
                },
                {
                  lineNumber: 2,
                  content: "gs.info('needle');",
                  matched: true,
                },
                {
                  lineNumber: 3,
                  content: "line three;",
                  matched: false,
                },
              ],
            },
            {
              field: "condition",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "gs.info('in condition')",
                  matched: true,
                },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it("still narrows to --field when given", async () => {
    const writes: unknown[] = [];
    const paths: string[] = [];
    const { layer, seen } = stub((path, params, options) => {
      paths.push(path);
      return stubSysScriptDictionary(path, params, options);
    });
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(paths, [
      "/api/now/table/sys_db_object",
      "/api/now/table/sys_dictionary",
      "/api/now/graphql",
    ]);
    assert.equal(seen.path, "/api/now/graphql");
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("omits active=true when --include-inactive is set", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
        "--include-inactive",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("repeats active=true into each ^NQ clause for --match-mode any", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "alpha beta",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
        "--match-mode",
        "any",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEalpha^NQactive=true^scriptLIKEbeta", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("AND-joins words for --match-mode all", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "alpha beta",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
        "--match-mode",
        "all",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEalpha^active=true^scriptLIKEbeta", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("omits active=true when the Artifact has no active field", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub((path, _params, options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "u_no_active", display_value: "u_no_active" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: { GlideRecord_Query: { u_no_active: { _results: [] } } },
        });
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.match(
      body?.query ?? "",
      /u_no_active\(queryConditions: "scriptLIKEneedle"/,
    );
    assert.doesNotMatch(body?.query ?? "", /active=true/);
  });

  it("searches a colon-bearing term literally", async () => {
    const writes: unknown[] = [];
    const { layer, seen } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "table:sys_script",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
        "--field",
        "script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.equal(
      body?.query,
      'query { GlideRecord_Query { sys_script(queryConditions: "active=true^scriptLIKEtable:sys_script", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("errors when the Dictionary reports no code fields", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub((path) => {
      if (path === "/api/now/table/sys_db_object") {
        return Effect.succeed({
          result: [{ name: "numbers_only", "super_class.name": "" }],
        });
      }
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "numbers_only", display_value: "numbers_only" },
              element: { value: "", display_value: "" },
              column_label: {
                value: "Numbers Only",
                display_value: "Numbers Only",
              },
              internal_type: { value: "", display_value: "" },
            },
            {
              name: { value: "numbers_only", display_value: "numbers_only" },
              element: { value: "count", display_value: "count" },
              column_label: { value: "Count", display_value: "Count" },
              internal_type: { value: "integer", display_value: "Integer" },
            },
          ],
        });
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(
      [
        "script",
        "search",
        "needle",
        "--engine",
        "graphql",
        "--table",
        "numbers_only",
      ],
      layer,
      writes,
      stderr,
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
    assert.match(error.message, /no code fields/);
    assert.deepEqual(stderr, [
      JSON.stringify({
        _tag: "SnRequestError",
        message: 'Table "numbers_only" has no code fields in the Dictionary',
      }),
    ]);
  });

  it("batches Dictionary Artifacts ten per GraphQL document when --table is omitted", async () => {
    const writes: unknown[] = [];
    const graphqlQueries: string[] = [];
    const dictionaryRows = Array.from({ length: 25 }, (_, i) => {
      const table = `u_code_${String(i).padStart(2, "0")}`;
      return {
        name: { value: table, display_value: table },
        element: { value: "script", display_value: "script" },
        column_label: { value: "Script", display_value: "Script" },
        internal_type: { value: "script", display_value: "Script" },
      };
    });
    const { layer } = stub((path, _params, options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({ result: dictionaryRows });
      }
      if (path === "/api/now/graphql") {
        const query = (options?.body as { query?: string } | undefined)?.query;
        if (typeof query !== "string") {
          throw new assert.AssertionError({
            message: "expected GraphQL query",
          });
        }
        graphqlQueries.push(query);
        const glide: Record<string, { _results: unknown[] }> = {};
        for (const match of query.matchAll(/\b(u_code_\d+)\(/g)) {
          glide[match[1]!] = { _results: [] };
        }
        return Effect.succeed({ data: { GlideRecord_Query: glide } });
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(
      ["script", "search", "gs.info", "--engine", "graphql"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.equal(graphqlQueries.length, 3);
    const [batch0, batch1, batch2] = graphqlQueries;
    assert.ok(batch0 && batch1 && batch2);
    for (let i = 0; i < 10; i += 1) {
      assert.match(
        batch0,
        new RegExp(`u_code_${String(i).padStart(2, "0")}\\(`),
      );
      assert.match(
        batch1,
        new RegExp(`u_code_${String(i + 10).padStart(2, "0")}\\(`),
      );
    }
    for (let i = 20; i < 25; i += 1) {
      assert.match(
        batch2,
        new RegExp(`u_code_${String(i).padStart(2, "0")}\\(`),
      );
    }
    assert.doesNotMatch(batch0, /u_code_10\(/);
    assert.doesNotMatch(batch2, /u_code_19\(/);
    assert.deepEqual(writes, [[]]);
  });

  it("merges Hits from every batch, grouped per Record", async () => {
    const writes: unknown[] = [];
    const { layer } = stub((path, _params, options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
            {
              name: { value: "u_custom", display_value: "u_custom" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        const query =
          (options?.body as { query?: string } | undefined)?.query ?? "";
        assert.match(query, /sys_script\(/);
        assert.match(query, /u_custom\(/);
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: {
                _rowCount: 1,
                _results: [
                  {
                    sys_id: { value: "br1" },
                    sys_name: { value: "Platform BR" },
                    sys_class_name: { value: "sys_script" },
                    script: { value: "gs.info('needle');" },
                  },
                ],
              },
              u_custom: {
                _rowCount: 1,
                _results: [
                  {
                    sys_id: { value: "cu1" },
                    sys_name: { value: "Custom script" },
                    sys_class_name: { value: "u_custom" },
                    script: { value: "gs.info('needle');" },
                  },
                ],
              },
            },
          },
        });
      }
      return Effect.succeed({ result: [] });
    });
    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(writes, [
      [
        {
          sysId: "br1",
          name: "Platform BR",
          table: "sys_script",
          fieldMatches: [
            {
              field: "script",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "gs.info('needle');",
                  matched: true,
                },
              ],
            },
          ],
        },
        {
          sysId: "cu1",
          name: "Custom script",
          table: "u_custom",
          fieldMatches: [
            {
              field: "script",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "gs.info('needle');",
                  matched: true,
                },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it("still narrows to --table when given", async () => {
    const writes: unknown[] = [];
    const paths: string[] = [];
    const { layer, seen } = stub((path, params, options) => {
      paths.push(path);
      if (path === "/api/now/table/sys_dictionary") {
        assert.match(params?.sysparm_query ?? "", /nameINsys_script/);
      }
      return stubSysScriptDictionary(path, params, options);
    });
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
      ],
      layer,
      writes,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.ok(paths.includes("/api/now/table/sys_db_object"));
    assert.ok(paths.includes("/api/now/table/sys_dictionary"));
    assert.ok(paths.includes("/api/now/graphql"));
    const body = seen.options?.body as { query?: string } | undefined;
    assert.match(body?.query ?? "", /sys_script\(/);
    assert.doesNotMatch(body?.query ?? "", /u_custom/);
  });

  it("emits Hits then exits 7 when one Artifact fails and the rest succeed", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub((path, _params, _options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
            {
              name: { value: "u_custom", display_value: "u_custom" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: {
                _rowCount: 1,
                _results: [
                  {
                    sys_id: { value: "br1" },
                    sys_name: { value: "Platform BR" },
                    sys_class_name: { value: "sys_script" },
                    script: { value: "gs.info('needle');" },
                  },
                ],
              },
            },
          },
          errors: [
            {
              message: 'Cannot query field "script" on type "u_custom"',
              path: ["GlideRecord_Query", "u_custom"],
            },
          ],
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
      stderr,
    );

    assert.equal(Exit.isSuccess(exit), false);
    assert.deepEqual(writes, [
      [
        {
          sysId: "br1",
          name: "Platform BR",
          table: "sys_script",
          fieldMatches: [
            {
              field: "script",
              matchedLineCount: 1,
              omittedMatchedLines: 0,
              lines: [
                {
                  lineNumber: 1,
                  content: "gs.info('needle');",
                  matched: true,
                },
              ],
            },
          ],
        },
      ],
    ]);
    const error = Exit.match(exit, {
      onSuccess: () => {
        throw new Error("expected failure");
      },
      onFailure: (cause) => Cause.squash(cause),
    }) as SnSearchIncompleteError;
    assert.equal(error._tag, "SnSearchIncompleteError");
    assert.equal(error[Runtime.errorExitCode], 7);
    assert.equal(stderr.length, 1);
    assert.deepEqual(JSON.parse(stderr[0]!), {
      _tag: "SnSearchIncompleteError",
      message: "1 search failure across 2 artifacts",
      failed: 1,
      total: 2,
      reasons: [
        {
          table: "u_custom",
          message: 'Cannot query field "script" on type "u_custom"',
        },
      ],
      unsearched: [],
    });
  });

  it("reports a missing Artifact as unsearched without counting it as an error", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub((path) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
            {
              name: { value: "u_custom", display_value: "u_custom" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: { _results: [] },
            },
          },
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
      stderr,
    );

    assert.equal(Exit.isSuccess(exit), false);
    assert.deepEqual(writes, [[]]);
    const payload = JSON.parse(stderr[0]!);
    assert.equal(payload._tag, "SnSearchIncompleteError");
    assert.equal(payload.failed, 0);
    assert.equal(payload.total, 2);
    assert.deepEqual(payload.reasons, []);
    assert.deepEqual(payload.unsearched, ["u_custom"]);
  });

  it("keeps an unattributed GraphQL error and a malformed entry as counted reasons", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub((path, params, options) => {
      if (path === "/api/now/table/sys_db_object") {
        return Effect.succeed({
          result: [{ name: "sys_script", "super_class.name": "" }],
        });
      }
      if (path === "/api/now/table/sys_dictionary") {
        return stubSysScriptDictionary(path, params, options);
      }
      if (path === "/api/now/graphql") {
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: { _results: [] },
            },
          },
          errors: [{ message: "Global validation failed" }, {}],
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      [
        "script",
        "search",
        "needle",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
      ],
      layer,
      writes,
      stderr,
    );

    assert.equal(Exit.isSuccess(exit), false);
    const payload = JSON.parse(stderr[0]!);
    assert.equal(payload.failed, 2);
    assert.deepEqual(payload.reasons, [
      { table: "", message: "Global validation failed" },
      { table: "", message: "Unspecified GraphQL error" },
    ]);
    assert.deepEqual(payload.unsearched, []);
  });

  it("re-asks a fully rejected batch one Artifact at a time", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const graphqlQueries: string[] = [];
    const { layer } = stub((path, _params, options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
            {
              name: { value: "u_bad", display_value: "u_bad" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        const query =
          (options?.body as { query?: string } | undefined)?.query ?? "";
        graphqlQueries.push(query);
        if (query.includes("sys_script(") && query.includes("u_bad(")) {
          return Effect.succeed({
            data: { GlideRecord_Query: {} },
            errors: [{ message: "Document validation failed" }],
          });
        }
        if (query.includes("u_bad(") && !query.includes("sys_script(")) {
          return Effect.succeed({
            data: { GlideRecord_Query: {} },
            errors: [
              {
                message: "Unknown field script on u_bad",
                path: ["GlideRecord_Query", "u_bad"],
              },
            ],
          });
        }
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: {
                _results: [
                  {
                    sys_id: { value: "br1" },
                    sys_name: { value: "OK" },
                    sys_class_name: { value: "sys_script" },
                    script: { value: "gs.info('needle');" },
                  },
                ],
              },
            },
          },
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
      stderr,
    );

    assert.equal(graphqlQueries.length, 3);
    assert.ok(
      graphqlQueries[0]!.includes("sys_script(") &&
        graphqlQueries[0]!.includes("u_bad("),
    );
    assert.ok(
      graphqlQueries.some(
        (q) => q.includes("sys_script(") && !q.includes("u_bad("),
      ),
    );
    assert.ok(
      graphqlQueries.some(
        (q) => q.includes("u_bad(") && !q.includes("sys_script("),
      ),
    );
    assert.equal(Exit.isSuccess(exit), false);
    assert.equal((writes[0] as unknown[]).length, 1);
    const payload = JSON.parse(stderr[0]!);
    assert.equal(payload.failed, 1);
    assert.deepEqual(payload.reasons, [
      { table: "u_bad", message: "Unknown field script on u_bad" },
    ]);
  });

  it("does not retry a batch that answered for some Artifacts", async () => {
    const graphqlQueries: string[] = [];
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub((path, _params, options) => {
      if (path === "/api/now/table/sys_dictionary") {
        return Effect.succeed({
          result: [
            {
              name: { value: "sys_script", display_value: "sys_script" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
            {
              name: { value: "u_custom", display_value: "u_custom" },
              element: { value: "script", display_value: "script" },
              column_label: { value: "Script", display_value: "Script" },
              internal_type: { value: "script", display_value: "Script" },
            },
          ],
        });
      }
      if (path === "/api/now/graphql") {
        graphqlQueries.push(
          (options?.body as { query?: string } | undefined)?.query ?? "",
        );
        return Effect.succeed({
          data: {
            GlideRecord_Query: {
              sys_script: { _results: [] },
            },
          },
          errors: [
            {
              message: "bad field",
              path: ["GlideRecord_Query", "u_custom"],
            },
          ],
        });
      }
      return Effect.succeed({ result: [] });
    });

    const exit = await run(
      ["script", "search", "needle", "--engine", "graphql"],
      layer,
      writes,
      stderr,
    );

    assert.equal(graphqlQueries.length, 1);
    assert.equal(Exit.isSuccess(exit), false);
    const payload = JSON.parse(stderr[0]!);
    assert.equal(payload.failed, 1);
    assert.deepEqual(payload.unsearched, []);
  });

  it("writes nothing to stderr on a fully successful GraphQL run", async () => {
    const writes: unknown[] = [];
    const stderr: string[] = [];
    const { layer } = stub(stubSysScriptDictionary);
    const exit = await run(
      [
        "script",
        "search",
        "gs.info",
        "--engine",
        "graphql",
        "--table",
        "sys_script",
      ],
      layer,
      writes,
      stderr,
    );

    assert.ok(Exit.isSuccess(exit));
    assert.deepEqual(stderr, []);
    assert.ok((writes[0] as unknown[]).length > 0);
  });
});

describe("script search --help", () => {
  it("documents every flag added for the GraphQL Engine", () => {
    const { stdout, code } = spawn(["script", "search", "--help"]);
    assert.equal(code, 0);
    assert.match(stdout, /--engine/);
    assert.match(stdout, /graphql/);
    assert.match(stdout, /native/);
    assert.match(stdout, /--table/);
    assert.match(stdout, /--field/);
    assert.match(stdout, /--match-mode/);
    assert.match(stdout, /--include-inactive/);
    assert.match(stdout, /--search-all-scopes/);
    assert.match(stdout, /--current-app/);
    assert.match(stdout, /--limit/);
    assert.match(stdout, /--format/);
    assert.match(stdout, /Defaults to the GraphQL Engine/);
  });
});
