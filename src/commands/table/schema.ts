import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import { inheritanceChain, tableRows } from "#src/servicenow/inheritance.ts";

const schema = Command.make(
  "schema",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table whose schema to discover"),
    ),
  },
  Effect.fn("schema")(function* ({ table }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    const withAlias = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(AliasFlag, alias));

    const chain = yield* withAlias(inheritanceChain(table));
    const tablesIn = chain.join(",");

    // Raw mode (default display_value): default_value and mandatory come back
    // as stored, so a caller can reuse them to build a valid create payload.
    // Dot-walked: internal_type.name -> type id; reference.name -> target table;
    // name -> originating table (source_table) for inheritance attribution.
    const dictRows = tableRows(
      yield* withAlias(
        client.request("/api/now/table/sys_dictionary", {
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
    const choiceRows = tableRows(
      yield* withAlias(
        client.request("/api/now/table/sys_choice", {
          sysparm_query: `nameIN${tablesIn}^ORDERBYsequence`,
          sysparm_fields: "name,element,label,value",
          sysparm_limit: "10000",
        }),
      ),
    );
    // Key by originating table + element so a child override of the same
    // element name does not merge onto the parent's column (or vice versa).
    const choicesByTableElement = new Map<
      string,
      { label: string; value: string }[]
    >();
    for (const c of choiceRows) {
      const key = `${c.name}.${c.element}`;
      const list = choicesByTableElement.get(key) ?? [];
      list.push({ label: c.label, value: c.value });
      choicesByTableElement.set(key, list);
    }

    const columns = dictRows.map((r) => {
      const choiceKey = `${r.name}.${r.element}`;
      return {
        name: r.element,
        type: r["internal_type.name"],
        label: r.column_label,
        mandatory: r.mandatory === "true",
        max_length: r.max_length,
        default_value: r.default_value,
        source_table: r.name,
        ...(r["reference.name"] ? { reference: r["reference.name"] } : {}),
        ...(choicesByTableElement.has(choiceKey)
          ? { choices: choicesByTableElement.get(choiceKey) }
          : {}),
      };
    });

    yield* emitJson({ table, columns });
  }),
).pipe(
  Command.withDescription(
    "Discover a table's Dictionary columns, including inherited ones, with Reference targets and Choice lists",
  ),
);

export { schema };
