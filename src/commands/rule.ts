import { Command } from "effect/unstable/cli";

import { install } from "#src/commands/rule/install.ts";

/** Rule group: install local agent instructions without contacting ServiceNow. */
export const rule = Command.make("rule").pipe(
  Command.withDescription(
    "Install sn agent instructions for Cursor, General, or Claude",
  ),
  Command.withSubcommands([install]),
);
