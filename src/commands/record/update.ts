import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";

const update = Command.make(
  "update",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table holding the Record"),
    ),
    sys_id: Argument.string("sys_id").pipe(
      Argument.withDescription("The sys_id of the Record to update"),
    ),
    field: Flag.keyValuePair("field").pipe(
      Flag.withDescription(
        "Field name=value to change (snake_case column name; repeatable)",
      ),
    ),
  },
  Effect.fn("update")(function* ({ table, sys_id, field }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    const data = yield* client
      .request(
        `/api/now/table/${encodeURIComponent(table)}/${encodeURIComponent(sys_id)}`,
        undefined,
        { method: "PATCH", body: field },
      )
      .pipe(Effect.provideService(AliasFlag, alias));
    yield* emitJson(data);
  }),
).pipe(
  Command.withDescription(
    "Partially update a single Record by sys_id with PATCH; returns the updated Record uncoerced",
  ),
);

export { update };
