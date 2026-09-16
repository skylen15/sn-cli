import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { sn } from "#src/root.ts";
import { withAuth } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";

const query = Command.make(
  "query",
  {
    table: Argument.string("table").pipe(Argument.withDescription("The table to query")),
    query: Flag.optional(
      Flag.string("query").pipe(
        Flag.withDescription(
          "Encoded Query filter (sysparm_query). Sort inside it with ORDERBY/ORDERBYDESC.",
        ),
      ),
    ),
    fields: Flag.optional(
      Flag.string("fields").pipe(Flag.withDescription("Comma-separated fields to return")),
    ),
    limit: Flag.integer("limit").pipe(
      Flag.withDefault(20),
      Flag.withDescription("Maximum number of records to return"),
    ),
    offset: Flag.optional(
      Flag.integer("offset").pipe(
        Flag.withDescription(
          "Number of records to skip (sysparm_offset), for paging past the limit",
        ),
      ),
    ),
    displayValue: Flag.optional(Flag.choice("display-value", ["false", "true", "all"])),
    excludeReferenceLink: Flag.optional(
      Flag.boolean("exclude-reference-link").pipe(
        Flag.withDescription("When set, drops the reference link object from Reference fields"),
      ),
    ),
    // Escape hatch: --sysparm name=value (name is the full sysparm_* key).
    sysparm: Flag.optional(
      Flag.keyValuePair("sysparm").pipe(
        Flag.withDescription(
          "Verbatim Table API query param as name=value (e.g. sysparm_suppress_pagination_header=true)",
        ),
      ),
    ),
  },
  Effect.fn("query")(function* ({
    table,
    query,
    fields,
    limit,
    offset,
    displayValue,
    excludeReferenceLink,
    sysparm,
  }) {
    const params: Record<string, string> = {};
    params.sysparm_limit = String(limit);
    if (Option.isSome(query)) {
      params.sysparm_query = query.value;
    }
    if (Option.isSome(fields)) {
      params.sysparm_fields = fields.value;
    }
    if (Option.isSome(displayValue)) {
      params.sysparm_display_value = displayValue.value;
    }
    if (Option.isSome(excludeReferenceLink)) {
      params.sysparm_exclude_reference_link = String(excludeReferenceLink.value);
    }
    if (Option.isSome(offset)) {
      params.sysparm_offset = String(offset.value);
    }
    if (Option.isSome(sysparm)) {
      Object.assign(params, sysparm.value);
    }

    const { alias, yes } = yield* sn;
    const withAuthContext = withAuth({ alias, yes });

    const runQuery = Effect.gen(function* () {
      const client = yield* SnClient;
      const data = yield* client.request(`/api/now/table/${encodeURIComponent(table)}`, params);
      yield* emitJson(data);
    });

    yield* withAuthContext(runQuery);
  }),
).pipe(
  Command.withDescription(
    "Read records from a ServiceNow table with an Encoded Query, field list, paging, and Display Value mode",
  ),
);

export { query };
