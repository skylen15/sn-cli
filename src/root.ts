import { Command, Flag } from "effect/unstable/cli";

/** Root command (shared flags only). Subcommands are attached in `cli.ts`. */
export const sn = Command.make("sn").pipe(
  Command.withSharedFlags({
    alias: Flag.optional(
      Flag.string("alias").pipe(
        Flag.withDescription(
          "Now SDK auth Alias (overrides SN_AUTH_ALIAS and the SDK default)",
        ),
      ),
    ),
  }),
  Command.withDescription("ServiceNow from the command line"),
);
