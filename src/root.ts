import { Command, Flag } from "effect/unstable/cli";

const root = Command.make("sn").pipe(
  Command.withSharedFlags({
    alias: Flag.optional(
      Flag.string("alias").pipe(
        Flag.withDescription("Now SDK OAuth Alias (overrides the SDK default)"),
      ),
    ),
    yes: Flag.boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Skip SDK default Alias confirmation"),
    ),
  }),
);

/** Read-only root command. Subcommands are attached in `cli.ts`. */
export const sn = root.pipe(
  Command.withDescription(
    "ServiceNow reads from the command line. This CLI does not change ServiceNow. The always-on Instance Guard blocks the production and UAT Blocked Instances before network access. Select a Now SDK OAuth Alias with --alias or confirm the SDK default; --yes/-y skips only that default confirmation.",
  ),
);
