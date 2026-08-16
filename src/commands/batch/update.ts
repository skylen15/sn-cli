import { Effect, Schema } from "effect";
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

const BatchItem = Schema.Struct({
  sys_id: Schema.NonEmptyString,
  fields: Schema.Record(Schema.String, Schema.Unknown),
});

const BatchItems = Schema.fromJsonString(Schema.NonEmptyArray(BatchItem));

const update = Command.make(
  "update",
  {
    table: Argument.string("table").pipe(
      Argument.withDescription("The table holding the Records"),
    ),
    items: Argument.string("items").pipe(
      Argument.withSchema(BatchItems),
      Argument.withDescription(
        'JSON array of { "sys_id", "fields" } (by-list, never by-query)',
      ),
    ),
  },
  Effect.fn("batch.update")(function* ({ table, items }) {
    const { alias } = yield* sn;
    const client = yield* SnClient;
    // ADR 0002: per-item outcome capture is the sanctioned exception to
    // fail-the-command — continue-on-error status is the command's whole value.
    // Bad input still fails (CLI parse / Schema) before we get here.
    // ponytail: O(n) sequential round trips (one PATCH per item). Ceiling:
    // large lists are slow. Upgrade path: the native Batch API
    // (/api/now/v1/batch) in one round trip.
    const results: ItemStatus[] = [];
    for (const { sys_id, fields } of items) {
      const status = yield* client
        .request(
          `/api/now/table/${encodeURIComponent(table)}/${encodeURIComponent(sys_id)}`,
          undefined,
          { method: "PATCH", body: fields },
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
        message: `All ${failed} updates failed`,
        failed,
        total: results.length,
      });
    }
    return yield* new SnBatchPartialError({
      message: `${failed} of ${results.length} updates failed`,
      failed,
      total: results.length,
    });
  }),
).pipe(
  Command.withDescription(
    "PATCH each Record in an explicit JSON list of { sys_id, fields }; continues past per-item failures and returns a per-item status array",
  ),
);

export { update };
