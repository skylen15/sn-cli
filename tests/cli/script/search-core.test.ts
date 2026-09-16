import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Schema } from "effect";

import {
  ARTIFACTS_PER_DOCUMENT,
  batchWasRejected,
  buildEncodedQuery,
  buildGraphqlBatchQuery,
  buildGraphqlQuery,
  chunk,
  codeFieldDictionaryQuery,
  discoverArtifacts,
  hasArtifactData,
  processHits,
  readDictionary,
  readQueryErrors,
  tokenise,
} from "#src/commands/script/search-core.ts";

const CODE_FIELD_TYPES = [
  "script",
  "script_plain",
  "script_server",
  "script_client",
  "email_script",
  "html_script",
  "condition_string",
  "conditions",
  "expression",
  "json",
  "json_translations",
  "xml",
  "html",
  "html_template",
  "translated_html",
  "css",
  "graphql_schema",
] as const;

const dictionaryPayload = (rows: Schema.Json[]) => ({ result: rows });

describe("search-core tokenise", () => {
  it("returns a multi-word term as one phrase by default", () => {
    assert.deepEqual(tokenise("alpha beta"), ["alpha beta"]);
  });

  it("returns a pasted message as one phrase, not seventeen words", () => {
    const message =
      "This risk assessment is not assigned to you. Therefore, you " +
      "can't take any actions on this assessment.";

    assert.deepEqual(tokenise(message), [message]);
  });

  it("unwraps a phrase the user quoted themselves", () => {
    assert.deepEqual(tokenise('  "alpha beta"  '), ["alpha beta"]);
  });

  it("drops a phrase shorter than the minimum length", () => {
    assert.deepEqual(tokenise("a"), []);
    assert.deepEqual(tokenise("   "), []);
  });

  it("keeps table: and field: tokens as literal search text", () => {
    // sn divergence from the browser tool: filters are flags, not term syntax
    // (spec Term and matching / user story 16).
    assert.deepEqual(tokenise("table:sys_script needle"), ["table:sys_script needle"]);
    assert.deepEqual(tokenise("table:sys_script needle", { matchMode: "all" }), [
      "table:sys_script",
      "needle",
    ]);
  });

  it("treats unknown match modes as phrase", () => {
    assert.deepEqual(tokenise("alpha beta", { matchMode: "other" }), ["alpha beta"]);
  });

  it("splits on whitespace in all mode and keeps quoted phrases together", () => {
    assert.deepEqual(tokenise('a "two words" xyz', { matchMode: "all", minWordLength: 3 }), [
      "two words",
      "xyz",
    ]);
  });

  it("splits the same way in any mode", () => {
    assert.deepEqual(tokenise("alpha beta", { matchMode: "any" }), ["alpha", "beta"]);
  });
});

describe("search-core buildEncodedQuery", () => {
  it("builds a single-word query across one field", () => {
    assert.equal(buildEncodedQuery(["needle"], ["script"]), "scriptLIKEneedle");
  });

  it("OR-joins across fields for one word", () => {
    assert.equal(
      buildEncodedQuery(["needle"], ["script", "condition"]),
      "scriptLIKEneedle^ORconditionLIKEneedle",
    );
  });

  it("AND-joins multiple words across fields", () => {
    assert.equal(
      buildEncodedQuery(["alpha", "beta"], ["script", "condition"]),
      "scriptLIKEalpha^ORconditionLIKEalpha^scriptLIKEbeta^ORconditionLIKEbeta",
    );
  });

  it("searches a multi-word phrase as one LIKE value", () => {
    assert.equal(
      buildEncodedQuery(["alpha beta"], ["script", "condition"]),
      "scriptLIKEalpha beta^ORconditionLIKEalpha beta",
    );
  });

  it("prefixes active=true when includeActive", () => {
    assert.equal(
      buildEncodedQuery(["needle"], ["script", "condition"], {
        includeActive: true,
      }),
      "active=true^scriptLIKEneedle^ORconditionLIKEneedle",
    );
  });

  it("OR-joins word groups with ^NQ in any mode", () => {
    assert.equal(
      buildEncodedQuery(["alpha", "beta"], ["script", "condition"], {
        matchMode: "any",
      }),
      "scriptLIKEalpha^ORconditionLIKEalpha^NQscriptLIKEbeta^ORconditionLIKEbeta",
    );
  });

  it("repeats active=true into each ^NQ alternative", () => {
    assert.equal(
      buildEncodedQuery(["alpha", "beta"], ["script", "condition"], {
        matchMode: "any",
        includeActive: true,
      }),
      "active=true^scriptLIKEalpha^ORconditionLIKEalpha^NQactive=true^scriptLIKEbeta^ORconditionLIKEbeta",
    );
  });
});

