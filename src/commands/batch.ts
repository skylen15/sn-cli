import { Command } from "effect/unstable/cli";

import { delete_ } from "#src/commands/batch/delete.ts";
import { update } from "#src/commands/batch/update.ts";

/** Batch group: by-list update and delete with per-item status. */
export const batch = Command.make("batch").pipe(
  Command.withDescription(
    "Update or delete Records by an explicit list, with per-item status",
  ),
  Command.withSubcommands([update, delete_]),
);
