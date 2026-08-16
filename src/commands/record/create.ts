import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";

const create = Command.make(
  "create",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table to create a Record in"),
    ),
    field: Flag.keyValuePair("field").pipe(
      Flag.withDescription(
        "Field name=value for the new Record (snake_case column name; repeatable)",
      ),
    ),
  },
  Effect.fn("create")(function* ({ table, field }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    const data = yield* client
      .request(`/api/now/table/${encodeURIComponent(table)}`, undefined, {
        method: "POST",
        body: field,
      })
      .pipe(Effect.provideService(AliasFlag, alias));
    yield* emitJson(data);
  }),
).pipe(
  Command.withDescription(
    "Create a single Record in a ServiceNow table by POSTing field values; returns the created Record uncoerced",
  ),
);

export { create };
