import { Effect, flow, Schema } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { sn } from "#src/root.ts";
import { withAuth } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import { SnRequestError } from "#src/servicenow/errors.ts";
import { inheritanceChain, parseTableRows } from "#src/servicenow/inheritance.ts";

const DictionaryRow = Schema.Struct({
  name: Schema.String,
  element: Schema.String,
  "internal_type.name": Schema.String,
  column_label: Schema.String,
  mandatory: Schema.String,
  max_length: Schema.String,
  default_value: Schema.String,
  "reference.name": Schema.optionalKey(Schema.String),
});

const ChoiceRow = Schema.Struct({
  name: Schema.String,
  element: Schema.String,
  label: Schema.String,
  value: Schema.String,
});

const malformedTableResponse = () =>
  new SnRequestError({
    message: "Malformed ServiceNow Table API response",
  });

const parseDictionaryRows = flow(
  Schema.decodeUnknownEffect(Schema.Array(DictionaryRow)),
  Effect.mapError(malformedTableResponse),
);

const parseChoiceRows = flow(
  Schema.decodeUnknownEffect(Schema.Array(ChoiceRow)),
  Effect.mapError(malformedTableResponse),
);

type SchemaChoice = {
  readonly label: string;
  readonly value: string;
};

type SchemaColumn = {
  readonly name: string;
  readonly type: string;
  readonly label: string;
  readonly mandatory: boolean;
  readonly max_length: string;
  readonly default_value: string;
  readonly source_table: string;
  reference?: string;
  choices?: ReadonlyArray<SchemaChoice>;
};

const schema = Command.make(
  "schema",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table whose schema to discover"),
    ),
  },
  Effect.fn("schema")(function* ({ table }) {
    const { alias, yes } = yield* sn;
    const client = yield* SnClient;
    const withAuthContext = withAuth({ alias, yes });

    const runSchema = Effect.gen(function* () {
      const chain = yield* inheritanceChain(table);
      const tablesIn = chain.join(",");

      // Raw mode (default display_value): default_value and mandatory come back
      // as stored, so a caller can reuse them to build a valid create payload.
      // Dot-walked: internal_type.name -> type id; reference.name -> target table;
      // name -> originating table (source_table) for inheritance attribution.
      const dictRows = yield* parseDictionaryRows(
        yield* parseTableRows(
          yield* client.request("/api/now/table/sys_dictionary", {
            sysparm_query: `nameIN${tablesIn}^elementISNOTEMPTY`,
            sysparm_fields:
              "name,element,internal_type.name,column_label,mandatory,max_length,default_value,reference.name",
            sysparm_limit: "10000",
          }),
        ),
      );

      // ponytail: one sys_choice query for the whole chain, then group in memory.
      // Ceiling: a table with very large choice lists returns many rows in a
      // single response. Upgrade path: paginate or scope to choice-typed
      // elements if the payload ever gets too big.
      const choiceRows = yield* parseChoiceRows(
        yield* parseTableRows(
          yield* client.request("/api/now/table/sys_choice", {
            sysparm_query: `nameIN${tablesIn}^ORDERBYsequence`,
            sysparm_fields: "name,element,label,value",
            sysparm_limit: "10000",
          }),
        ),
      );
      // Key by originating table + element so a child override of the same
      // element name does not merge onto the parent's column (or vice versa).
      const choicesByTableElement = new Map<string, SchemaChoice[]>();
      for (const c of choiceRows) {
        const key = `${c.name}.${c.element}`;
        const list = choicesByTableElement.get(key) ?? [];
        list.push({ label: c.label, value: c.value });
        choicesByTableElement.set(key, list);
      }

      const columns = dictRows.map((r) => {
        const choiceKey = `${r.name}.${r.element}`;
        const column: SchemaColumn = {
          name: r.element,
          type: r["internal_type.name"],
          label: r.column_label,
          mandatory: r.mandatory === "true",
          max_length: r.max_length,
          default_value: r.default_value,
          source_table: r.name,
        };
        if (r["reference.name"]) {
          column.reference = r["reference.name"];
        }
        const choices = choicesByTableElement.get(choiceKey);
        if (choices !== undefined) {
          column.choices = choices;
        }
        return column;
      });

      yield* emitJson({ table, columns });
    });

    yield* withAuthContext(runSchema);
  }),
).pipe(
  Command.withDescription(
    "Discover a table's Dictionary columns, including inherited ones, with Reference targets and Choice lists",
  ),
);

export { schema };
