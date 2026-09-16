import { Command } from "effect/unstable/cli";

import { search } from "#src/commands/script/search.ts";

/** Read-only Script group: search Script Records. */
export const script = Command.make("script").pipe(
  Command.withDescription(
    "Search Script Records for a code snippet. The always-on Instance Guard blocks production and UAT before network access.",
  ),
  Command.withSubcommands([search]),
);
