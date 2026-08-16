import { Command } from "effect/unstable/cli";

import { run } from "#src/commands/script/run.ts";
import { search } from "#src/commands/script/search.ts";

/** Script group: run a Background Script, or search Script Records. */
export const script = Command.make("script").pipe(
  Command.withDescription(
    "Run a Background Script, or search Script Records for a code snippet",
  ),
  Command.withSubcommands([run, search]),
);
