import { Effect, Predicate } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { sn } from "#src/root.ts";
import { withAuth } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import {
  inheritanceChain,
  parseTableRows,
  type JsonTableRow,
} from "#src/servicenow/inheritance.ts";

/**
 * One configurable behaviour category that targets a table. Each metadata
 * table references its target through a different column, so the link is
 * named per-category. `fields` are the high-signal columns plus script /
 * condition bodies.
 */
interface Category {
  id: string;
  table: string;
  /** Column whose value is the target table (query + source tag). */
  link: string;
  fields: string[];
  /** Override the default `<link>IN<chain>` query (ACLs key off name patterns). */
  buildQuery?: (chain: string[]) => string;
  /** Override how a row's source table is derived (ACL name = "table" or "table.field"). */
  sourceTable?: (row: JsonTableRow) => string;
}

const CATEGORIES: Category[] = [
  {
    id: "business_rules",
    table: "sys_script",
    link: "collection",
    fields: [
      "name",
      "active",
      "when",
      "order",
      "action_insert",
      "action_update",
      "action_delete",
      "action_query",
      "filter_condition",
      "condition",
      "script",
    ],
  },
  {
    id: "client_scripts",
    table: "sys_script_client",
    link: "table",
    fields: ["name", "active", "type", "ui_type", "field", "condition", "script"],
  },
  {
    id: "ui_policies",
    table: "sys_ui_policy",
    link: "table",
    fields: [
      "short_description",
      "active",
      "conditions",
      "on_load",
      "reverse_if_false",
      "run_scripts",
      "script_true",
      "script_false",
    ],
  },
  {
    id: "ui_actions",
    table: "sys_ui_action",
    link: "table",
    fields: ["name", "active", "action_name", "order", "client", "condition", "onclick", "script"],
  },
  {
    id: "acls",
    table: "sys_security_acl",
    link: "name",
    // Record ACLs are named "<table>"; field ACLs "<table>.<field>". Match
    // both for every table in the chain.
    buildQuery: (chain) => chain.map((t) => `name=${t}^ORnameSTARTSWITH${t}.`).join("^OR"),
    sourceTable: (row) => (Predicate.isString(row.name) ? (row.name.split(".")[0] ?? "") : ""),
    fields: ["name", "operation", "type", "active", "admin_overrides", "condition", "script"],
  },
  {
    id: "data_policies",
    table: "sys_data_policy2",
    link: "model_table",
    fields: [
      "short_description",
      "active",
      "conditions",
      "inherit",
      "apply_to_client",
      "reverse_if_false",
    ],
  },
  {
    id: "notifications",
    table: "sysevent_email_action",
    link: "collection",
    fields: ["name", "active", "event_name", "condition", "subject", "message", "message_html"],
  },
  {
    id: "workflows",
    table: "wf_workflow",
    link: "table",
    fields: ["name", "active", "description", "condition"],
    // ponytail: classic Workflow only. Flow Designer flows (sys_hub_flow) don't
    // store the target table on the flow — the trigger table lives in a related
    // record. Upgrade path: add a dedicated Flow Designer trigger lookup.
  },
];

// SAFETY: CATEGORIES is a non-empty const array; Flag.choice needs a
// non-empty tuple type that map() cannot prove.
const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [string, ...string[]];

const fetchCategory = Effect.fn("fetchCategory")(function* (cat: Category, chain: string[]) {
  const client = yield* SnClient;
  const query = cat.buildQuery ? cat.buildQuery(chain) : `${cat.link}IN${chain.join(",")}`;
  // ponytail: sysparm_limit 10000, one request per category. Ceiling: a table
  // with very many config records (or huge scripts) returns a large payload.
  // Levers: the `categories` filter and the table scope. Upgrade path: paginate.
  const rows = yield* parseTableRows(
    yield* client.request(`/api/now/table/${cat.table}`, {
      sysparm_query: query,
      sysparm_fields: [cat.link, ...cat.fields].join(","),
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
      sysparm_limit: "10000",
    }),
  );
  const records = rows.map((row) => {
    const linkedTable = row[cat.link];
    const source_table = cat.sourceTable
      ? cat.sourceTable(row)
      : Predicate.isString(linkedTable)
        ? linkedTable
        : undefined;
    const record = { ...row, source_table };
    return Object.fromEntries(
      Object.entries(record).filter(
        ([key, value]) =>
          value !== undefined && (cat.sourceTable !== undefined || key !== cat.link),
      ),
    );
  });
  return { count: records.length, records };
});

const config = Command.make(
  "config",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table whose configuration to reconstruct"),
    ),
    categories: Flag.choice("categories", CATEGORY_IDS).pipe(
      Flag.between(0, CATEGORY_IDS.length),
      Flag.withDescription(
        `Limit to these config categories (repeatable). Omit for all. One of: ${CATEGORY_IDS.join(", ")}.`,
      ),
    ),
  },
  Effect.fn("config")(function* ({ table, categories: selectedIds }) {
    const { alias, yes } = yield* sn;
    const withAuthContext = withAuth({ alias, yes });

    const runConfig = Effect.gen(function* () {
      const chain = yield* inheritanceChain(table);
      const selected =
        selectedIds.length > 0 ? CATEGORIES.filter((c) => selectedIds.includes(c.id)) : CATEGORIES;

      // Sequential: one category at a time keeps the stub-client story simple and
      // the payload size is the real lever (categories filter), not concurrency.
      const entries: Array<[string, Effect.Success<ReturnType<typeof fetchCategory>>]> = [];
      for (const cat of selected) {
        entries.push([cat.id, yield* fetchCategory(cat, chain)]);
      }

      yield* emitJson({
        table,
        chain,
        categories: Object.fromEntries(entries),
      });
    });

    yield* withAuthContext(runConfig);
  }),
).pipe(
  Command.withDescription(
    "Reconstruct everything configured on a table across its inheritance chain — business rules, client scripts, UI policies/actions, ACLs, data policies, notifications, and classic workflows",
  ),
);

export { config };
