import { Command } from "effect/unstable/cli";

import { create } from "#src/commands/record/create.ts";
import { delete_ } from "#src/commands/record/delete.ts";
import { update } from "#src/commands/record/update.ts";

/** Record group: single-Record create, update, and delete. */
export const record = Command.make("record").pipe(
  Command.withDescription("Create, update, or delete a single Record"),
  Command.withSubcommands([create, update, delete_]),
);
