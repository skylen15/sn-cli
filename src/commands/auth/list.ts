import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { AliasInventory } from "#src/servicenow/auth.ts";

const list = Command.make(
  "list",
  {},
  Effect.fn("auth.list")(function* () {
    const inventory = yield* AliasInventory;
    yield* emitJson(yield* inventory.list());
  }),
).pipe(Command.withDescription("List local Now SDK Aliases without exposing credential material"));

export { list };
