import { Command } from "effect/unstable/cli";

import { config } from "#src/commands/table/config.ts";
import { query } from "#src/commands/table/query.ts";
import { schema } from "#src/commands/table/schema.ts";

/** Table group: row reads, Dictionary schema, and reconstructed configuration. */
export const table = Command.make("table").pipe(
  Command.withDescription(
    "Read a Table's rows, Dictionary schema, or reconstructed configuration. The always-on Instance Guard blocks production and UAT before network access.",
  ),
  Command.withSubcommands([query, schema, config]),
);
