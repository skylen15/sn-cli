#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Console, Effect, Layer, Logger, Runtime } from "effect";
import { Command } from "effect/unstable/cli";

import pkg from "#package.json" with { type: "json" };
import { batch } from "#src/commands/batch.ts";
import { record } from "#src/commands/record.ts";
import { rule } from "#src/commands/rule.ts";
import { script } from "#src/commands/script.ts";
import { table } from "#src/commands/table.ts";
import { emitLive } from "#src/emit.ts";
import { sn as snRoot } from "#src/root.ts";
import { snClientLive } from "#src/servicenow/client.ts";
import { isSnError, snErrorJson } from "#src/servicenow/errors.ts";

export const sn = snRoot.pipe(
  Command.withSubcommands([table, record, batch, script, rule]),
);

/** Entrypoint effect: subcommands, live layers, stderr error rendering. */
export const program = sn.pipe(
  Command.provide(Layer.merge(snClientLive, emitLive)),
  Command.run({ version: pkg.version }),
  Effect.tapError((error) =>
    isSnError(error) ? Console.error(snErrorJson(error)) : Effect.void,
  ),
  // Effect's default logger writes to stdout and runMain's error report goes
  // through it, so an unhandled defect would otherwise land in the data stream.
  // Disabling the built-in report and rendering the cause here is the only
  // combination that keeps stdout clean; Logger.LogToStderr alone does not,
  // because runMain wraps this effect from the outside. The reported check is
  // what the built-in report does, and skips control-flow failures like the
  // ShowHelp raised by a bare invocation.
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause) ||
    !Runtime.getErrorReported(Cause.squash(cause))
      ? Effect.void
      : Console.error(Cause.pretty(cause)),
  ),
  Effect.provide(NodeServices.layer),
  Effect.provideService(Logger.LogToStderr, true),
);

if (import.meta.main) {
  NodeRuntime.runMain(program, { disableErrorReporting: true });
}