describe("search-core processHits", () => {
  it("returns a hit with a single matched line and its stored line number", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "abc123" },
          sys_name: { value: "My BR", displayValue: "My BR" },
          sys_class_name: { value: "sys_script" },
          script: { value: 'gs.info("needle here");' },
          condition: { value: "" },
        },
      ],
    };

    assert.deepEqual(processHits("sys_script", ["script"], ["needle"], tableData), [
      {
        sysId: "abc123",
        name: "My BR",
        table: "sys_script",
        fieldMatches: [
          {
            field: "script",
            matchedLineCount: 1,
            omittedMatchedLines: 0,
            lines: [
              {
                lineNumber: 1,
                content: 'gs.info("needle here");',
                matched: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("collapses two matching fields on one record into one hit", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "rec1" },
          sys_name: { displayValue: "Shared" },
          sys_class_name: { value: "sys_script" },
          script: { value: "var needle = 1;" },
          condition: { value: "needle == 1" },
        },
      ],
    };

    assert.deepEqual(processHits("sys_script", ["script", "condition"], ["needle"], tableData), [
      {
        sysId: "rec1",
        name: "Shared",
        table: "sys_script",
        fieldMatches: [
          {
            field: "script",
            matchedLineCount: 1,
            omittedMatchedLines: 0,
            lines: [
              {
                lineNumber: 1,
                content: "var needle = 1;",
                matched: true,
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
                content: "needle == 1",
                matched: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("matches words case-insensitively without changing line content", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "case1" },
          sys_name: { value: "Case" },
          script: { value: "Call NeEdLeNow();" },
          condition: { value: "" },
        },
      ],
    };

    assert.deepEqual(processHits("sys_script", ["script"], ["needle"], tableData), [
      {
        sysId: "case1",
        name: "Case",
        table: "sys_script",
        fieldMatches: [
          {
            field: "script",
            matchedLineCount: 1,
            omittedMatchedLines: 0,
            lines: [
              {
                lineNumber: 1,
                content: "Call NeEdLeNow();",
                matched: true,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("numbers CRLF and lone-CR line endings correctly", () => {
    const crlf = processHits("sys_ui_script", ["script"], ["needle"], {
      _results: [
        {
          sys_id: { value: "crlf1" },
          sys_name: { value: "CRLF" },
          script: { value: "before\r\nneedle CRLF\r\nafter" },
        },
      ],
    });
    assert.deepEqual(crlf[0]?.fieldMatches[0]?.lines, [
      { lineNumber: 1, content: "before", matched: false },
      { lineNumber: 2, content: "needle CRLF", matched: true },
      { lineNumber: 3, content: "after", matched: false },
    ]);

    const cr = processHits("sys_ui_script", ["script"], ["needle"], {
      _results: [
        {
          sys_id: { value: "cr1" },
          sys_name: { value: "CR" },
          script: { value: "before\rneedle CR\rafter" },
        },
      ],
    });
    assert.deepEqual(cr[0]?.fieldMatches[0]?.lines, [
      { lineNumber: 1, content: "before", matched: false },
      { lineNumber: 2, content: "needle CR", matched: true },
      { lineNumber: 3, content: "after", matched: false },
    ]);
  });

  it("includes every matched line with one context line either side", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "ui1" },
          sys_name: { value: "UI" },
          script: {
            value: ["before", "alpha here", "middle", "between", "beta there", "after"].join("\n"),
          },
        },
      ],
    };

    assert.deepEqual(
      processHits("sys_ui_script", ["script"], ["alpha", "beta"], tableData)[0]?.fieldMatches[0],
      {
        field: "script",
        matchedLineCount: 2,
        omittedMatchedLines: 0,
        lines: [
          { lineNumber: 1, content: "before", matched: false },
          { lineNumber: 2, content: "alpha here", matched: true },
          { lineNumber: 3, content: "middle", matched: false },
          { lineNumber: 4, content: "between", matched: false },
          { lineNumber: 5, content: "beta there", matched: true },
          { lineNumber: 6, content: "after", matched: false },
        ],
      },
    );
  });

  it("deduplicates overlapping context around adjacent matched lines", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "adj1" },
          sys_name: { value: "Adjacent" },
          script: {
            value: ["keep", "needle one", "needle two", "tail"].join("\n"),
          },
        },
      ],
    };

    assert.deepEqual(
      processHits("sys_ui_script", ["script"], ["needle"], tableData)[0]?.fieldMatches[0]?.lines,
      [
        { lineNumber: 1, content: "keep", matched: false },
        { lineNumber: 2, content: "needle one", matched: true },
        { lineNumber: 3, content: "needle two", matched: true },
        { lineNumber: 4, content: "tail", matched: false },
      ],
    );
  });

  it("clamps context at the first and last line of the value", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "edge1" },
          sys_name: { value: "Edges" },
          script: { value: "needle top\nmiddle\nneedle bottom" },
        },
      ],
    };

    assert.deepEqual(
      processHits("sys_ui_script", ["script"], ["needle"], tableData)[0]?.fieldMatches[0]?.lines,
      [
        { lineNumber: 1, content: "needle top", matched: true },
        { lineNumber: 2, content: "middle", matched: false },
        { lineNumber: 3, content: "needle bottom", matched: true },
      ],
    );
  });

  it("caps excerpts and reports omitted matched lines for dense matches", () => {
    const lines: string[] = [];
    for (let index = 1; index <= 25; index += 1) {
      lines.push("needle line " + index);
    }
    const tableData = {
      _results: [
        {
          sys_id: { value: "cap1" },
          sys_name: { value: "Capped" },
          script: { value: lines.join("\n") },
        },
      ],
    };

    const fieldMatch = processHits("sys_ui_script", ["script"], ["needle"], tableData)[0]
      ?.fieldMatches[0];

    assert.equal(fieldMatch?.matchedLineCount, 25);
    assert.equal(fieldMatch?.omittedMatchedLines, 5);
    assert.equal(fieldMatch?.lines.length, 20);
    assert.equal(fieldMatch?.lines[0]?.lineNumber, 1);
    assert.equal(fieldMatch?.lines[19]?.lineNumber, 20);
    assert.ok(fieldMatch?.lines.every((line) => line.matched === true));
  });

  it("prefers matched lines over context when the budget is tight (divergence from source)", () => {
    // Source fills the cap with context windows and drops matched lines
    // (12 matched → 7 shown, 5 omitted). We keep every matched line first.
    const lines: string[] = [];
    for (let index = 1; index <= 60; index += 1) {
      lines.push(index % 5 === 0 ? "needle line " + index : "plain line " + index);
    }
    const tableData = {
      _results: [
        {
          sys_id: { value: "sparse1" },
          sys_name: { value: "Sparse" },
          script: { value: lines.join("\n") },
        },
      ],
    };

    const fieldMatch = processHits("sys_ui_script", ["script"], ["needle"], tableData)[0]
      ?.fieldMatches[0];

    assert.equal(fieldMatch?.matchedLineCount, 12);
    assert.equal(fieldMatch?.omittedMatchedLines, 0);
    assert.equal(fieldMatch?.lines.length, 20);
    assert.equal(fieldMatch?.lines.filter((line) => line.matched).length, 12);
    assert.deepEqual(
      fieldMatch?.lines.map((line) => line.lineNumber),
      [4, 5, 6, 9, 10, 11, 14, 15, 16, 19, 20, 21, 25, 30, 35, 40, 45, 50, 55, 60],
    );
  });

  it("skips empty responses and fields whose value does not contain the term", () => {
    assert.deepEqual(processHits("sys_script", ["script"], ["needle"], null), []);
    assert.deepEqual(processHits("sys_script", ["script"], ["needle"], {}), []);
    assert.deepEqual(processHits("sys_script", ["script"], ["needle"], { _results: [] }), []);
    assert.deepEqual(
      processHits("sys_script", ["script"], ["needle"], {
        _results: [
          {
            sys_id: { value: "nope" },
            sys_name: { value: "Nope" },
            script: { value: 'gs.info("other");' },
          },
        ],
      }),
      [],
    );
  });

  it("leaves its inputs unchanged", () => {
    const tableData = {
      _results: [
        {
          sys_id: { value: "immut" },
          sys_name: { value: "Immutable" },
          script: { value: "needle" },
        },
      ],
    };
    const words = ["needle"];
    const fields = ["script"];
    const dataBefore = structuredClone(tableData);
    const wordsBefore = structuredClone(words);
    const fieldsBefore = structuredClone(fields);

    processHits("sys_script", fields, words, tableData);

    assert.deepEqual(tableData, dataBefore);
    assert.deepEqual(words, wordsBefore);
    assert.deepEqual(fields, fieldsBefore);
  });
});

