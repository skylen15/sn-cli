import { createInterface } from "node:readline";

import { Context, Effect, Layer } from "effect";

/** One line from process.stdin (used only after a TTY check passes). */
const readStdinLine = Effect.callback<string>((resume) => {
  const rl = createInterface({ input: process.stdin });
  const onLine = (line: string) => {
    rl.close();
    resume(Effect.succeed(line));
  };
  rl.once("line", onLine);
  return Effect.sync(() => {
    rl.off("line", onLine);
    rl.close();
  });
});

/** Prompt and TTY capabilities for default-Alias confirmation and announcements. */
export type AliasConfirm = {
  readonly isTTY: boolean;
  readonly readLine: Effect.Effect<string>;
  readonly writePrompt: (text: string) => Effect.Effect<void>;
};

/**
 * Stdin/confirm adapter for default-Alias selection.
 * Default is process stdin/stderr; tests substitute via {@link aliasConfirmLayer}.
 * Reference (not Service) so leaves do not require it in R.
 */
export const AliasConfirm: Context.Reference<AliasConfirm> = Context.Reference(
  "sn/servicenow/AliasConfirm",
  {
    defaultValue: () => ({
      isTTY: process.stdin.isTTY === true,
      readLine: readStdinLine,
      writePrompt: (text) =>
        Effect.sync(() => {
          process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
        }),
    }),
  },
);

/** Substitute stdin/confirm behaviour for tests. */
export const aliasConfirmLayer = (impl: AliasConfirm): Layer.Layer<never> =>
  Layer.succeed(AliasConfirm, impl);
