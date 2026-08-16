import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";

// `delete` is a reserved word; leaf CLI name is still "delete".
const delete_ = Command.make(
  "delete",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table holding the Record"),
    ),
    sys_id: Argument.string("sys_id").pipe(
      Argument.withDescription("The sys_id of the Record to delete"),
    ),
  },
  Effect.fn("delete")(function* ({ table, sys_id }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    // ServiceNow returns 204 No Content; confirm so stdout isn't empty.
    yield* client
      .request(
        `/api/now/table/${encodeURIComponent(table)}/${encodeURIComponent(sys_id)}`,
        undefined,
        { method: "DELETE" },
      )
      .pipe(Effect.provideService(AliasFlag, alias));
    yield* emitJson({ sys_id, deleted: true });
  }),
).pipe(
  Command.withDescription(
    "Delete a single Record by sys_id; confirms with { sys_id, deleted: true }",
  ),
);

export { delete_ };
