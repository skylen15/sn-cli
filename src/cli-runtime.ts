import { NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer, Logger, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import pkg from "#package.json" with { type: "json" };
import { emitLive } from "#src/emit.ts";
import { snClientLive } from "#src/servicenow/client.ts";
import { isSnError, snErrorJson } from "#src/servicenow/errors.ts";

/** Apply the shared live services and error-output contract to a command tree. */
export const makeCliProgram = Effect.fn("makeCliProgram")(function* <
  const Name extends string,
  Input,
  ContextInput,
  E,
  R,
>(command: Command.Command<Name, Input, ContextInput, E, R>) {
  return yield* command.pipe(
    Command.provide(Layer.merge(snClientLive, emitLive)),
    Command.run({ version: pkg.version }),
    Effect.tapError((error) =>
      isSnError(error) ? Console.error(snErrorJson(error)) : Effect.void,
    ),
    // Effect's default logger writes to stdout and runMain's error report goes
    // through it, so an unhandled defect would otherwise land in the data
    // stream. Render only reported causes here while each entrypoint disables
    // runMain's built-in report.
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause) || !Runtime.getErrorReported(Cause.squash(cause))
        ? Effect.void
        : Console.error(Cause.pretty(cause)),
    ),
    Effect.provide(NodeServices.layer),
    Effect.provideService(Logger.LogToStderr, true),
  );
});
