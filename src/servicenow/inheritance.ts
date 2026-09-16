import { Effect, Schema } from "effect";

import { SnClient } from "./client.ts";
import { SnAuthError, SnGuardError, SnRequestError } from "./errors.ts";

/** Complete JSON row before endpoint-specific parsing or scalar projection. */
export const JsonTableRow = Schema.Record(Schema.String, Schema.Json);
export type JsonTableRow = typeof JsonTableRow.Type;

const TableRowsResponse = Schema.Struct({
  result: Schema.optionalKey(Schema.NullOr(Schema.Array(JsonTableRow))),
});

const malformedTableResponse = () =>
  new SnRequestError({
    message: "Malformed ServiceNow Table API response",
  });

/** Parse `result` from a Table API list body; missing/null → []. */
export const parseTableRows = Effect.fn("parseTableRows")(function* (
  data: Schema.Json,
): Effect.fn.Return<ReadonlyArray<JsonTableRow>, SnRequestError> {
  const response = yield* Schema.decodeUnknownEffect(TableRowsResponse)(data).pipe(
    Effect.mapError(malformedTableResponse),
  );
  return response.result ?? [];
});

const InheritanceRow = Schema.Struct({
  name: Schema.String,
  "super_class.name": Schema.optionalKey(Schema.String),
});

/**
 * Walk `sys_db_object.super_class` from `table` up to the root, returning
 * `[table, parent, grandparent, ...]`. Inherited Dictionary columns and config
 * records live on parent tables, so parents must be named when querying them.
 *
 * Missing `sys_db_object` rows fail (fail-closed for Guard Ext) rather than
 * treating an unknown name as a root Table.
 *
 * ponytail: one round trip per level (O(depth)). Depth is tiny in practice
 * (incident → task → root). Upgrade path: a single recursive `sys_db_object`
 * query if a deep hierarchy ever makes this hurt. The depth cap guards against
 * a malformed self-referential `super_class`.
 */
export const inheritanceChain = Effect.fn("inheritanceChain")(function* (
  table: string,
): Effect.fn.Return<string[], SnRequestError | SnAuthError | SnGuardError, SnClient> {
  const client = yield* SnClient;
  const chain: string[] = [];
  let current: string | undefined = table;
  for (let depth = 0; current && depth < 50; depth++) {
    if (chain.includes(current)) {
      break;
    }
    const rows: ReadonlyArray<JsonTableRow> = yield* parseTableRows(
      yield* client.request("/api/now/table/sys_db_object", {
        sysparm_query: `name=${current}`,
        sysparm_fields: "name,super_class.name",
        sysparm_limit: "1",
      }),
    );
    if (rows.length === 0) {
      return yield* new SnRequestError({
        message: `Inheritance unresolved for table: ${table}`,
        status: 404,
      });
    }
    chain.push(current);
    const row: typeof InheritanceRow.Type = yield* Schema.decodeUnknownEffect(InheritanceRow)(
      rows[0],
    ).pipe(Effect.mapError(malformedTableResponse));
    current = row["super_class.name"] || undefined;
  }
  return chain;
});
