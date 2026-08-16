import { Effect } from "effect";

import { SnClient } from "./client.ts";
import type { SnAuthError, SnRequestError } from "./errors.ts";

/** One Table API list row (`sysparm_fields` → string values). */
export type TableRow = Record<string, string>;

/** Pull `result` from a Table API list body; missing/null → []. */
export const tableRows = (data: unknown): TableRow[] => {
  // SAFETY: Table API list responses are `{ result: Row[] }`; we only read `.result`.
  return (data as { result?: TableRow[] } | null)?.result ?? [];
};

/**
 * Walk `sys_db_object.super_class` from `table` up to the root, returning
 * `[table, parent, grandparent, ...]`. Inherited Dictionary columns and config
 * records live on parent tables, so parents must be named when querying them.
 *
 * ponytail: one round trip per level (O(depth)). Depth is tiny in practice
 * (incident → task → root). Upgrade path: a single recursive `sys_db_object`
 * query if a deep hierarchy ever makes this hurt. The depth cap guards against
 * a malformed self-referential `super_class`.
 */
export const inheritanceChain = Effect.fn("inheritanceChain")(function* (
  table: string,
): Effect.fn.Return<string[], SnRequestError | SnAuthError, SnClient> {
  const client = yield* SnClient;
  const chain: string[] = [];
  let current: string | undefined = table;
  for (let depth = 0; current && depth < 50; depth++) {
    if (chain.includes(current)) {
      break;
    }
    chain.push(current);
    const rows = tableRows(
      yield* client.request("/api/now/table/sys_db_object", {
        sysparm_query: `name=${current}`,
        sysparm_fields: "name,super_class.name",
        sysparm_limit: "1",
      }),
    );
    current = rows[0]?.["super_class.name"] || undefined;
  }
  return chain;
});
