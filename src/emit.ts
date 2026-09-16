import { Console, Context, Effect, flow, Layer, Schema } from "effect";

import { SnLocalError } from "#src/servicenow/errors.ts";

/**
 * Single stdout writer for command results. Handlers produce a value and hand
 * it to {@link emitJson} / {@link emitText}; the entrypoint provides the live
 * layer. Tests substitute a capturing layer — no fake Stdio required.
 */
export class Emit extends Context.Service<
  Emit,
  {
    readonly json: (value: Schema.Json) => Effect.Effect<void>;
    readonly text: (value: string) => Effect.Effect<void>;
  }
>()("sn/Emit") {}

const parseJson = flow(
  Schema.decodeUnknownEffect(Schema.Json),
  Effect.mapError(
    () =>
      new SnLocalError({
        message: "Command result is not valid JSON",
      }),
  ),
);

/** Parse and hand a structured command result to the Emit service (compact JSON). */
export const emitJson = flow(
  parseJson,
  Effect.flatMap((json) => Effect.flatMap(Emit, (emit) => emit.json(json))),
);

/** Hand a human-readable summary to the Emit service (raw text on stdout). */
export const emitText = (value: string): Effect.Effect<void, never, Emit> =>
  Effect.flatMap(Emit, (emit) => emit.text(value));

/** Live Emit: compact JSON or raw text on stdout. */
export const emitLive = Layer.succeed(
  Emit,
  Emit.of({
    json: (value) => Console.log(JSON.stringify(value)),
    text: (value) => Console.log(value),
  }),
);

/** Test Emit: push values into `writes` instead of printing. */
export const emitCapture = (writes: Array<unknown>): Layer.Layer<Emit> =>
  Layer.succeed(
    Emit,
    Emit.of({
      json: (value) =>
        Effect.sync(() => {
          writes.push(value);
        }),
      text: (value) =>
        Effect.sync(() => {
          writes.push(value);
        }),
    }),
  );
