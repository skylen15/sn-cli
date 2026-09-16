#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";

import { makeCliProgram } from "#src/cli-runtime.ts";
import { authLive } from "#src/commands/auth.ts";
import { rule } from "#src/commands/rule.ts";
import { script } from "#src/commands/script.ts";
import { table } from "#src/commands/table.ts";
import { sn as snRoot } from "#src/root.ts";

export const sn = snRoot.pipe(Command.withSubcommands([table, script, authLive, rule]));

/** Entrypoint effect: subcommands, live layers, stderr error rendering. */
export const program = makeCliProgram(sn);

if (import.meta.main) {
  NodeRuntime.runMain(program, { disableErrorReporting: true });
}