describe("search-core buildGraphqlQuery", () => {
  it("builds a GlideRecord_Query document for one named Artifact", () => {
    assert.equal(
      buildGraphqlQuery("sys_script", "scriptLIKEgs.info", ["script"], 50),
      'query { GlideRecord_Query { sys_script(queryConditions: "scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });

  it("builds one document covering several Artifacts", () => {
    assert.equal(
      buildGraphqlBatchQuery([
        {
          table: "sys_script",
          encodedQuery: "scriptLIKEgs.info",
          fields: ["script"],
          limit: 50,
        },
        {
          table: "sys_script_include",
          encodedQuery: "scriptLIKEgs.info",
          fields: ["script"],
          limit: 50,
        },
      ]),
      'query { GlideRecord_Query { sys_script(queryConditions: "scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } sys_script_include(queryConditions: "scriptLIKEgs.info", pagination: { limit: 50 }, omitCount: false) { _rowCount _results { sys_id { value } sys_name { value displayValue } sys_class_name { value } script { value displayValue } } } } }',
    );
  });
});

describe("search-core discoverArtifacts", () => {
  it("groups code-bearing Dictionary rows into Artifacts by Table", () => {
    assert.deepEqual(
      discoverArtifacts(
        dictionaryPayload([
          {
            name: { value: "u_custom", display_value: "u_custom" },
            element: { value: "script", display_value: "script" },
            column_label: { value: "Script", display_value: "Script" },
            internal_type: { value: "script", display_value: "Script" },
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
            internal_type: { value: "boolean", display_value: "Boolean" },
          },
        ]),
      ),
      [
        {
          table: "sys_script",
          fields: ["script", "condition"],
          hasActive: true,
        },
        { table: "u_custom", fields: ["script"], hasActive: false },
      ],
    );
  });

  it("selects active rows in a separate ^NQ clause so internal_typeIN cannot exclude them", () => {
    assert.match(codeFieldDictionaryQuery(), /\^NQelement=active/);
  });
});

describe("search-core chunk", () => {
  it(`splits Artifacts into documents of ${ARTIFACTS_PER_DOCUMENT}`, () => {
    const artifacts = Array.from({ length: 25 }, (_, i) => ({
      table: `t${i}`,
      fields: ["script"],
      hasActive: false,
    }));
    const batches = chunk(artifacts, ARTIFACTS_PER_DOCUMENT);
    assert.equal(batches.length, 3);
    assert.equal(batches[0]?.length, 10);
    assert.equal(batches[1]?.length, 10);
    assert.equal(batches[2]?.length, 5);
  });
});

describe("search-core readDictionary", () => {
  it("pre-ticks every curated code field type", () => {
    const rows = [{ element: "", column_label: "Example", internal_type: "" }].concat(
      CODE_FIELD_TYPES.map((type) => ({
        element: `field_${type}`,
        column_label: type,
        internal_type: type,
      })),
    );
    const read = readDictionary(dictionaryPayload(rows), "example");
    assert.equal(read.label, "Example");
    assert.equal(read.fields.length, CODE_FIELD_TYPES.length);
    for (const field of read.fields) {
      assert.equal(field.selected, true);
      assert.equal(field.declaredOn, "example");
      assert.ok(CODE_FIELD_TYPES.some((type) => type === field.type));
    }
  });

  it("offers plain string fields unticked", () => {
    const read = readDictionary(
      dictionaryPayload([
        { element: "", column_label: "Example", internal_type: "" },
        { element: "script", column_label: "Script", internal_type: "script" },
        {
          element: "description",
          column_label: "Description",
          internal_type: "string",
        },
      ]),
      "example",
    );
    assert.deepEqual(read.fields, [
      {
        element: "script",
        type: "script",
        label: "Script",
        selected: true,
        declaredOn: "example",
      },
      {
        element: "description",
        type: "string",
        label: "Description",
        selected: false,
        declaredOn: "example",
      },
    ]);
  });

  it("omits references, sys_ids, dates, numbers, booleans and choices", () => {
    const read = readDictionary(
      dictionaryPayload([
        { element: "", column_label: "Example", internal_type: "" },
        { element: "script", column_label: "Script", internal_type: "script" },
        {
          element: "parent",
          column_label: "Parent",
          internal_type: "reference",
        },
        { element: "sys_id", column_label: "Sys ID", internal_type: "GUID" },
        {
          element: "opened_at",
          column_label: "Opened",
          internal_type: "glide_date_time",
        },
        { element: "count", column_label: "Count", internal_type: "integer" },
        { element: "active", column_label: "Active", internal_type: "boolean" },
        { element: "state", column_label: "State", internal_type: "choice" },
      ]),
      "example",
    );
    assert.deepEqual(
      read.fields.map((field) => field.element),
      ["script"],
    );
    assert.equal(read.hasActive, true);
  });

  it("reports hasActive when the table or an ancestor declares active", () => {
    assert.equal(
      readDictionary(
        dictionaryPayload([
          { element: "", column_label: "No Active", internal_type: "" },
          {
            element: "script",
            column_label: "Script",
            internal_type: "script",
          },
        ]),
        "example",
      ).hasActive,
      false,
    );
    assert.equal(
      readDictionary(
        dictionaryPayload([
          { element: "", column_label: "With Active", internal_type: "" },
          {
            element: "active",
            column_label: "Active",
            internal_type: "boolean",
          },
          {
            element: "script",
            column_label: "Script",
            internal_type: "script",
          },
        ]),
        "example",
      ).hasActive,
      true,
    );
    assert.equal(
      readDictionary(
        dictionaryPayload([
          {
            name: "child",
            element: "",
            column_label: "Child",
            internal_type: "",
          },
          {
            name: "child",
            element: "notes",
            column_label: "Notes",
            internal_type: "string",
          },
          {
            name: "parent",
            element: "active",
            column_label: "Active",
            internal_type: "boolean",
          },
          {
            name: "parent",
            element: "script",
            column_label: "Script",
            internal_type: "script",
          },
        ]),
        "child",
      ).hasActive,
      true,
    );
  });

  it("returns an empty field list when nothing is offerable", () => {
    const read = readDictionary(
      dictionaryPayload([
        { element: "", column_label: "Numbers Only", internal_type: "" },
        { element: "count", column_label: "Count", internal_type: "integer" },
        { element: "flag", column_label: "Flag", internal_type: "boolean" },
      ]),
      "numbers_only",
    );
    assert.equal(read.label, "Numbers Only");
    assert.deepEqual(read.fields, []);
    assert.equal(read.hasActive, false);
    assert.equal(read.found, true);
  });

  it("reports found false when the dictionary has no rows", () => {
    assert.deepEqual(readDictionary(dictionaryPayload([]), "missing"), {
      label: "",
      fields: [],
      hasActive: false,
      found: false,
    });
    assert.equal(readDictionary(null, "missing").found, false);
    assert.equal(readDictionary(undefined, "missing").found, false);
  });

  it("reads Table API display_value objects", () => {
    const read = readDictionary(
      dictionaryPayload([
        {
          element: { value: "", display_value: "" },
          column_label: { value: "Store Table", display_value: "Store Table" },
          internal_type: { value: "", display_value: "" },
        },
        {
          element: { value: "script", display_value: "script" },
          column_label: { value: "Script", display_value: "Script" },
          internal_type: { value: "script", display_value: "Script" },
        },
      ]),
      "u_store_table",
    );
    assert.deepEqual(read, {
      label: "Store Table",
      fields: [
        {
          element: "script",
          type: "script",
          label: "Script",
          selected: true,
          declaredOn: "u_store_table",
        },
      ],
      hasActive: false,
      found: true,
    });
  });

  it("does not stringify array-valued Dictionary cells", () => {
    const read = readDictionary(
      dictionaryPayload([
        {
          element: ["script"],
          column_label: ["Script"],
          internal_type: ["script"],
        },
      ]),
      "example",
    );

    assert.deepEqual(read.fields, []);
    assert.equal(read.label, "example");
    assert.equal(read.found, true);
  });

  it("offers inherited fields and annotates where they were declared", () => {
    const read = readDictionary(
      dictionaryPayload([
        {
          name: "sn_grc_indicator_template",
          element: "",
          column_label: "Indicator Template",
          internal_type: "",
        },
        {
          name: "sn_grc_base_indicator",
          element: "",
          column_label: "Base Indicator",
          internal_type: "",
        },
        {
          name: "sn_grc_base_indicator",
          element: "script",
          column_label: "Script",
          internal_type: "script",
        },
        {
          name: "sn_grc_indicator_template",
          element: "description",
          column_label: "Description",
          internal_type: "string",
        },
      ]),
      "sn_grc_indicator_template",
    );
    assert.equal(read.label, "Indicator Template");
    assert.deepEqual(read.fields, [
      {
        element: "description",
        type: "string",
        label: "Description",
        selected: false,
        declaredOn: "sn_grc_indicator_template",
      },
      {
        element: "script",
        type: "script",
        label: "Script",
        selected: true,
        declaredOn: "sn_grc_base_indicator",
      },
    ]);
  });

  it("prefers the subject table declaration when an element is overridden", () => {
    const read = readDictionary(
      dictionaryPayload([
        {
          name: "child",
          element: "",
          column_label: "Child",
          internal_type: "",
        },
        {
          name: "parent",
          element: "script",
          column_label: "Parent Script",
          internal_type: "string",
        },
        {
          name: "child",
          element: "script",
          column_label: "Child Script",
          internal_type: "script",
        },
      ]),
      "child",
    );
    assert.deepEqual(read.fields, [
      {
        element: "script",
        type: "script",
        label: "Child Script",
        selected: true,
        declaredOn: "child",
      },
    ]);
  });

  it("ignores ancestor label rows and falls back to the subject name", () => {
    const read = readDictionary(
      dictionaryPayload([
        {
          name: "parent",
          element: "",
          column_label: "Parent Label",
          internal_type: "",
        },
        {
          name: "parent",
          element: "script",
          column_label: "Script",
          internal_type: "script",
        },
      ]),
      "child",
    );
    assert.equal(read.label, "child");
    assert.deepEqual(read.fields, [
      {
        element: "script",
        type: "script",
        label: "Script",
        selected: true,
        declaredOn: "parent",
      },
    ]);
  });
});

describe("search-core readQueryErrors", () => {
  it("returns [] when errors is not an array", () => {
    assert.deepEqual(readQueryErrors({}, ["sys_script"]), []);
    assert.deepEqual(readQueryErrors({ errors: null }, ["sys_script"]), []);
    assert.deepEqual(readQueryErrors({ errors: "boom" }, ["sys_script"]), []);
  });

  it("attributes an error to the first path step that is a searched Artifact", () => {
    assert.deepEqual(
      readQueryErrors(
        {
          errors: [
            {
              message: " Field unknown ",
              path: ["GlideRecord_Query", "sys_script", "_results", 0],
            },
          ],
        },
        ["sys_script", "sys_script_include"],
      ),
      [{ tableName: "sys_script", message: "Field unknown" }],
    );
  });

  it("keeps an error that names no searched Artifact unattributed", () => {
    assert.deepEqual(
      readQueryErrors(
        {
          errors: [
            {
              message: "Validation failed",
              path: ["GlideRecord_Query", "not_in_batch"],
            },
          ],
        },
        ["sys_script"],
      ),
      [{ tableName: "", message: "Validation failed" }],
    );
  });

  it("keeps malformed entries as Unspecified GraphQL error", () => {
    assert.deepEqual(
      readQueryErrors({ errors: [{}, { message: "   " }, "bare", null] }, ["sys_script"]),
      [
        { tableName: "", message: "Unspecified GraphQL error" },
        { tableName: "", message: "Unspecified GraphQL error" },
        { tableName: "", message: "Unspecified GraphQL error" },
        { tableName: "", message: "Unspecified GraphQL error" },
      ],
    );
  });
});

describe("search-core hasArtifactData / batchWasRejected", () => {
  it("treats a present table object as data even with empty _results", () => {
    const glide = { sys_script: { _results: [] } };
    assert.equal(hasArtifactData(glide, "sys_script"), true);
    assert.equal(hasArtifactData(glide, "u_missing"), false);
  });

  it("detects a rejected batch when no Artifact has data", () => {
    assert.equal(
      batchWasRejected({ data: { GlideRecord_Query: {} } }, ["sys_script", "u_custom"]),
      true,
    );
    assert.equal(
      batchWasRejected(
        {
          data: {
            GlideRecord_Query: {
              sys_script: { _results: [] },
            },
          },
        },
        ["sys_script", "u_custom"],
      ),
      false,
    );
  });
});
