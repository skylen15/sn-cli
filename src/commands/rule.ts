import { Command } from "effect/unstable/cli";

import { install } from "#src/commands/rule/install.ts";

/** Rule group: install shipped agent Rules into a Platform's on-disk layout. */
export const rule = Command.make("rule").pipe(
  Command.withDescription(
    "Install shipped Rules into a Platform's project rules directory (local filesystem only; outside the Instance Guard)",
  ),
  Command.withSubcommands([install]),
);
