import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { sn } from "#src/root.ts";
import { emitJson } from "#src/emit.ts";
import { AliasFlag } from "#src/servicenow/auth.ts";
import { SnClient } from "#src/servicenow/client.ts";
import {
  SnBatchFailedError,
  SnBatchPartialError,
} from "#src/servicenow/errors.ts";

type ItemStatus = { sys_id: string; ok: boolean; error?: string };

// `delete` is a reserved word; leaf CLI name is still "delete".
const delete_ = Command.make(
  "delete",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table holding the Records"),
    ),
    sys_ids: Argument.string("sys_id").pipe(
      Argument.variadic({ min: 1 }),
      Argument.withDescription(
        "Explicit list of sys_ids to delete (by-list, never by-query)",
      ),
    ),
  },
  Effect.fn("batch.delete")(function* ({ table, sys_ids }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    // ADR 0002: per-item outcome capture is the sanctioned exception to
    // fail-the-command — continue-on-error status is the command's whole value.
    // Bad input still fails (CLI parse) before we get here.
    // ponytail: O(n) sequential round trips (one DELETE per item). Ceiling:
    // large lists are slow. Upgrade path: the native Batch API
    // (/api/now/v1/batch) in one round trip.
    const results: ItemStatus[] = [];
    for (const sys_id of sys_ids) {
      const status = yield* client
        .request(
          `/api/now/table/${encodeURIComponent(table)}/${encodeURIComponent(sys_id)}`,
          undefined,
          { method: "DELETE" },
        )
        .pipe(
          Effect.provideService(AliasFlag, alias),
          Effect.as({ sys_id, ok: true } satisfies ItemStatus),
          Effect.catchTag(
            "SnRequestError",
            (error): Effect.Effect<ItemStatus> =>
              Effect.succeed({
                sys_id,
                ok: false,
                error: error.message,
              }),
          ),
        );
      results.push(status);
    }
    yield* emitJson(results);
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0) {
      return;
    }
    if (failed === results.length) {
      return yield* new SnBatchFailedError({
        message: `All ${failed} deletes failed`,
        failed,
        total: results.length,
      });
    }
    return yield* new SnBatchPartialError({
      message: `${failed} of ${results.length} deletes failed`,
      failed,
      total: results.length,
    });
  }),
).pipe(
  Command.withDescription(
    "DELETE each sys_id in an explicit list; continues past per-item failures and returns a per-item status array",
  ),
);

export { delete_ };
