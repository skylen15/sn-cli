import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { AliasInventory } from "#src/servicenow/auth.ts";

const remove = Command.make(
  "remove",
  {
    alias: Argument.string("alias").pipe(
      Argument.withDescription("The name of the Now SDK Alias to remove"),
    ),
  },
  Effect.fn("auth.remove")(function* ({ alias }) {
    const inventory = yield* AliasInventory;
    const result = yield* inventory.remove(alias);
    yield* emitJson(result);
  }),
).pipe(Command.withDescription("Remove a Now SDK Alias from the local keychain"));

export { remove };
