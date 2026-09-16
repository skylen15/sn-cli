import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { AliasInventory } from "#src/servicenow/auth.ts";

const use = Command.make(
  "use",
  {
    alias: Argument.string("alias").pipe(
      Argument.withDescription("The name of the Now SDK OAuth Alias to designate as default"),
    ),
  },
  Effect.fn("auth.use")(function* ({ alias }) {
    const inventory = yield* AliasInventory;
    const result = yield* inventory.use(alias);
    yield* emitJson(result);
  }),
).pipe(Command.withDescription("Set an existing allowed Now SDK OAuth Alias as the default"));

export { use };
