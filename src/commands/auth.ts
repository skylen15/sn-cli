import { Command } from "effect/unstable/cli";

import { add } from "#src/commands/auth/add.ts";
import { list } from "#src/commands/auth/list.ts";
import { remove } from "#src/commands/auth/remove.ts";
import { use } from "#src/commands/auth/use.ts";
import { aliasInventoryLayer } from "#src/servicenow/auth.ts";

/** Authentication group for managing local Now SDK Aliases. */
export const auth = Command.make("auth").pipe(
  Command.withDescription(
    "Inspect and manage global Now SDK OAuth Aliases stored in this machine's keychain",
  ),
  Command.withSubcommands([list, add, use, remove]),
);

/** Authentication group backed by the live Now SDK keychain adapter. */
export const authLive = auth.pipe(Command.provide(aliasInventoryLayer));
