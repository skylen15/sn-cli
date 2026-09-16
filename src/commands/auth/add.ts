import { Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";

import { emitJson } from "#src/emit.ts";
import { sn } from "#src/root.ts";
import { AliasInventory } from "#src/servicenow/auth.ts";
import { SnAuthError } from "#src/servicenow/errors.ts";

const add = Command.make(
  "add",
  {
    instanceUrl: Argument.string("instance-url").pipe(
      Argument.withDescription("The HTTPS instance origin (e.g. https://dev12345.service-now.com)"),
    ),
  },
  Effect.fn("auth.add")(function* ({ instanceUrl }) {
    const { alias } = yield* sn;
    if (Option.isNone(alias) || alias.value.trim().length === 0) {
      return yield* new SnAuthError({
        message: "Alias name must not be empty. Specify a non-empty name with `--alias <name>`.",
        hint: "Run `sn auth add <https-origin> --alias <name>` with a non-empty Alias name.",
      });
    }

    const inventory = yield* AliasInventory;
    const result = yield* inventory.add({
      instanceUrl,
      alias: alias.value.trim(),
    });

    yield* emitJson(result);
  }),
).pipe(
  Command.withDescription(
    "Add a new Now SDK OAuth Alias for an instance using browser authentication",
  ),
);

export { add };
